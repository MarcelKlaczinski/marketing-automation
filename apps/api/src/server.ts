import { createLogger, getEnv } from "@marketing-auto/shared";
import { bootstrapTemplates } from "@marketing-auto/social/templates";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { serveStatic } from "hono/bun";
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
import { adminRoutes } from "./routes/admin.ts";
import { cornerstoneSpecRoutes } from "./routes/cornerstone-specs.ts";
import { notificationRoutes } from "./routes/notifications.ts";
import { pushSubscriptionRoutes } from "./routes/push-subscriptions.ts";
import { systemRoutes } from "./routes/system.ts";
import { socialPostRoutes, socialPostDetailRoutes, socialPostBatchRoutes, templateRenderDetailRoutes } from "./routes/social-posts.ts";
import { brandAssetRoutes } from "./routes/brand-assets.ts";
import { brandTokenRoutes } from "./routes/brand-tokens.ts";
import { trendRoutes } from "./routes/trends.ts";
import { clusterCreatorRoutes } from "./routes/projects/clusters.ts";
import { clusterFullPlanRoutes } from "./routes/projects/cluster-full-plan.ts";
import { projectSearchRoutes } from "./routes/projects/search.ts";
import { projectCostSummaryRoutes } from "./routes/projects/cost-summary.ts";
import { pipelineEventsRoutes } from "./routes/projects/pipeline-events.ts";
import { projectCronRoutes } from "./routes/projects/cron.ts";
import { projectRefreshRoutes } from "./routes/projects/refresh.ts";
import { templateOverrideRoutes } from "./routes/projects/template-overrides.ts";
import { scopedArticleRoutes } from "./routes/projects/articles.ts";
import { scopedBriefRoutes } from "./routes/projects/briefs.ts";
import { scopedPillarRoutes } from "./routes/projects/pillars.ts";
import { scopedPipelineRunsRoutes } from "./routes/projects/pipeline-runs.ts";
import { articleStandaloneRoutes } from "./routes/projects/articles-standalone.ts";

const env = getEnv();
const log = createLogger("api");

bootstrapTemplates();

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

// Local-dev static uploads (served when R2 is not configured — images saved to ./uploads/)
// Path traversal guard: reject any request containing ".." before serveStatic runs.
app.use("/uploads/*", async (c, next) => {
  if (c.req.path.includes("..")) return c.json({ ok: false, error: "Not Found" }, 404);
  await next();
});
app.use("/uploads/*", serveStatic({ root: "./" }));

// Render outputs — preview slides written by template preview API (Spec 54d)
app.use("/renders/*", async (c, next) => {
  if (c.req.path.includes("..")) return c.json({ ok: false, error: "Not Found" }, 404);
  await next();
});
app.use("/renders/*", serveStatic({ root: "./" }));

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
app.route("/api", cornerstoneSpecRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/push", pushSubscriptionRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/articles", socialPostRoutes);
app.route("/api/social-posts", socialPostDetailRoutes);
app.route("/api/template-renders", templateRenderDetailRoutes);
app.route("/api/projects", brandAssetRoutes);
app.route("/api/projects", brandTokenRoutes);
app.route("/api/projects", socialPostBatchRoutes);
app.route("/api/projects", trendRoutes);
app.route("/api/projects", clusterCreatorRoutes);
app.route("/api/projects", clusterFullPlanRoutes);
app.route("/api/projects", projectSearchRoutes);
app.route("/api/projects", projectCostSummaryRoutes);
app.route("/api/projects", pipelineEventsRoutes);
app.route("/api/projects", scopedArticleRoutes);
app.route("/api/projects", scopedBriefRoutes);
app.route("/api/projects", scopedPillarRoutes);
app.route("/api/projects", scopedPipelineRunsRoutes);
app.route("/api/projects", articleStandaloneRoutes);
app.route("/api/projects", projectCronRoutes);
app.route("/api/projects", projectRefreshRoutes);
app.route("/api/projects", templateOverrideRoutes);

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
