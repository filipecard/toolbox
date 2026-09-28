import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { forbidden, unauthorized } from "../lib/http";
import { verifyAccessToken } from "../lib/tokens";

/** Requires `Authorization: Bearer <access token>`. Besides the token's
 * signature and expiry, the session and account are re-checked on every
 * request, so revoking a device or blocking an account takes effect
 * immediately instead of after the 15-minute token lifetime. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw unauthorized();

  const claims = await verifyAccessToken(c.env.JWT_SECRET, token);
  if (!claims) throw unauthorized("Sessão expirada. Faça login novamente.", "token_expired");

  const row = await c.env.DB.prepare(
    `SELECT u.role, u.status FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
  )
    .bind(claims.sid, claims.sub, Date.now())
    .first<{ role: "user" | "admin"; status: string }>();
  if (!row) throw unauthorized("Sessão encerrada. Faça login novamente.", "session_expired");
  if (row.status !== "active") throw forbidden("Conta bloqueada. Fale com o suporte.", "account_blocked");

  // Role from the database, not the token: a demoted admin loses access now.
  c.set("auth", { userId: claims.sub, sessionId: claims.sid, role: row.role });
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("auth")?.role !== "admin") throw forbidden();
  await next();
});
