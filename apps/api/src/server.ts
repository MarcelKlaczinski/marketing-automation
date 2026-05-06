import { createLogger, getEnv } from "@marketing-auto/shared";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { healthRoutes } from "./routes/health.ts";
import { authRoutes } from "./routes/auth.ts";
import { articleRoutes } from "./routes/articles.ts";
import { systemRoutes } from "./routes/system.ts";
import { sessionLoader } from "./middleware/auth.ts";

const env = getEnv();
const log = createLogger("api");

const app = new Hono();

// Middleware (order matters: logger first, then session loader on every request)
app.use("*", honoLogger((message) => log.info(message)));
app.use("*", sessionLoader);

// Public routes
app.route("/health", healthRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/system", systemRoutes);
app.route("/api", articleRoutes);

// Protected routes (Spec 06+) will apply requireAuth middleware

app.notFound((c) => c.json({ ok: false, error: "Not Found" }, 404));

app.onError((err, c) => {
  log.error({ err }, "Unhandled error");
  return c.json({ ok: false, error: "Internal Server Error" }, 500);
});

declare global {
  var __startTime: number;
}
globalThis.__startTime = Date.now();

log.info({ port: env.API_PORT, host: env.API_HOST }, "Starting API server");

export default {
  port: env.API_PORT,
  hostname: env.API_HOST,
  fetch: app.fetch,
};
