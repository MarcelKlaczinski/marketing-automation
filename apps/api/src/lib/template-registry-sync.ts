/**
 * Spec 65.0 — Template Engine bootstrap-sync.
 *
 * Bridges the in-memory `templateRegistry` (registered at startup via
 * `bootstrapTemplates()`) to the DB-backed `templates` table. Runs once on
 * API startup; idempotent (UPSERT existing rows, deactivate disappeared
 * ones, leave usage stats alone).
 *
 * Day 1-2 scope (Spec 65.0 §14): static template list from the existing
 * `bootstrap.ts`, hardcoded filepath convention. Day 3 will swap in a
 * filesystem-watcher that discovers templates dynamically and calls a
 * similar sync function on every change event.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@marketing-auto/shared";
import {
  bootstrapTemplates,
  templateRegistry,
} from "@marketing-auto/social/templates";
import {
  syncTemplatesBatch,
  type SyncResult,
  type TemplateSyncSpec,
} from "@marketing-auto/db";

const log = createLogger("template-registry-sync");

// Anchor: this file is at apps/api/src/lib/template-registry-sync.ts
// Repo root is 4 levels up.
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, "..", "..", "..", "..");

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

async function computeFileHash(absPath: string): Promise<string> {
  const content = await readFile(absPath, "utf-8");
  const hex = createHash("sha256").update(content).digest("hex");
  return `hash:${hex}`;
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
      specs.push({
        templateKey: t.key,
        baseTemplateKey: t.key, // V1: no variant suffixes yet
        variant: null,
        filePath: relPath,
        fileHash,
        formatTypes: [t.plannerMeta.contentType],
        outputFormat: t.outputFormat,
        compatibleChannels: [...t.compatibleChannels],
        generationClass: t.generationClass,
        displayName: t.displayName,
        description: t.description,
        defaultSlideCount: t.defaultSlideCount,
        estimatedCostUsd: t.estimatedCostUsd,
      });
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
