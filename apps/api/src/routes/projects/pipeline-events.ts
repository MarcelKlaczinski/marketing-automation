import { channelForProject } from "@marketing-auto/core/events";
import type { PipelineEvent } from "@marketing-auto/core/events";
import { db, eq, projects } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import IORedis from "ioredis";
import { requireAuth } from "../../middleware/auth.ts";

const log = createLogger("api:pipeline-events");

export const pipelineEventsRoutes = new Hono();
pipelineEventsRoutes.use(requireAuth);

pipelineEventsRoutes.get("/:slug/pipeline-events", async (c) => {
  const { slug } = c.req.param();

  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  return streamSSE(c, async (stream) => {
    const env = getEnv();
    const subscriber = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const channel = channelForProject(project.id);
    let isOpen = true;

    subscriber.on("error", (err) => {
      log.warn({ err, projectId: project.id }, "SSE Redis subscriber error");
    });

    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ projectId: project.id, timestamp: new Date().toISOString() }),
    });

    await subscriber.subscribe(channel);

    subscriber.on("message", (_ch: string, message: string) => {
      if (!isOpen) return;
      try {
        const event = JSON.parse(message) as PipelineEvent;
        void stream.writeSSE({ event: event.type, data: message });
      } catch (err) {
        log.error({ err }, "Failed to parse pipeline event from Redis");
      }
    });

    const heartbeatInterval = setInterval(() => {
      if (!isOpen) return;
      const hb = JSON.stringify({ timestamp: new Date().toISOString() });
      void stream.writeSSE({ event: "heartbeat", data: hb }).catch(() => {
        isOpen = false;
      });
    }, 30_000);

    stream.onAbort(async () => {
      isOpen = false;
      clearInterval(heartbeatInterval);
      try {
        await subscriber.unsubscribe(channel);
        await subscriber.quit();
      } catch {
        // ignore cleanup errors
      }
    });

    // Keep stream open until client disconnects
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (!isOpen) {
          clearInterval(poll);
          resolve();
        }
      }, 500);
    });
  });
});
