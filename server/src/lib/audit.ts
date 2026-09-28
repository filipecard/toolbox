/** Security-relevant events (logins, plan changes, admin actions), kept for
 * support and for investigating account abuse. */
export async function audit(
  db: D1Database,
  entry: {
    actorId: string | null;
    action: string;
    targetUserId?: string | null;
    details?: Record<string, unknown>;
    ip?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO audit_log (actor_id, action, target_user_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      entry.actorId,
      entry.action,
      entry.targetUserId ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.ip ?? null,
      Date.now(),
    )
    .run();
}
