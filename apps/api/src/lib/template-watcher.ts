/**
 * Spec 65.0 Day 3 — Template filesystem watcher (API process).
 *
 * Watches `packages/social/src/templates/definitions/*.ts` for additions,
 * changes, and deletions. On every event:
 *   - add/change → `syncOneTemplateFromFile()` re-imports + replaces the
 *     in-memory registry entry + UPSERTs the DB row + publishes a
 *     `templates:changed` event for worker processes.
 *   - unlink → marks the DB row inactive (sweep), keeps the in-memory entry
 *     until the next restart (in-memory removal is risky for renders in
 *     flight).
 *
 * Production posture per Spec 65.0 §13 Q3: hot-reload runs in prod too;
 * deploy = git-push not docker-rebuild.
 */
import { resolve } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { createLogger } from "@marketing-auto/shared";
import { publishTemplateChangeEvent } from "@marketing-auto/core/events";
import {
  db,
  eq,
  templates,
  isNull,
  and,
} from "@marketing-auto/db";
import {
  REPO_ROOT,
  syncOneTemplateFromFile,
} from "./template-registry-sync.ts";

const log = createLogger("template-watcher");

/**
 * Repo-root-relative glob that chokidar walks. Resolved to absolute against
 * REPO_ROOT inside `startTemplateWatcher` so the watcher works regardless
 * of the API process's working directory.
 */
const WATCH_GLOB_RELATIVE = "packages/social/src/templates/definitions/*.ts";

interface WatcherOptions {
  /**
   * Override the default `packages/social/src/templates/definitions/*.ts`
   * glob — tests can point at a temp directory.
   */
  globOverride?: string;
  /**
   * When false, suppress the additional 500ms post-debounce settle window.
   * Used in tests to keep event delivery synchronous.
   */
  debouncePostSettle?: boolean;
  /** null = global templates (default); UUID = project-scoped. */
  projectId?: string | null;
}

/**
 * Maintains the path→key reverse lookup needed on `unlink` (the file is
 * gone by the time chokidar fires, so we can't dynamic-import to recover
 * the key). Populated on every successful add/change tick.
 */
const pathToKey = new Map<string, string>();

function debounce<A extends unknown[]>(
  fn: (...args: A) => void | Promise<void>,
  ms: number,
): (...args: A) => void {
  let timer: NodeJS.Timeout | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void fn(...args);
    }, ms);
  };
}

/**
 * Start the watcher. Returns the underlying FSWatcher so callers can
 * `.close()` it on graceful shutdown. Errors during initial setup are
 * logged + swallowed — a watcher failure must never crash the API process.
 */
export function startTemplateWatcher(opts?: WatcherOptions): FSWatcher | null {
  const projectId = opts?.projectId ?? null;
  const glob = opts?.globOverride
    ? opts.globOverride
    : resolve(REPO_ROOT, WATCH_GLOB_RELATIVE);

  let watcher: FSWatcher;
  try {
    watcher = watch(glob, {
      persistent: true,
      ignoreInitial: true, // bootstrap-sync handles the initial scan
      // syncOneTemplateFromFile() creates sibling `.<base>.<hash>.ts`
      // cache-copies for Bun's path-based import cache; the watcher MUST
      // ignore them or it would re-fire on every cache write.
      ignored: /(^|[/\\])\..+\.ts$/,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });
  } catch (err) {
    log.warn({ err, glob }, "Failed to start template filesystem watcher");
    return null;
  }

  const handleAddOrChange = async (path: string, eventName: "add" | "change") => {
    try {
      const result = await syncOneTemplateFromFile({
        filePath: path,
        projectId,
        publish: true,
      });
      pathToKey.set(path, result.template.key);
      log.info(
        {
          path,
          eventName,
          templateKey: result.template.key,
          status: result.status,
        },
        "Template file change synced",
      );
    } catch (err) {
      log.warn({ err, path, eventName }, "Failed to sync template file change");
    }
  };

  const handleUnlink = async (path: string) => {
    const key = pathToKey.get(path);
    if (!key) {
      log.warn(
        { path },
        "Template file deleted but key not tracked — no DB row to deactivate",
      );
      return;
    }
    pathToKey.delete(path);
    try {
      await db
        .update(templates)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            projectId === null
              ? isNull(templates.projectId)
              : eq(templates.projectId, projectId),
            eq(templates.templateKey, key),
            eq(templates.isActive, true),
          ),
        );
      void publishTemplateChangeEvent({
        type: "template.removed",
        templateKey: key,
        filePath: path,
        fileHash: null,
        projectId,
        occurredAt: new Date().toISOString(),
      });
      log.info({ path, templateKey: key }, "Template file removed — DB row deactivated");
    } catch (err) {
      log.warn({ err, path, templateKey: key }, "Failed to deactivate template DB row");
    }
  };

  // chokidar already debounces via awaitWriteFinish; the extra 500ms layer
  // smooths bursts where Claude Code writes multiple files in sequence (per
  // Spec 65.0 §5.1). Tests can disable.
  const postDebounceMs = opts?.debouncePostSettle === false ? 0 : 500;
  const debouncedAdd = postDebounceMs > 0
    ? debounce((p: string) => handleAddOrChange(p, "add"), postDebounceMs)
    : (p: string) => void handleAddOrChange(p, "add");
  const debouncedChange = postDebounceMs > 0
    ? debounce((p: string) => handleAddOrChange(p, "change"), postDebounceMs)
    : (p: string) => void handleAddOrChange(p, "change");
  const debouncedUnlink = postDebounceMs > 0
    ? debounce((p: string) => handleUnlink(p), postDebounceMs)
    : (p: string) => void handleUnlink(p);

  watcher
    .on("add", debouncedAdd)
    .on("change", debouncedChange)
    .on("unlink", debouncedUnlink)
    .on("error", (err: unknown) => {
      log.warn({ err }, "Template watcher emitted an error");
    });

  log.info({ glob, projectId: projectId ?? "global" }, "Template filesystem watcher started");
  return watcher;
}

/**
 * Test-only: reset the path→key map. Production callers never need this —
 * the map naturally rebuilds via add/change events.
 */
export function _resetWatcherStateForTest(): void {
  pathToKey.clear();
}
