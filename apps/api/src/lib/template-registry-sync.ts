/**
 * Spec 65.0 — Template Engine bootstrap-sync + hot-reload helpers.
 *
 * Bridges the in-memory `templateRegistry` (registered at startup via
 * `bootstrapTemplates()`) to the DB-backed `templates` table.
 *
 * - `bootstrapAndSyncTemplates()` — one-shot startup hook. Idempotent
 *   (UPSERT + deactivate-missing sweep), DB-failure-tolerant.
 * - `syncOneTemplateFromFile()` — per-file hot-reload entry point. Reads the
 *   file, dynamic-imports it with a hash-keyed cache-bust, replaces the
 *   in-memory registry entry, UPSERTs the DB row, and (optionally) publishes
 *   a `templates:changed` event for worker processes to mirror locally.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@marketing-auto/shared";
import {
  publishTemplateChangeEvent,
  type TemplateChangeEvent,
} from "@marketing-auto/core/events";
import {
  bootstrapTemplates,
  templateRegistry,
  type TemplateDefinition,
} from "@marketing-auto/social/templates";
import {
  syncTemplatesBatch,
  upsertTemplate,
  type SyncResult,
  type TemplateSyncSpec,
} from "@marketing-auto/db";

const log = createLogger("template-registry-sync");

// Anchor: this file is at apps/api/src/lib/template-registry-sync.ts
// Repo root is 4 levels up.
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(THIS_DIR, "..", "..", "..", "..");

/**
 * Convert a kebab-case template key to its conventional camelCase
 * definition-file name. `comparison-grid-4` → `comparisonGrid4`.
 * Digit-only segments stay as-is (`.toUpperCase()` is a no-op on digits).
 */
export function kebabToCamelKey(key: string): string {
  const segments = key.split("-");
  return segments
    .map((seg, i) => {
      if (i === 0) return seg;
      const head = seg.charAt(0).toUpperCase();
      return head + seg.slice(1);
    })
    .join("");
}

/**
 * Repo-root-relative path to a template's definition file under the
 * current flat layout (`packages/social/src/templates/definitions/`).
 *
 * Day 3+ deviation: when the watcher migrates to per-template directories
 * (e.g. `packages/social/src/templates/<key>/definition.ts` per Spec 65.0
 * §9), this helper switches to checking both shapes — flat for legacy,
 * directory for new.
 */
export function relativeDefinitionPath(templateKey: string): string {
  return `packages/social/src/templates/definitions/${kebabToCamelKey(templateKey)}.ts`;
}

/**
 * Compute the SHA-256 hash of a file's UTF-8 contents. Returns a string
 * prefixed with `hash:` so downstream consumers can distinguish from
 * future git-sha-prefixed values.
 */
export async function computeFileHash(absPath: string): Promise<string> {
  const content = await readFile(absPath, "utf-8");
  const hex = createHash("sha256").update(content).digest("hex");
  return `hash:${hex}`;
}

/**
 * Pure helper: build the TemplateSyncSpec the DB layer expects from an
 * in-memory TemplateDefinition + filesystem anchor + content hash.
 * Extracted so the bootstrap-sync (batch over all templates) and the
 * per-file hot-reload share one source of truth.
 */
export function buildSpecFromTemplate(
  template: TemplateDefinition,
  opts: { filePath: string; fileHash: string },
): TemplateSyncSpec {
  return {
    templateKey: template.key,
    baseTemplateKey: template.key, // V1: no variant suffixes yet
    variant: null,
    filePath: opts.filePath,
    fileHash: opts.fileHash,
    formatTypes: [template.plannerMeta.contentType],
    outputFormat: template.outputFormat,
    compatibleChannels: [...template.compatibleChannels],
    generationClass: template.generationClass,
    displayName: template.displayName,
    description: template.description,
    defaultSlideCount: template.defaultSlideCount,
    estimatedCostUsd: template.estimatedCostUsd,
  };
}

/**
 * Walks the in-memory registry and builds the spec list the DB sync expects.
 * Each template's filepath is resolved by convention; if the file does NOT
 * exist on disk the template is skipped (logged warn) — preserves the
 * "log + skip" decision from Spec 65.0 Q5.
 */
export async function buildSpecsFromInMemoryRegistry(): Promise<TemplateSyncSpec[]> {
  const all = templateRegistry.list();
  const specs: TemplateSyncSpec[] = [];
  for (const t of all) {
    const relPath = relativeDefinitionPath(t.key);
    const absPath = resolve(REPO_ROOT, relPath);
    try {
      const fileHash = await computeFileHash(absPath);
      specs.push(buildSpecFromTemplate(t, { filePath: relPath, fileHash }));
    } catch (err) {
      log.warn(
        { templateKey: t.key, relPath, err },
        "Skipping template — definition file unreadable",
      );
    }
  }
  return specs;
}

/**
 * One-shot startup hook: bootstrap the in-memory registry + push metadata
 * to the DB. Returns the sync diff for logging. Errors are caught and
 * logged warn so a DB hiccup never blocks server startup — the in-memory
 * registry is the authoritative read-path for renders.
 */
export async function bootstrapAndSyncTemplates(opts?: {
  projectId?: string | null;
}): Promise<SyncResult | null> {
  bootstrapTemplates();
  try {
    const specs = await buildSpecsFromInMemoryRegistry();
    const result = await syncTemplatesBatch({
      projectId: opts?.projectId ?? null,
      specs,
    });
    log.info(
      {
        scope: opts?.projectId ?? "global",
        ...result,
      },
      "Synced template registry to DB",
    );
    return result;
  } catch (err) {
    log.warn({ err }, "Template registry DB-sync failed — continuing with in-memory only");
    return null;
  }
}

/**
 * Type-guard: does this exported value look like a TemplateDefinition?
 * Used to find the right export when dynamic-importing a definition file
 * without hardcoding the export name.
 */
function looksLikeTemplate(v: unknown): v is TemplateDefinition {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.key === "string"
    && typeof obj.buildInput === "function"
    && typeof obj.render === "function"
    && typeof obj.eligibility === "function"
    && typeof obj.plannerMeta === "object"
    && obj.plannerMeta !== null
  );
}

export interface SyncOneTemplateOptions {
  /** Absolute or repo-root-relative path to the definition file. */
  filePath: string;
  /** null/undefined = global (default); UUID = project-scoped. */
  projectId?: string | null;
  /**
   * When true (default), fires a `templates:changed` Redis event after the
   * DB upsert so workers can mirror the update locally. Subscribers pass
   * `publish: false` to prevent feedback loops.
   */
  publish?: boolean;
}

export interface SyncOneTemplateResult {
  template: TemplateDefinition;
  status: "added" | "updated" | "unchanged";
  spec: TemplateSyncSpec;
}

/**
 * Re-read one definition file from disk, dynamic-import it with a
 * hash-keyed cache-bust, replace the in-memory registry entry, and UPSERT
 * the DB row. Errors propagate to the caller — watcher/subscriber wrap in
 * try/catch and log.
 */
export async function syncOneTemplateFromFile(
  opts: SyncOneTemplateOptions,
): Promise<SyncOneTemplateResult> {
  const absPath = isAbsolute(opts.filePath)
    ? opts.filePath
    : resolve(REPO_ROOT, opts.filePath);
  const relPath = isAbsolute(opts.filePath)
    ? relativeFromRepoRoot(absPath)
    : opts.filePath;

  const fileHash = await computeFileHash(absPath);

  // Bun caches dynamic-import by absolute file PATH, ignoring URL query
  // strings — so `?v=<hash>` doesn't bust the cache. To force a fresh
  // load, we copy the file to a sibling dot-prefixed path with the hash
  // embedded in the filename. The cache copy lives in the SAME directory
  // so the template's relative imports (`../types.ts` etc.) resolve
  // identically. Chokidar's watcher ignores dotfiles via its `ignored`
  // regex, so the copy doesn't re-trigger the watcher.
  const cachePath = cacheCopyPathFor(absPath, fileHash);
  const content = await readFile(absPath, "utf-8");
  await writeFile(cachePath, content);
  const mod = (await import(cachePath)) as Record<string, unknown>;

  const template = Object.values(mod).find(looksLikeTemplate);
  if (!template) {
    throw new Error(
      `Definition file ${relPath} has no exported TemplateDefinition shape`,
    );
  }

  templateRegistry.replace(template);

  const spec = buildSpecFromTemplate(template, { filePath: relPath, fileHash });
  const projectId = opts.projectId ?? null;
  const upsertResult = await upsertTemplate(spec, projectId);

  if (opts.publish !== false) {
    const event: TemplateChangeEvent = {
      type: upsertResult.status === "added" ? "template.added" : "template.changed",
      templateKey: template.key,
      filePath: relPath,
      fileHash,
      projectId,
      occurredAt: new Date().toISOString(),
    };
    void publishTemplateChangeEvent(event);
  }

  return { template, status: upsertResult.status, spec };
}

/**
 * Convert an absolute path back to repo-root-relative. Falls back to the
 * absolute path when the file lives outside the repo (shouldn't happen
 * in practice — caller bug).
 */
function relativeFromRepoRoot(absPath: string): string {
  if (absPath.startsWith(`${REPO_ROOT}/`)) {
    return absPath.slice(REPO_ROOT.length + 1);
  }
  return absPath;
}

/**
 * Build the sibling dot-prefixed cache-copy path for a given template
 * definition file + content hash. Pattern: `.<base>.<hash-prefix>.ts`.
 * Hash prefix is the first 16 hex chars (after the `hash:` marker) — long
 * enough to be collision-free in practice, short enough to keep filenames
 * readable. The leading dot ensures chokidar's dotfile-ignore regex
 * skips this file (preventing watcher feedback loops).
 */
export function cacheCopyPathFor(absPath: string, fileHash: string): string {
  const dir = dirname(absPath);
  const ext = extname(absPath);
  const base = basename(absPath, ext);
  // Strip the `hash:` prefix before slicing so callers get a clean filename.
  const hashHex = fileHash.startsWith("hash:") ? fileHash.slice(5) : fileHash;
  const shortHash = hashHex.slice(0, 16);
  return join(dir, `.${base}.${shortHash}${ext}`);
}

const CACHE_COPY_PATTERN = /^\..+\.[0-9a-f]{16}\.ts$/;

/**
 * Sweep cache-copy files older than `maxAgeMs` (default 1h) from a
 * directory. Run on startup + occasionally during long-lived processes
 * so the templates directory doesn't accumulate stale dotfiles.
 *
 * Returns the count of files deleted. Silent on individual unlink errors
 * (file may have been removed by a sibling sweep).
 */
export async function cleanupStaleCacheCopies(opts: {
  directory: string;
  maxAgeMs?: number;
}): Promise<number> {
  const cutoff = Date.now() - (opts.maxAgeMs ?? 60 * 60 * 1000);
  let deleted = 0;
  try {
    // Bun's `readdir(..., {withFileTypes:true})` has a quirky typedef; use
    // plain `readdir` + `Bun.file().stat()` per the workspace-wide convention
    // (root CLAUDE.md "DO NOT use `{withFileTypes: true}`").
    const names = await readdir(opts.directory);
    for (const name of names) {
      if (!CACHE_COPY_PATTERN.test(name)) continue;
      const absPath = join(opts.directory, name);
      try {
        const stat = await Bun.file(absPath).stat();
        // `<=` so `maxAgeMs: 0` (boot-time sweep) deletes everything,
        // including files written in the same millisecond as the call.
        if (stat.mtimeMs <= cutoff) {
          await unlink(absPath);
          deleted += 1;
        }
      } catch {
        // Best-effort — race against another sweep, or file already gone.
      }
    }
  } catch (err) {
    log.warn({ err, directory: opts.directory }, "Failed to scan cache-copy dir");
  }
  return deleted;
}
