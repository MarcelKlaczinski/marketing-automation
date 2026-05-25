/**
 * Spec 65.0 Day 3 — Template change subscriber (worker process).
 *
 * Counterpart to `template-watcher.ts`. Workers can't watch the filesystem
 * (they'd duplicate events; the watcher canon is the API process), so they
 * subscribe to the global `templates:changed` Redis channel and re-import
 * locally when notified. The DB stays authoritative — workers can also
 * resync from the `templates` table on startup via
 * `bootstrapAndSyncTemplates`.
 *
 * Subscriber passes `publish: false` to `syncOneTemplateFromFile` so the
 * worker's local sync doesn't re-broadcast (feedback-loop guard).
 */
import IORedis from "ioredis";
import { createLogger, getEnv } from "@marketing-auto/shared";
import {
  TEMPLATE_EVENTS_CHANNEL,
  templateChangeEventSchema,
} from "@marketing-auto/core/events";
import { syncOneTemplateFromFile } from "./template-registry-sync.ts";

const log = createLogger("template-change-subscriber");

let _subscriber: IORedis | null = null;

/**
 * Start the change subscriber. Returns the underlying IORedis instance so
 * graceful shutdown can `.quit()` it. Errors during setup are logged +
 * swallowed — worker startup must never block on a broken Redis.
 */
export function startTemplateChangeSubscriber(): IORedis | null {
  if (_subscriber) return _subscriber;
  try {
    const env = getEnv();
    const subscriber = new IORedis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
    subscriber.on("error", (err) =>
      log.warn({ err }, "Template change subscriber Redis error"),
    );

    void subscriber.subscribe(TEMPLATE_EVENTS_CHANNEL).catch((err) =>
      log.warn({ err }, "Failed to subscribe to templates:changed channel"),
    );

    subscriber.on("message", (_channel, raw) => {
      void handleMessage(raw);
    });

    _subscriber = subscriber;
    log.info({ channel: TEMPLATE_EVENTS_CHANNEL }, "Template change subscriber started");
    return subscriber;
  } catch (err) {
    log.warn({ err }, "Failed to start template change subscriber");
    return null;
  }
}

async function handleMessage(raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn({ err, raw }, "Failed to JSON.parse template change event");
    return;
  }

  const result = templateChangeEventSchema.safeParse(parsed);
  if (!result.success) {
    log.warn({ issues: result.error.issues, raw }, "Template change event failed schema");
    return;
  }

  const event = result.data;

  if (event.type === "template.removed") {
    // Worker keeps the stale in-memory entry until restart — removing live
    // could break a render mid-flight. The DB row is already deactivated by
    // the watcher; renders that try to use this key will eventually fail
    // their eligibility gate.
    log.info(
      { templateKey: event.templateKey, filePath: event.filePath },
      "Template removed event received — leaving in-memory entry until restart",
    );
    return;
  }

  try {
    const synced = await syncOneTemplateFromFile({
      filePath: event.filePath,
      projectId: event.projectId,
      publish: false, // CRITICAL: prevent feedback loop
    });
    log.info(
      {
        templateKey: synced.template.key,
        eventType: event.type,
        status: synced.status,
      },
      "Worker mirrored template change",
    );
  } catch (err) {
    log.warn(
      { err, templateKey: event.templateKey, filePath: event.filePath },
      "Worker failed to mirror template change — staying on prior version until restart",
    );
  }
}

/**
 * Graceful shutdown helper. Workers call this from their SIGTERM handler.
 */
export async function stopTemplateChangeSubscriber(): Promise<void> {
  if (!_subscriber) return;
  try {
    await _subscriber.unsubscribe(TEMPLATE_EVENTS_CHANNEL);
    await _subscriber.quit();
  } catch (err) {
    log.warn({ err }, "Error stopping template change subscriber");
  } finally {
    _subscriber = null;
  }
}
