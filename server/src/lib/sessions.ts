/** Sessions and refresh-token rotation. */
import type { Env } from "../env";
import type { AuthResponse, User } from "@toolbox/shared";
import { randomToken, sha256Hex } from "./crypto";
import { findUserById, toUser, type SessionRow, type UserRow } from "./db";
import { unauthorized } from "./http";
import { signAccessToken } from "./tokens";

export const WEB_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Desktop installs stay signed in longer; each refresh slides it forward. */
export const DESKTOP_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** A concurrent refresh (two tabs at once) may still present the token that
 * was just rotated; within this window that's a race, not a leak. */
const ROTATION_GRACE_MS = 30 * 1000;

export interface NewSession {
  userId: string;
  kind: "web" | "desktop";
  deviceName?: string | null;
  platform?: string | null;
  userAgent?: string | null;
  ip?: string | null;
}

function ttl(kind: "web" | "desktop") {
  return kind === "desktop" ? DESKTOP_SESSION_TTL_MS : WEB_SESSION_TTL_MS;
}

export async function createSession(
  db: D1Database,
  s: NewSession,
  now = Date.now(),
): Promise<{ sessionId: string; refreshToken: string }> {
  const sessionId = crypto.randomUUID();
  const refreshToken = randomToken();
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, kind, device_name, platform, user_agent, ip, refresh_hash,
         created_at, last_used_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      sessionId,
      s.userId,
      s.kind,
      s.deviceName ?? null,
      s.platform ?? null,
      s.userAgent ?? null,
      s.ip ?? null,
      await sha256Hex(refreshToken),
      now,
      now,
      now + ttl(s.kind),
    )
    .run();
  return { sessionId, refreshToken };
}

export async function issueAccessToken(env: Env, user: UserRow, sessionId: string): Promise<AuthResponse> {
  const { token, expiresAt } = await signAccessToken(env.JWT_SECRET, {
    sub: user.id,
    sid: sessionId,
    role: user.role,
  });
  return { accessToken: token, accessTokenExpiresAt: expiresAt, user: toUser(user) };
}

/** Exchanges a refresh token for a new one (rotation). A token that was
 * already rotated away is treated as stolen: the whole session is revoked,
 * logging out both the thief and the real owner, who just signs in again. */
export async function rotateRefreshToken(
  db: D1Database,
  refreshToken: string,
  meta: { ip: string | null; userAgent: string | null },
  now = Date.now(),
): Promise<{ session: SessionRow; user: UserRow; refreshToken: string }> {
  const hash = await sha256Hex(refreshToken);
  const session = await db.prepare("SELECT * FROM sessions WHERE refresh_hash = ?").bind(hash).first<SessionRow>();

  if (!session) {
    const reused = await db
      .prepare("SELECT * FROM sessions WHERE previous_refresh_hash = ? AND revoked_at IS NULL")
      .bind(hash)
      .first<SessionRow>();
    if (reused && !(reused.rotated_at && now - reused.rotated_at < ROTATION_GRACE_MS)) {
      await db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(now, reused.id).run();
    }
    throw unauthorized("Sessão expirada. Faça login novamente.", "session_expired");
  }
  if (session.revoked_at || session.expires_at <= now) {
    throw unauthorized("Sessão expirada. Faça login novamente.", "session_expired");
  }

  const user = await findUserById(db, session.user_id);
  if (!user || user.status !== "active") {
    throw unauthorized("Conta bloqueada. Fale com o suporte.", "account_blocked");
  }

  const next = randomToken();
  const nextHash = await sha256Hex(next);
  // Conditional on the old hash: of two concurrent refreshes, only one wins.
  const result = await db
    .prepare(
      `UPDATE sessions SET refresh_hash = ?, previous_refresh_hash = ?, rotated_at = ?, last_used_at = ?,
         expires_at = ?, ip = COALESCE(?, ip), user_agent = COALESCE(?, user_agent)
       WHERE id = ? AND refresh_hash = ?`,
    )
    .bind(nextHash, hash, now, now, now + ttl(session.kind), meta.ip, meta.userAgent, session.id, hash)
    .run();
  if (result.meta.changes !== 1) {
    throw unauthorized("Sessão expirada. Faça login novamente.", "session_expired");
  }
  return { session, user, refreshToken: next };
}

export async function revokeSession(db: D1Database, sessionId: string, userId?: string): Promise<boolean> {
  const stmt = userId
    ? db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").bind(
        Date.now(),
        sessionId,
        userId,
      )
    : db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), sessionId);
  const result = await stmt.run();
  return result.meta.changes > 0;
}

export async function revokeAllSessions(db: D1Database, userId: string, exceptSessionId?: string): Promise<void> {
  await db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?")
    .bind(Date.now(), userId, exceptSessionId ?? "")
    .run();
}

export async function activeSession(db: D1Database, sessionId: string): Promise<SessionRow | null> {
  return db
    .prepare("SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?")
    .bind(sessionId, Date.now())
    .first<SessionRow>();
}

export function isAdminEmail(env: Env, email: string): boolean {
  return env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export type { User };
