/** Desktop sign-in through the browser — OAuth 2.0 Device Authorization
 * Grant (RFC 8628), the same flow CLIs and TVs use:
 *
 * 1. The app asks for a code (POST /code) and opens the browser at
 *    /ativar?code=KXQD-7MWP.
 * 2. The user, signed in on the website, confirms that code (POST /approve).
 * 3. Meanwhile the app polls POST /token; once approved it receives its own
 *    session (refresh + access token). The password never touches the app.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { DeviceCodeResponse, DeviceLookupResponse, DeviceTokenError } from "@toolbox/shared";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { generateUserCode, normalizeUserCode, randomToken, sha256Hex } from "../lib/crypto";
import { currentTermsVersion, findUserById, hasAcceptedTerms } from "../lib/db";
import { ApiError, badRequest, clientIp, forbidden, notFound, readJson, userAgent } from "../lib/http";
import { HOUR, MINUTE, rateLimit } from "../lib/rateLimit";
import { createSession, issueAccessToken } from "../lib/sessions";
import { requireAuth } from "../middleware/auth";

const CODE_TTL_MS = 10 * MINUTE;
const POLL_INTERVAL_S = 5;

interface DeviceCodeRow {
  device_code_hash: string;
  user_code: string;
  device_name: string | null;
  platform: string | null;
  status: "pending" | "approved" | "denied" | "consumed";
  user_id: string | null;
  created_at: number;
  expires_at: number;
  last_polled_at: number | null;
}

/** RFC 8628 error responses: `{ error: "<code>" }` with HTTP 400. */
function deviceError(code: DeviceTokenError, message: string) {
  return new ApiError(400, code, message);
}

async function pendingByUserCode(db: D1Database, input: string): Promise<DeviceCodeRow> {
  const userCode = normalizeUserCode(input);
  if (!userCode) throw badRequest("Código inválido. Confira o código mostrado no aplicativo.", "invalid_code");
  const row = await db
    .prepare("SELECT * FROM device_codes WHERE user_code = ? AND status = 'pending' AND expires_at > ?")
    .bind(userCode, Date.now())
    .first<DeviceCodeRow>();
  if (!row) throw notFound("Código não encontrado ou expirado. Gere um novo no aplicativo.", "invalid_code");
  return row;
}

export const deviceRoutes = new Hono<AppEnv>();

deviceRoutes.post("/code", async (c) => {
  const body = await readJson(
    c,
    z.object({
      deviceName: z.string().trim().max(100).default("Computador"),
      platform: z.string().trim().max(40).default("unknown"),
    }),
  );
  const ip = clientIp(c);
  await rateLimit(c.env.DB, `device-code:${ip}`, 20, HOUR);

  const deviceCode = randomToken();
  const now = Date.now();
  // A user_code collision is astronomically unlikely, but UNIQUE would
  // reject it — retry with a fresh code instead of failing.
  for (let attempt = 0; attempt < 3; attempt++) {
    const userCode = generateUserCode();
    try {
      await c.env.DB.prepare(
        `INSERT INTO device_codes (device_code_hash, user_code, device_name, platform, ip, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(await sha256Hex(deviceCode), userCode, body.deviceName, body.platform, ip, now, now + CODE_TTL_MS)
        .run();
      const verificationUri = `${c.env.WEB_BASE_URL}/ativar`;
      const response: DeviceCodeResponse = {
        deviceCode,
        userCode,
        verificationUri,
        verificationUriComplete: `${verificationUri}?code=${userCode}`,
        expiresIn: CODE_TTL_MS / 1000,
        interval: POLL_INTERVAL_S,
      };
      return c.json(response);
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e;
    }
  }
  throw new ApiError(500, "internal", "Não foi possível gerar o código. Tente novamente.");
});

/** Polled by the desktop app until the user approves or denies. */
deviceRoutes.post("/token", async (c) => {
  const { deviceCode } = await readJson(c, z.object({ deviceCode: z.string().min(10).max(200) }));
  const hash = await sha256Hex(deviceCode);
  const now = Date.now();
  const row = await c.env.DB.prepare("SELECT * FROM device_codes WHERE device_code_hash = ?")
    .bind(hash)
    .first<DeviceCodeRow>();
  if (!row || row.expires_at <= now || row.status === "consumed") {
    throw deviceError("expired_token", "O código expirou. Tente entrar novamente.");
  }
  if (row.last_polled_at && now - row.last_polled_at < (POLL_INTERVAL_S - 1) * 1000) {
    throw deviceError("slow_down", "Aguarde alguns segundos entre as verificações.");
  }
  await c.env.DB.prepare("UPDATE device_codes SET last_polled_at = ? WHERE device_code_hash = ?").bind(now, hash).run();

  if (row.status === "denied") throw deviceError("access_denied", "O acesso foi recusado no navegador.");
  if (row.status === "pending" || !row.user_id) {
    throw deviceError("authorization_pending", "Aguardando confirmação no navegador.");
  }

  // Approved: consume the code (only once, even under concurrent polls).
  const consumed = await c.env.DB.prepare(
    "UPDATE device_codes SET status = 'consumed' WHERE device_code_hash = ? AND status = 'approved'",
  )
    .bind(hash)
    .run();
  if (consumed.meta.changes !== 1) throw deviceError("expired_token", "O código já foi usado.");

  const user = await findUserById(c.env.DB, row.user_id);
  if (!user || user.status !== "active") throw forbidden("Conta bloqueada. Fale com o suporte.", "account_blocked");
  const session = await createSession(c.env.DB, {
    userId: user.id,
    kind: "desktop",
    deviceName: row.device_name,
    platform: row.platform,
    userAgent: userAgent(c),
    ip: clientIp(c),
  });
  await audit(c.env.DB, {
    actorId: user.id,
    action: "device.signed_in",
    targetUserId: user.id,
    details: { deviceName: row.device_name, sessionId: session.sessionId },
    ip: clientIp(c),
  });
  return c.json({ ...(await issueAccessToken(c.env, user, session.sessionId)), refreshToken: session.refreshToken });
});

/** Website: shows which computer is asking before the user confirms. */
deviceRoutes.get("/lookup", requireAuth, async (c) => {
  await rateLimit(c.env.DB, `device-lookup:${c.get("auth").userId}`, 30, 15 * MINUTE);
  const row = await pendingByUserCode(c.env.DB, c.req.query("code") ?? "");
  const response: DeviceLookupResponse = {
    userCode: row.user_code,
    deviceName: row.device_name,
    platform: row.platform,
    createdAt: row.created_at,
  };
  return c.json(response);
});

deviceRoutes.post("/approve", requireAuth, async (c) => {
  const { code } = await readJson(c, z.object({ code: z.string().max(20) }));
  const { userId } = c.get("auth");
  await rateLimit(c.env.DB, `device-lookup:${userId}`, 30, 15 * MINUTE);
  const user = await findUserById(c.env.DB, userId);
  if (!user) throw forbidden();
  if (!user.email_verified_at) {
    throw forbidden("Confirme seu e-mail antes de conectar o aplicativo.", "email_not_verified");
  }
  const terms = await currentTermsVersion(c.env.DB);
  if (!(await hasAcceptedTerms(c.env.DB, userId, terms))) {
    throw forbidden("Aceite a versão atual dos Termos de Uso para continuar.", "terms_required");
  }
  const row = await pendingByUserCode(c.env.DB, code);
  await c.env.DB.prepare(
    "UPDATE device_codes SET status = 'approved', user_id = ? WHERE device_code_hash = ? AND status = 'pending'",
  )
    .bind(userId, row.device_code_hash)
    .run();
  return c.json({ ok: true });
});

deviceRoutes.post("/deny", requireAuth, async (c) => {
  const { code } = await readJson(c, z.object({ code: z.string().max(20) }));
  const row = await pendingByUserCode(c.env.DB, code);
  await c.env.DB.prepare("UPDATE device_codes SET status = 'denied' WHERE device_code_hash = ? AND status = 'pending'")
    .bind(row.device_code_hash)
    .run();
  return c.json({ ok: true });
});
