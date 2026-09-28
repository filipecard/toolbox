/** Admin panel API: users, plans (subscriptions), terms, releases, audit.
 * Every mutation is written to the audit log with the acting admin. */
import { Hono } from "hono";
import { z } from "zod";
import {
  TOOL_IDS,
  type AdminUserDetail,
  type AdminUserSummary,
  type AuditEntry,
  type Paginated,
  type TermsVersion,
} from "@toolbox/shared";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import {
  computeEntitlements,
  findUserById,
  toSessionInfo,
  toSubscription,
  toUser,
  userTools,
  type SessionRow,
  type SubscriptionRow,
  type UserRow,
} from "../lib/db";
import { badRequest, clientIp, conflict, notFound, readJson } from "../lib/http";
import { revokeAllSessions } from "../lib/sessions";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { toRelease, type ReleaseRow } from "./downloads";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAuth, requireAdmin);

const PAGE_SIZE = 25;

// --- Users ---

adminRoutes.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const where = q ? "WHERE u.email LIKE ?1 ESCAPE '\\' OR u.name LIKE ?1 ESCAPE '\\'" : "";
  const now = Date.now();
  const [{ results }, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.*,
         (SELECT MAX(last_used_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at,
         (SELECT COUNT(*) FROM subscriptions sub WHERE sub.user_id = u.id AND sub.status = 'active'
            AND (sub.ends_at IS NULL OR sub.ends_at > ?2)) AS active_subscriptions
       FROM users u ${where}
       ORDER BY u.created_at DESC LIMIT ?3 OFFSET ?4`,
    )
      .bind(like, now, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .all<UserRow & { last_seen_at: number | null; active_subscriptions: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`)
      .bind(like)
      .first<{ n: number }>(),
  ]);
  const response: Paginated<AdminUserSummary> = {
    items: results.map((r) => ({
      ...toUser(r),
      lastSeenAt: r.last_seen_at,
      activeSubscriptions: r.active_subscriptions,
    })),
    total: total?.n ?? 0,
  };
  return c.json(response);
});

async function userDetail(db: D1Database, id: string): Promise<AdminUserDetail> {
  const user = await findUserById(db, id);
  if (!user) throw notFound("Usuário não encontrado.");
  const [subs, sessions] = await Promise.all([
    db.prepare("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC").bind(id).all<SubscriptionRow>(),
    db
      .prepare(
        "SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC",
      )
      .bind(id, Date.now())
      .all<SessionRow>(),
  ]);
  return {
    user: toUser(user),
    subscriptions: subs.results.map(toSubscription),
    sessions: sessions.results.map((s) => toSessionInfo(s, null)),
    entitlements: await computeEntitlements(db, id),
    tools: await userTools(db, id),
  };
}

adminRoutes.get("/users/:id", async (c) => c.json(await userDetail(c.env.DB, c.req.param("id"))));

adminRoutes.patch("/users/:id", async (c) => {
  const body = await readJson(
    c,
    z.object({
      role: z.enum(["user", "admin"]).optional(),
      status: z.enum(["active", "blocked"]).optional(),
      emailVerified: z.boolean().optional(),
    }),
  );
  const id = c.req.param("id");
  const { userId: actorId } = c.get("auth");
  if (id === actorId && (body.role === "user" || body.status === "blocked")) {
    throw badRequest("Você não pode remover o próprio acesso de administrador nem bloquear a si mesmo.");
  }
  const user = await findUserById(c.env.DB, id);
  if (!user) throw notFound("Usuário não encontrado.");

  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE users SET role = ?, status = ?, email_verified_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.role ?? user.role,
      body.status ?? user.status,
      body.emailVerified === undefined ? user.email_verified_at : body.emailVerified ? (user.email_verified_at ?? now) : null,
      now,
      id,
    )
    .run();
  if (body.status === "blocked") await revokeAllSessions(c.env.DB, id);
  await audit(c.env.DB, { actorId, action: "admin.user_updated", targetUserId: id, details: body, ip: clientIp(c) });
  return c.json(await userDetail(c.env.DB, id));
});

adminRoutes.delete("/users/:id/sessions", async (c) => {
  const id = c.req.param("id");
  await revokeAllSessions(c.env.DB, id);
  await audit(c.env.DB, { actorId: c.get("auth").userId, action: "admin.sessions_revoked", targetUserId: id });
  return c.json(await userDetail(c.env.DB, id));
});

// --- Subscriptions (plans) ---

adminRoutes.post("/users/:id/subscriptions", async (c) => {
  const body = await readJson(
    c,
    z
      .object({
        toolId: z.string(),
        tier: z.enum(["basic", "silver", "gold", "diamond"]),
        endsAt: z.number().int().positive().nullable().default(null),
        note: z.string().trim().max(500).nullable().default(null),
      })
      .refine((b) => (b.tier === "diamond" ? b.toolId === "*" : TOOL_IDS.has(b.toolId)), {
        message: "Ferramenta inválida para esse plano.",
      }),
  );
  const id = c.req.param("id");
  if (!(await findUserById(c.env.DB, id))) throw notFound("Usuário não encontrado.");
  const now = Date.now();
  if (body.endsAt !== null && body.endsAt <= now) throw badRequest("A data de término precisa ser no futuro.");

  const actorId = c.get("auth").userId;
  // One active plan per tool: the new one replaces the old.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND tool_id = ? AND status = 'active'",
    ).bind(id, body.toolId),
    c.env.DB.prepare(
      `INSERT INTO subscriptions (id, user_id, tool_id, tier, status, starts_at, ends_at, source, granted_by, note, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, 'admin', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, body.toolId, body.tier, now, body.endsAt, actorId, body.note, now),
  ]);
  await audit(c.env.DB, { actorId, action: "admin.plan_granted", targetUserId: id, details: body, ip: clientIp(c) });
  return c.json(await userDetail(c.env.DB, id), 201);
});

adminRoutes.delete("/subscriptions/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "UPDATE subscriptions SET status = 'canceled' WHERE id = ? AND status = 'active' RETURNING user_id, tool_id, tier",
  )
    .bind(c.req.param("id"))
    .first<{ user_id: string; tool_id: string; tier: string }>();
  if (!row) throw notFound("Plano não encontrado ou já cancelado.");
  await audit(c.env.DB, {
    actorId: c.get("auth").userId,
    action: "admin.plan_canceled",
    targetUserId: row.user_id,
    details: { toolId: row.tool_id, tier: row.tier },
    ip: clientIp(c),
  });
  return c.json(await userDetail(c.env.DB, row.user_id));
});

// --- Terms ---

adminRoutes.get("/terms", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT version, title, content, published_at FROM terms_versions ORDER BY version DESC",
  ).all<{ version: number; title: string; content: string; published_at: number }>();
  const versions: TermsVersion[] = results.map((r) => ({
    version: r.version,
    title: r.title,
    content: r.content,
    publishedAt: r.published_at,
  }));
  return c.json(versions);
});

/** Publishing a new version makes every user accept it again. */
adminRoutes.post("/terms", async (c) => {
  const body = await readJson(
    c,
    z.object({
      title: z.string().trim().min(3).max(200),
      content: z.string().trim().min(50, "Conteúdo curto demais.").max(100_000),
    }),
  );
  const actorId = c.get("auth").userId;
  const row = await c.env.DB.prepare(
    `INSERT INTO terms_versions (version, title, content, published_at, published_by)
     VALUES ((SELECT COALESCE(MAX(version), 0) + 1 FROM terms_versions), ?, ?, ?, ?)
     RETURNING version`,
  )
    .bind(body.title, body.content, Date.now(), actorId)
    .first<{ version: number }>();
  await audit(c.env.DB, { actorId, action: "admin.terms_published", details: { version: row?.version } });
  return c.json({ version: row?.version }, 201);
});

// --- Releases ---

adminRoutes.get("/releases", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM releases ORDER BY published_at DESC").all<ReleaseRow>();
  return c.json(results.map(toRelease));
});

const releaseMeta = z
  .object({
    kind: z.enum(["app", "dependency"]),
    target: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, "Alvo inválido (ex.: windows-x64, tesseract)."),
    version: z.string().trim().regex(/^[0-9A-Za-z.+-]{1,40}$/, "Versão inválida."),
    notes: z.string().trim().max(2000).nullable().default(null),
  });

/** SHA-256 of a stream without buffering it (Workers' DigestStream). */
async function sha256OfStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const digest = new crypto.DigestStream("SHA-256");
  await stream.pipeTo(digest);
  return [...new Uint8Array(await digest.digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function insertRelease(
  c: { env: AppEnv["Bindings"] },
  meta: z.infer<typeof releaseMeta>,
  file: { key: string; name: string; size: number; sha256: string },
  actorId: string,
) {
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO releases (id, kind, target, version, r2_key, file_name, size, sha256, notes, published_at, published_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, meta.kind, meta.target, meta.version, file.key, file.name, file.size, file.sha256, meta.notes, Date.now(), actorId)
    .run();
  await audit(c.env.DB, { actorId, action: "admin.release_published", details: { id, ...meta } });
  const row = await c.env.DB.prepare("SELECT * FROM releases WHERE id = ?").bind(id).first<ReleaseRow>();
  return toRelease(row!);
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "arquivo";
}

/** Upload through the Worker (multipart form: kind, target, version, notes,
 * file). Workers accept request bodies up to 100 MB — bigger files go to
 * R2 with `wrangler r2 object put` and are registered below. */
adminRoutes.post("/releases", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw badRequest("Envie o arquivo.");
  const parsed = releaseMeta.safeParse({
    kind: form.get("kind"),
    target: form.get("target"),
    version: form.get("version"),
    notes: (form.get("notes") as string | null) || null,
  });
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const meta = parsed.data;
  const name = safeFileName(file.name);
  const key = `${meta.kind}/${meta.target}/${meta.version}/${name}`;
  if (await c.env.FILES.head(key)) throw conflict("Já existe um arquivo com essa versão e nome.");

  // A File has a known length, which R2 needs, so it goes in as is; the
  // hash reads it through a second stream.
  const [, sha256] = await Promise.all([
    c.env.FILES.put(key, file, {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
    }),
    sha256OfStream(file.stream()),
  ]);
  const release = await insertRelease(c, meta, { key, name, size: file.size, sha256 }, c.get("auth").userId);
  return c.json(release, 201);
});

/** Registers a file already uploaded to R2 (for files over 100 MB). */
adminRoutes.post("/releases/register", async (c) => {
  const body = await readJson(
    c,
    releaseMeta.extend({
      r2Key: z.string().trim().min(3).max(500).refine((k) => !k.includes(".."), "Chave inválida."),
      fileName: z.string().trim().min(1).max(120),
    }),
  );
  const object = await c.env.FILES.get(body.r2Key);
  if (!object) throw notFound("Nenhum arquivo com essa chave no R2.");
  const sha256 = await sha256OfStream(object.body);
  const release = await insertRelease(
    c,
    body,
    { key: body.r2Key, name: safeFileName(body.fileName), size: object.size, sha256 },
    c.get("auth").userId,
  );
  return c.json(release, 201);
});

adminRoutes.delete("/releases/:id", async (c) => {
  const row = await c.env.DB.prepare("DELETE FROM releases WHERE id = ? RETURNING r2_key, kind, target, version")
    .bind(c.req.param("id"))
    .first<{ r2_key: string; kind: string; target: string; version: string }>();
  if (!row) throw notFound("Versão não encontrada.");
  await c.env.FILES.delete(row.r2_key);
  await audit(c.env.DB, { actorId: c.get("auth").userId, action: "admin.release_deleted", details: row });
  return c.body(null, 204);
});

// --- Audit log ---

adminRoutes.get("/audit", async (c) => {
  const userId = c.req.query("userId");
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     ${userId ? "WHERE a.target_user_id = ?1" : ""}
     ORDER BY a.id DESC LIMIT 200`,
  )
    .bind(...(userId ? [userId] : []))
    .all<{
      id: number;
      actor_id: string | null;
      actor_email: string | null;
      action: string;
      target_user_id: string | null;
      details: string | null;
      created_at: number;
    }>();
  const entries: AuditEntry[] = results.map((r) => ({
    id: r.id,
    actorId: r.actor_id,
    actorEmail: r.actor_email,
    action: r.action,
    targetUserId: r.target_user_id,
    details: r.details,
    createdAt: r.created_at,
  }));
  return c.json(entries);
});
