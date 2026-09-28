/** Unauthenticated catalog data for the website. */
import { Hono } from "hono";
import { DEPENDENCIES, FEATURE_LIMITS, TOOLS, type TermsVersion } from "@toolbox/shared";
import type { AppEnv } from "../env";
import { notFound } from "../lib/http";

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get("/catalog", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json({ tools: TOOLS, dependencies: DEPENDENCIES, limits: FEATURE_LIMITS });
});

publicRoutes.get("/terms/current", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT version, title, content, published_at FROM terms_versions ORDER BY version DESC LIMIT 1",
  ).first<{ version: number; title: string; content: string; published_at: number }>();
  if (!row) throw notFound("Termos ainda não publicados.");
  const terms: TermsVersion = {
    version: row.version,
    title: row.title,
    content: row.content,
    publishedAt: row.published_at,
  };
  return c.json(terms);
});
