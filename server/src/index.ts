import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Env } from "./env";
import { ApiError, errorBody } from "./lib/http";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { deviceRoutes } from "./routes/device";
import { downloadRoutes } from "./routes/downloads";
import { meRoutes } from "./routes/me";
import { publicRoutes } from "./routes/public";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", secureHeaders());
// API responses carry account data: never cached by the browser or proxies.
app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});

app.route("/auth", authRoutes);
app.route("/device", deviceRoutes);
app.route("/me", meRoutes);
app.route("/downloads", downloadRoutes);
app.route("/admin", adminRoutes);
app.route("/", publicRoutes);

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => c.json(errorBody("not_found", "Rota não encontrada."), 404));

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
  console.error("unhandled error", err);
  return c.json(errorBody("internal", "Erro interno. Tente novamente em instantes."), 500);
});

/** Daily housekeeping: drops rows that can never be used again. */
async function cleanup(env: Env) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM device_codes WHERE expires_at < ?").bind(now - day),
    env.DB.prepare("DELETE FROM email_tokens WHERE expires_at < ?").bind(now - day),
    // Revoked/expired sessions kept 30 days for the audit trail.
    env.DB.prepare("DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR expires_at < ?").bind(
      now - 30 * day,
      now - 30 * day,
    ),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - day),
  ]);
}

export default {
  fetch: app.fetch,
  scheduled: async (_event, env, ctx) => {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;

export { app };
