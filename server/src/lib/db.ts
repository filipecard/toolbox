/** D1 rows and their API shapes. */
import type { Entitlements, Role, SessionInfo, Subscription, User, UserStatus } from "@toolbox/shared";
import type { PaidTier } from "@toolbox/shared";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  email_verified_at: number | null;
  created_at: number;
  updated_at: number;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    emailVerified: row.email_verified_at !== null,
    createdAt: row.created_at,
  };
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export interface SessionRow {
  id: string;
  user_id: string;
  kind: "web" | "desktop";
  device_name: string | null;
  platform: string | null;
  user_agent: string | null;
  ip: string | null;
  refresh_hash: string;
  previous_refresh_hash: string | null;
  rotated_at: number | null;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export function toSessionInfo(row: SessionRow, currentId: string | null): SessionInfo {
  return {
    id: row.id,
    kind: row.kind,
    deviceName: row.device_name,
    platform: row.platform,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    current: row.id === currentId,
  };
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  tool_id: string;
  tier: PaidTier;
  status: "active" | "canceled";
  starts_at: number;
  ends_at: number | null;
  source: string;
  granted_by: string | null;
  note: string | null;
  created_at: number;
}

export function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    toolId: row.tool_id,
    tier: row.tier,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
  };
}

const TIER_RANK: Record<string, number> = { basic: 1, silver: 2, gold: 3 };

/** A user's effective plan: active, currently-valid subscriptions only;
 * if several cover the same tool, the highest tier wins. */
export async function computeEntitlements(db: D1Database, userId: string, now = Date.now()): Promise<Entitlements> {
  const { results } = await db
    .prepare(
      `SELECT tool_id, tier FROM subscriptions
       WHERE user_id = ? AND status = 'active' AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`,
    )
    .bind(userId, now, now)
    .all<{ tool_id: string; tier: PaidTier }>();
  const entitlements: Entitlements = { diamond: false, tools: {} };
  for (const { tool_id, tier } of results) {
    if (tier === "diamond") {
      entitlements.diamond = true;
      continue;
    }
    const current = entitlements.tools[tool_id];
    if (!current || TIER_RANK[tier] > TIER_RANK[current]) entitlements.tools[tool_id] = tier;
  }
  return entitlements;
}

export async function currentTermsVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT MAX(version) AS v FROM terms_versions").first<{ v: number | null }>();
  return row?.v ?? 0;
}

export async function hasAcceptedTerms(db: D1Database, userId: string, version: number): Promise<boolean> {
  if (version === 0) return true;
  const row = await db
    .prepare("SELECT 1 AS ok FROM terms_acceptances WHERE user_id = ? AND version = ?")
    .bind(userId, version)
    .first();
  return row !== null;
}

export async function userTools(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT tool_id FROM user_tools WHERE user_id = ? ORDER BY tool_id")
    .bind(userId)
    .all<{ tool_id: string }>();
  return results.map((r) => r.tool_id);
}
