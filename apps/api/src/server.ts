import { createLogger, getEnv } from "@marketing-auto/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { sessionLoader } from "./middleware/auth.ts";
import { articleRoutes, legacyArticleRoutes } from "./routes/articles.ts";
import { authRoutes } from "./routes/auth.ts";
import { clusterRoutes } from "./routes/clusters.ts";
import { coldStartRoutes } from "./routes/cold-start.ts";
import { costRoutes } from "./routes/cost.ts";
import { healthRoutes } from "./routes/health.ts";
import { pillarRoutes } from "./routes/pillars.ts";
import { pipelineRunsRoutes } from "./routes/pipeline-runs.ts";
import { projectRoutes } from "./routes/projects.ts";
import { systemRoutes } from "./routes/system.ts";

const env = getEnv();
const log = createLogger("api");

const app = new Hono();

// Middleware (order matters: CORS first, then logger, then session loader)
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(
  "*",
  honoLogger((message) => log.info(message))
);
app.use("*", sessionLoader);

// Public routes
app.route("/health", healthRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/system", systemRoutes);
app.route("/api/articles", articleRoutes);
app.route("/api", legacyArticleRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/projects", coldStartRoutes);
app.route("/api/pipeline-runs", pipelineRunsRoutes);
app.route("/api/cost", costRoutes);
app.route("/api/pillars", pillarRoutes);
app.route("/api/clusters", clusterRoutes);

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
