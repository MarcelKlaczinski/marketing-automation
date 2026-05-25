/**
 * Spec 65.0 Day 3 — Template change events.
 *
 * Single global Redis channel `templates:changed`. The filesystem watcher in
 * the API process publishes here when it detects a definition-file change;
 * workers (which run in separate processes and have stale in-memory registry
 * caches) subscribe and re-import the changed file locally.
 *
 * Events are best-effort: pub/sub failures are logged warn and never block
 * the watcher or the worker. The DB stays authoritative — workers can also
 * resync from `templates` on startup via `bootstrapAndSyncTemplates`.
 */
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";
import { z } from "zod";

const log = createLogger("core:template-events");

export const TEMPLATE_EVENTS_CHANNEL = "templates:changed";

export const templateChangeEventSchema = z.object({
  type: z.enum(["template.added", "template.changed", "template.removed"]),
  templateKey: z.string(),
  filePath: z.string(),
  fileHash: z.string().nullable(),
  // null = global template (Memory D5 multi-tenant exception)
  projectId: z.string().uuid().nullable(),
  occurredAt: z.string(),
});

export type TemplateChangeEvent = z.infer<typeof templateChangeEventSchema>;

let _publisher: IORedis | null = null;

function getPublisher(): IORedis {
  if (_publisher) return _publisher;
  const env = getEnv();
  _publisher = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  _publisher.on("error", (err) =>
    log.warn({ err }, "Template events publisher Redis error"),
  );
  return _publisher;
}

/**
 * Fire-and-forget publish of a template-change event. Never throws.
 * Callers should `void publishTemplateChangeEvent(...)` to make the
 * fire-and-forget intent explicit.
 */
export async function publishTemplateChangeEvent(
  event: TemplateChangeEvent,
): Promise<void> {
  try {
    const publisher = getPublisher();
    await publisher.publish(TEMPLATE_EVENTS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    log.warn({ err, event }, "Failed to publish template change event");
  }
}
