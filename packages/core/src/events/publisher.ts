import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";
import type { PipelineEvent } from "./pipeline-events.ts";

const log = createLogger("core:events");

let _publisher: IORedis | null = null;

function getPublisher(): IORedis {
  if (_publisher) return _publisher;
  const env = getEnv();
  _publisher = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  _publisher.on("error", (err) => log.warn({ err }, "Pipeline event publisher Redis error"));
  return _publisher;
}

export function channelForProject(projectId: string): string {
  return `pipeline:events:project:${projectId}`;
}

export async function publishPipelineEvent(projectId: string, event: PipelineEvent): Promise<void> {
  try {
    const publisher = getPublisher();
    await publisher.publish(channelForProject(projectId), JSON.stringify(event));
  } catch (err) {
    // Non-fatal — SSE events are best-effort; pipeline execution must not fail due to pub/sub errors
    log.warn({ err, projectId, eventType: event.type }, "Failed to publish pipeline event");
  }
}
