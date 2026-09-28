import { ApiError } from "./http";

/** Fixed-window counter in D1. Coarse but durable and shared across all
 * Worker instances — enough to stop password guessing and e-mail spam. */
export async function rateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<void> {
  const windowStart = now - (now % windowMs);
  // Upsert: a new window resets the count, the same window increments it.
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
         window_start = ?2
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  if (row && row.count > limit) {
    const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
    throw new ApiError(
      429,
      "rate_limited",
      `Muitas tentativas. Tente novamente em ${retryAfter > 90 ? `${Math.ceil(retryAfter / 60)} minutos` : `${retryAfter} segundos`}.`,
    );
  }
}

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
