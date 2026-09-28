/** Sign-up, login, token refresh, logout, e-mail verification and password
 * reset — for the website. (The desktop app signs in through the device
 * flow in device.ts, and refreshes through /refresh with a body token.) */
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { dummyPasswordHash, hashPassword, randomToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { currentTermsVersion, findUserByEmail, findUserById } from "../lib/db";
import { sendPasswordResetEmail, sendVerificationEmail } from "../lib/email";
import { badRequest, clientIp, conflict, forbidden, readJson, unauthorized, userAgent } from "../lib/http";
import { HOUR, MINUTE, rateLimit } from "../lib/rateLimit";
import {
  WEB_SESSION_TTL_MS,
  createSession,
  isAdminEmail,
  issueAccessToken,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
} from "../lib/sessions";
import { requireAuth } from "../middleware/auth";

export const REFRESH_COOKIE = "tb_refresh";
const VERIFY_TTL_MS = 24 * HOUR;
const RESET_TTL_MS = HOUR;

export const passwordSchema = z
  .string()
  .min(8, "A senha precisa ter pelo menos 8 caracteres.")
  .max(200, "Senha longa demais.");
const emailSchema = z.string().trim().toLowerCase().email("E-mail inválido.").max(254);

function setRefreshCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === "production",
    sameSite: "Strict",
    path: "/api/auth",
    maxAge: Math.floor(WEB_SESSION_TTL_MS / 1000),
  });
}

/** Cookie-authenticated endpoints also require this header: a cross-site
 * form can't set custom headers, so it can't ride on the cookie (on top of
 * SameSite=Strict). */
function requireAppHeader(c: Context<AppEnv>) {
  if (c.req.header("x-toolbox-client") !== "web") throw forbidden("Requisição recusada.", "csrf");
}

async function createEmailToken(db: D1Database, userId: string, purpose: "verify" | "reset", ttlMs: number) {
  const token = randomToken();
  const now = Date.now();
  // One live link per purpose: older ones stop working.
  await db.batch([
    db
      .prepare("UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL")
      .bind(now, userId, purpose),
    db
      .prepare("INSERT INTO email_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), userId, purpose, now, now + ttlMs),
  ]);
  return token;
}

/** Marks a link used and returns its user — null if unknown, used or expired. */
async function consumeEmailToken(db: D1Database, token: string, purpose: "verify" | "reset") {
  const now = Date.now();
  const row = await db
    .prepare(
      `UPDATE email_tokens SET used_at = ?
       WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
       RETURNING user_id`,
    )
    .bind(now, await sha256Hex(token), purpose, now)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/signup", async (c) => {
  const body = await readJson(
    c,
    z.object({
      name: z.string().trim().min(2, "Informe seu nome.").max(100),
      email: emailSchema,
      password: passwordSchema,
      acceptedTermsVersion: z.number().int(),
    }),
  );
  const ip = clientIp(c);
  await rateLimit(c.env.DB, `signup:${ip}`, 5, HOUR);

  const terms = await currentTermsVersion(c.env.DB);
  if (body.acceptedTermsVersion !== terms) {
    throw badRequest("Aceite a versão atual dos Termos de Uso para criar a conta.", "terms_required");
  }
  if (await findUserByEmail(c.env.DB, body.email)) {
    throw conflict("Já existe uma conta com esse e-mail. Faça login ou recupere a senha.", "email_taken");
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  const role = isAdminEmail(c.env, body.email) ? "admin" : "user";
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).bind(id, body.email, body.name, await hashPassword(body.password), role, now, now),
    c.env.DB.prepare(
      "INSERT INTO terms_acceptances (user_id, version, accepted_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, terms, now, ip, userAgent(c)),
  ]);
  const user = (await findUserById(c.env.DB, id))!;

  const verifyToken = await createEmailToken(c.env.DB, id, "verify", VERIFY_TTL_MS);
  c.executionCtx.waitUntil(sendVerificationEmail(c.env, user.email, user.name, verifyToken));

  const session = await createSession(c.env.DB, { userId: id, kind: "web", userAgent: userAgent(c), ip });
  await audit(c.env.DB, { actorId: id, action: "user.signup", targetUserId: id, ip });
  setRefreshCookie(c, session.refreshToken);
  return c.json(await issueAccessToken(c.env, user, session.sessionId), 201);
});

authRoutes.post("/login", async (c) => {
  const body = await readJson(c, z.object({ email: emailSchema, password: z.string().max(200) }));
  const ip = clientIp(c);
  // Per IP (spraying many accounts) and per account (guessing one password).
  await rateLimit(c.env.DB, `login-ip:${ip}`, 20, 15 * MINUTE);
  await rateLimit(c.env.DB, `login-email:${body.email}`, 8, 15 * MINUTE);

  const user = await findUserByEmail(c.env.DB, body.email);
  const valid = await verifyPassword(body.password, user?.password_hash ?? (await dummyPasswordHash()));
  if (!user || !valid) {
    await audit(c.env.DB, { actorId: null, action: "auth.login_failed", targetUserId: user?.id, ip });
    throw unauthorized("E-mail ou senha incorretos.", "invalid_credentials");
  }
  if (user.status !== "active") throw forbidden("Conta bloqueada. Fale com o suporte.", "account_blocked");

  // Bootstrap: e-mails listed in ADMIN_EMAILS are promoted on login.
  if (user.role !== "admin" && isAdminEmail(c.env, user.email)) {
    await c.env.DB.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?")
      .bind(Date.now(), user.id)
      .run();
    user.role = "admin";
  }

  const session = await createSession(c.env.DB, { userId: user.id, kind: "web", userAgent: userAgent(c), ip });
  await audit(c.env.DB, { actorId: user.id, action: "auth.login", targetUserId: user.id, ip });
  setRefreshCookie(c, session.refreshToken);
  return c.json(await issueAccessToken(c.env, user, session.sessionId));
});

/** Browsers: refresh token from the cookie. Desktop: `{ refreshToken }` in
 * the body, and the rotated token comes back in the body. */
authRoutes.post("/refresh", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { refreshToken?: unknown } | null;
  const fromBody = typeof body?.refreshToken === "string" ? body.refreshToken : null;
  if (!fromBody) requireAppHeader(c);
  const token = fromBody ?? getCookie(c, REFRESH_COOKIE);
  if (!token) throw unauthorized("Faça login para continuar.", "session_expired");

  const ip = clientIp(c);
  await rateLimit(c.env.DB, `refresh:${ip}`, 120, 15 * MINUTE);
  try {
    const { session, user, refreshToken } = await rotateRefreshToken(c.env.DB, token, {
      ip,
      userAgent: userAgent(c),
    });
    const auth = await issueAccessToken(c.env, user, session.id);
    if (fromBody) return c.json({ ...auth, refreshToken });
    setRefreshCookie(c, refreshToken);
    return c.json(auth);
  } catch (e) {
    if (!fromBody) deleteCookie(c, REFRESH_COOKIE, { path: "/api/auth" });
    throw e;
  }
});

authRoutes.post("/logout", requireAuth, async (c) => {
  await revokeSession(c.env.DB, c.get("auth").sessionId);
  deleteCookie(c, REFRESH_COOKIE, { path: "/api/auth" });
  return c.body(null, 204);
});

authRoutes.post("/verify-email", async (c) => {
  const { token } = await readJson(c, z.object({ token: z.string().min(10).max(200) }));
  const userId = await consumeEmailToken(c.env.DB, token, "verify");
  if (!userId) throw badRequest("Link inválido ou expirado. Peça um novo na sua conta.", "invalid_token");
  await c.env.DB.prepare(
    "UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?",
  )
    .bind(Date.now(), Date.now(), userId)
    .run();
  await audit(c.env.DB, { actorId: userId, action: "user.email_verified", targetUserId: userId });
  return c.json({ ok: true });
});

authRoutes.post("/resend-verification", requireAuth, async (c) => {
  const user = await findUserById(c.env.DB, c.get("auth").userId);
  if (!user) throw unauthorized();
  if (user.email_verified_at) return c.json({ ok: true });
  await rateLimit(c.env.DB, `verify-mail:${user.id}`, 3, HOUR);
  const token = await createEmailToken(c.env.DB, user.id, "verify", VERIFY_TTL_MS);
  c.executionCtx.waitUntil(sendVerificationEmail(c.env, user.email, user.name, token));
  return c.json({ ok: true });
});

/** Always answers the same, so it can't be used to find registered e-mails. */
authRoutes.post("/forgot-password", async (c) => {
  const { email } = await readJson(c, z.object({ email: emailSchema }));
  await rateLimit(c.env.DB, `forgot-ip:${clientIp(c)}`, 10, HOUR);
  await rateLimit(c.env.DB, `forgot-email:${email}`, 3, HOUR);
  const user = await findUserByEmail(c.env.DB, email);
  if (user && user.status === "active") {
    const token = await createEmailToken(c.env.DB, user.id, "reset", RESET_TTL_MS);
    c.executionCtx.waitUntil(sendPasswordResetEmail(c.env, user.email, user.name, token));
  }
  return c.json({ ok: true });
});

authRoutes.post("/reset-password", async (c) => {
  const body = await readJson(c, z.object({ token: z.string().min(10).max(200), password: passwordSchema }));
  const userId = await consumeEmailToken(c.env.DB, body.token, "reset");
  if (!userId) throw badRequest("Link inválido ou expirado. Peça uma nova redefinição.", "invalid_token");
  const now = Date.now();
  // Resetting through the e-mail link also proves the address.
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?",
  )
    .bind(await hashPassword(body.password), now, now, userId)
    .run();
  // A reset usually means the old password may be known: sign out everywhere.
  await revokeAllSessions(c.env.DB, userId);
  await audit(c.env.DB, { actorId: userId, action: "auth.password_reset", targetUserId: userId, ip: clientIp(c) });
  return c.json({ ok: true });
});
