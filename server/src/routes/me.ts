/** The signed-in user's own account. */
import { Hono } from "hono";
import { z } from "zod";
import { TOOL_IDS, type Me } from "@toolbox/shared";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { hashPassword, verifyPassword } from "../lib/crypto";
import {
  computeEntitlements,
  currentTermsVersion,
  findUserById,
  hasAcceptedTerms,
  toSessionInfo,
  toUser,
  userTools,
  type SessionRow,
} from "../lib/db";
import { badRequest, clientIp, forbidden, notFound, readJson, unauthorized, userAgent } from "../lib/http";
import { MINUTE, rateLimit } from "../lib/rateLimit";
import { revokeAllSessions, revokeSession } from "../lib/sessions";
import { signEntitlementToken } from "../lib/tokens";
import { requireAuth } from "../middleware/auth";
import { passwordSchema } from "./auth";

export const meRoutes = new Hono<AppEnv>();
meRoutes.use("*", requireAuth);

async function loadMe(db: D1Database, userId: string): Promise<Me> {
  const user = await findUserById(db, userId);
  if (!user) throw unauthorized();
  const version = await currentTermsVersion(db);
  return {
    user: toUser(user),
    entitlements: await computeEntitlements(db, userId),
    terms: { currentVersion: version, accepted: await hasAcceptedTerms(db, userId, version) },
    tools: await userTools(db, userId),
  };
}

meRoutes.get("/", async (c) => c.json(await loadMe(c.env.DB, c.get("auth").userId)));

meRoutes.patch("/", async (c) => {
  const body = await readJson(c, z.object({ name: z.string().trim().min(2, "Informe seu nome.").max(100) }));
  const { userId } = c.get("auth");
  await c.env.DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?")
    .bind(body.name, Date.now(), userId)
    .run();
  return c.json(await loadMe(c.env.DB, userId));
});

meRoutes.post("/password", async (c) => {
  const body = await readJson(c, z.object({ currentPassword: z.string().max(200), newPassword: passwordSchema }));
  const { userId, sessionId } = c.get("auth");
  await rateLimit(c.env.DB, `password-change:${userId}`, 5, 15 * MINUTE);
  const user = await findUserById(c.env.DB, userId);
  if (!user || !(await verifyPassword(body.currentPassword, user.password_hash))) {
    throw badRequest("Senha atual incorreta.", "invalid_credentials");
  }
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(await hashPassword(body.newPassword), Date.now(), userId)
    .run();
  // Other browsers and computers must sign in again with the new password.
  await revokeAllSessions(c.env.DB, userId, sessionId);
  await audit(c.env.DB, { actorId: userId, action: "auth.password_changed", targetUserId: userId, ip: clientIp(c) });
  return c.json({ ok: true });
});

meRoutes.get("/sessions", async (c) => {
  const { userId, sessionId } = c.get("auth");
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_used_at DESC`,
  )
    .bind(userId, Date.now())
    .all<SessionRow>();
  return c.json(results.map((r) => toSessionInfo(r, sessionId)));
});

meRoutes.delete("/sessions/:id", async (c) => {
  const { userId } = c.get("auth");
  const id = c.req.param("id");
  if (!(await revokeSession(c.env.DB, id, userId))) throw notFound("Sessão não encontrada.");
  await audit(c.env.DB, { actorId: userId, action: "session.revoked", targetUserId: userId, details: { id } });
  return c.body(null, 204);
});

meRoutes.put("/tools", async (c) => {
  const { tools } = await readJson(
    c,
    z.object({
      tools: z
        .array(z.string())
        .max(TOOL_IDS.size)
        .refine((ids) => ids.every((id) => TOOL_IDS.has(id)), "Ferramenta desconhecida."),
    }),
  );
  const { userId } = c.get("auth");
  const now = Date.now();
  const unique = [...new Set(tools)];
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM user_tools WHERE user_id = ?").bind(userId),
    ...unique.map((toolId) =>
      c.env.DB.prepare("INSERT INTO user_tools (user_id, tool_id, added_at) VALUES (?, ?, ?)").bind(userId, toolId, now),
    ),
  ]);
  return c.json({ tools: unique.sort() });
});

meRoutes.post("/terms/accept", async (c) => {
  const { version } = await readJson(c, z.object({ version: z.number().int() }));
  const current = await currentTermsVersion(c.env.DB);
  if (version !== current) throw badRequest("Essa não é a versão atual dos Termos.", "terms_outdated");
  const { userId } = c.get("auth");
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO terms_acceptances (user_id, version, accepted_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(userId, version, Date.now(), clientIp(c), userAgent(c))
    .run();
  await audit(c.env.DB, { actorId: userId, action: "terms.accepted", targetUserId: userId, details: { version } });
  return c.json({ ok: true });
});

/** Desktop app: the current plan as an Ed25519-signed token it verifies
 * offline (see src-tauri/src/account). Re-fetched periodically; valid for
 * ENTITLEMENT_TTL_MS so the app keeps working briefly without internet. */
meRoutes.get("/entitlement-token", async (c) => {
  const { userId, sessionId } = c.get("auth");
  const user = await findUserById(c.env.DB, userId);
  if (!user) throw unauthorized();
  const version = await currentTermsVersion(c.env.DB);
  if (!(await hasAcceptedTerms(c.env.DB, userId, version))) {
    throw forbidden("Aceite a nova versão dos Termos de Uso no site para continuar.", "terms_required");
  }
  const entitlements = await computeEntitlements(c.env.DB, userId);
  const { token, expiresAt } = await signEntitlementToken(c.env.ENTITLEMENT_PRIVATE_KEY, {
    sub: userId,
    sid: sessionId,
    email: user.email,
    ...entitlements,
  });
  return c.json({ token, expiresAt, entitlements, tools: await userTools(c.env.DB, userId) });
});
