/** Installers and dependency packages, stored in R2.
 *
 * Files are only reachable through short-lived signed links: a signed-in
 * user asks for a link (POST /:id/link) and the browser or app then fetches
 * it without an Authorization header — which a plain browser download
 * can't send. */
import { Hono } from "hono";
import type { DownloadLinkResponse, DownloadsResponse, Release } from "@toolbox/shared";
import type { AppEnv } from "../env";
import { audit } from "../lib/audit";
import { hmacSign, hmacVerify } from "../lib/crypto";
import { forbidden, notFound } from "../lib/http";
import { HOUR, rateLimit } from "../lib/rateLimit";
import { requireAuth } from "../middleware/auth";

const LINK_TTL_MS = 10 * 60 * 1000;

export interface ReleaseRow {
  id: string;
  kind: "app" | "dependency";
  target: string;
  version: string;
  r2_key: string;
  file_name: string;
  size: number;
  sha256: string;
  notes: string | null;
  published_at: number;
}

export function toRelease(r: ReleaseRow): Release {
  return {
    id: r.id,
    kind: r.kind,
    target: r.target,
    version: r.version,
    fileName: r.file_name,
    size: r.size,
    sha256: r.sha256,
    notes: r.notes,
    publishedAt: r.published_at,
  };
}

function signaturePayload(releaseId: string, userId: string, exp: number) {
  return `download:${releaseId}:${userId}:${exp}`;
}

export const downloadRoutes = new Hono<AppEnv>();

/** Latest release of each (kind, target). */
downloadRoutes.get("/", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.* FROM releases r
     WHERE r.published_at = (
       SELECT MAX(published_at) FROM releases WHERE kind = r.kind AND target = r.target
     )
     ORDER BY r.kind, r.target`,
  ).all<ReleaseRow>();
  const releases = results.map(toRelease);
  const response: DownloadsResponse = {
    app: releases.filter((r) => r.kind === "app"),
    dependencies: releases.filter((r) => r.kind === "dependency"),
  };
  return c.json(response);
});

downloadRoutes.post("/:id/link", requireAuth, async (c) => {
  const { userId } = c.get("auth");
  await rateLimit(c.env.DB, `download-link:${userId}`, 60, HOUR);
  const release = await c.env.DB.prepare("SELECT id FROM releases WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ id: string }>();
  if (!release) throw notFound("Arquivo não encontrado.");
  const exp = Date.now() + LINK_TTL_MS;
  const sig = await hmacSign(c.env.DOWNLOAD_SIGNING_KEY, signaturePayload(release.id, userId, exp));
  const origin = new URL(c.req.url).origin;
  const params = new URLSearchParams({ uid: userId, exp: String(exp), sig });
  const response: DownloadLinkResponse = {
    url: `${origin}/api/downloads/file/${release.id}?${params}`,
    expiresAt: exp,
  };
  return c.json(response);
});

downloadRoutes.get("/file/:id", async (c) => {
  const id = c.req.param("id");
  const uid = c.req.query("uid") ?? "";
  const exp = Number(c.req.query("exp"));
  const sig = c.req.query("sig") ?? "";
  if (!Number.isFinite(exp) || exp < Date.now()) throw forbidden("Link expirado. Gere um novo na página de download.");
  if (!(await hmacVerify(c.env.DOWNLOAD_SIGNING_KEY, signaturePayload(id, uid, exp), sig))) {
    throw forbidden("Link inválido.");
  }

  const release = await c.env.DB.prepare("SELECT * FROM releases WHERE id = ?").bind(id).first<ReleaseRow>();
  if (!release) throw notFound("Arquivo não encontrado.");
  const object = await c.env.FILES.get(release.r2_key);
  if (!object) throw notFound("Arquivo indisponível no momento.");

  c.executionCtx.waitUntil(
    audit(c.env.DB, {
      actorId: uid,
      action: "download",
      targetUserId: uid,
      details: { releaseId: id, kind: release.kind, target: release.target, version: release.version },
    }),
  );
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  headers.set("content-disposition", `attachment; filename="${release.file_name.replace(/"/g, "")}"`);
  headers.set("x-content-sha256", release.sha256);
  headers.set("cache-control", "private, no-store");
  return new Response(object.body, { headers });
});
