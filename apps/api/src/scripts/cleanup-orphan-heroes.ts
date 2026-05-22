/**
 * Spec 64.10: cleanup of orphaned hero-image R2 keys.
 *
 * Iterates R2 keys under a storage prefix (default: "toolwiki/articles/hero"),
 * cross-references them against `articles.hero_image_r2_key` +
 * `articles.hero_image_original_r2_key` (Spec 64.6c backfill column), and
 * optionally deletes keys with no DB reference.
 *
 * The script protects Astro responsive-image artifacts (slug-named .webp / .avif
 * files emitted by the static-site build, NOT pipeline output) via a strict
 * UUID-shape filter — only `<uuid>.<ext>` (or `originals/<uuid>.<ext>`) keys are
 * considered as orphan candidates. Anything else is skipped silently.
 *
 * Default mode is dry-run. Pass `--apply` to actually delete.
 *
 * Usage:
 *   bun --filter @marketing-auto/api cleanup-orphan-heroes [flags]
 *
 * Flags:
 *   --project <slug>          Resolves <slug> to a project and uses its slug as
 *                             the storage prefix (e.g. "toolwiki/articles/hero").
 *                             Mutually exclusive with --storage-prefix.
 *   --storage-prefix <path>   Explicit prefix to list. Default:
 *                             "toolwiki/articles/hero" (Toolwiki defaults).
 *   --apply                   Actually delete orphans. Without this flag the
 *                             script logs what it WOULD delete and exits.
 */

import { deleteObject, listObjects } from "@marketing-auto/adapter-storage";
import { articles, db, eq, isNotNull, or, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { parseArgs } from "node:util";

const log = createLogger("cleanup-orphan-heroes");

// `<uuid>.webp|jpg|png` (case-insensitive). Anchored on both ends so any
// affix (e.g. Astro's `-16x9-1280.webp`) is rejected as not-a-pipeline-key.
const UUID_FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|jpeg|png)$/i;

// Spec 64.6c: the WebP adapter stores the pre-conversion bytes under
// `<prefix>/originals/<uuid>.<original-ext>`. The original keeps its native
// extension (jpg / png / etc.), so widen the alternation.
const ORIGINAL_FILENAME_PATTERN =
  /^originals\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|jpeg|png)$/i;

export interface CleanupOptions {
  projectSlug?: string;
  storagePrefix: string;
  dryRun: boolean;
  storage?: StoragePort;
  database?: DatabasePort;
}

export interface StoragePort {
  list: (input: { prefix: string }) => Promise<string[]>;
  delete: (key: string) => Promise<boolean>;
}

export interface DatabasePort {
  loadReferencedKeys: () => Promise<Set<string>>;
}

export interface CleanupSummary {
  prefix: string;
  totalKeys: number;
  candidateKeys: number;
  skippedNonUuidKeys: number;
  orphanedKeys: number;
  deletedKeys: number;
  retainedKeys: number;
  errors: Array<{ key: string; error: string }>;
  sampleOrphans: string[];
}

function isPipelineHeroKey(prefix: string, fullKey: string): boolean {
  if (!fullKey.startsWith(`${prefix}/`)) return false;
  const relative = fullKey.slice(prefix.length + 1);
  return UUID_FILENAME_PATTERN.test(relative) || ORIGINAL_FILENAME_PATTERN.test(relative);
}

const defaultDatabase: DatabasePort = {
  async loadReferencedKeys() {
    const rows = await db
      .select({
        heroImageR2Key: articles.heroImageR2Key,
        heroImageOriginalR2Key: articles.heroImageOriginalR2Key,
      })
      .from(articles)
      .where(or(isNotNull(articles.heroImageR2Key), isNotNull(articles.heroImageOriginalR2Key)));

    const set = new Set<string>();
    for (const row of rows) {
      if (row.heroImageR2Key) set.add(row.heroImageR2Key);
      if (row.heroImageOriginalR2Key) set.add(row.heroImageOriginalR2Key);
    }
    return set;
  },
};

const defaultStorage: StoragePort = {
  list: ({ prefix }) => listObjects({ prefix }),
  delete: (key) => deleteObject(key),
};

export async function cleanupOrphanHeroes(opts: CleanupOptions): Promise<CleanupSummary> {
  const storage = opts.storage ?? defaultStorage;
  const database = opts.database ?? defaultDatabase;

  log.info(
    { prefix: opts.storagePrefix, projectSlug: opts.projectSlug, dryRun: opts.dryRun },
    "starting orphan-hero cleanup",
  );

  const allKeys = await storage.list({ prefix: opts.storagePrefix });
  log.info({ count: allKeys.length, prefix: opts.storagePrefix }, "listed storage keys");

  const referencedSet = await database.loadReferencedKeys();
  log.info({ count: referencedSet.size }, "loaded DB-referenced hero keys");

  const candidates: string[] = [];
  let skippedNonUuid = 0;
  for (const key of allKeys) {
    if (isPipelineHeroKey(opts.storagePrefix, key)) {
      candidates.push(key);
    } else {
      skippedNonUuid++;
    }
  }

  const orphans = candidates.filter((k) => !referencedSet.has(k));
  log.info(
    {
      total: allKeys.length,
      candidates: candidates.length,
      skippedNonUuid,
      orphans: orphans.length,
    },
    "identified orphan keys",
  );

  const summary: CleanupSummary = {
    prefix: opts.storagePrefix,
    totalKeys: allKeys.length,
    candidateKeys: candidates.length,
    skippedNonUuidKeys: skippedNonUuid,
    orphanedKeys: orphans.length,
    deletedKeys: 0,
    retainedKeys: candidates.length - orphans.length,
    errors: [],
    sampleOrphans: orphans.slice(0, 10),
  };

  if (opts.dryRun) {
    log.info(
      { sample: summary.sampleOrphans },
      "DRY RUN — listing first 10 orphan keys; pass --apply to delete",
    );
    return summary;
  }

  for (const key of orphans) {
    try {
      const ok = await storage.delete(key);
      if (ok) {
        summary.deletedKeys++;
        log.info({ key }, "deleted orphan key");
      } else {
        summary.errors.push({ key, error: "storage.delete returned false" });
        log.warn({ key }, "storage.delete returned false");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ key, error: message });
      log.error({ key, err }, "failed to delete orphan");
    }
  }

  log.info(summary, "cleanup complete");
  return summary;
}

interface ResolvedCliArgs {
  projectSlug?: string;
  storagePrefix: string;
  dryRun: boolean;
}

export async function parseCliArgs(argv: string[]): Promise<ResolvedCliArgs> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      "storage-prefix": { type: "string" },
      apply: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.project && values["storage-prefix"]) {
    throw new Error("--project and --storage-prefix are mutually exclusive");
  }

  let storagePrefix = values["storage-prefix"] ?? "toolwiki/articles/hero";

  if (values.project) {
    const rows = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.slug, values.project))
      .limit(1);
    if (rows.length === 0) {
      throw new Error(`project not found: ${values.project}`);
    }
    storagePrefix = `${rows[0]!.slug}/articles/hero`;
  }

  return {
    ...(values.project ? { projectSlug: values.project } : {}),
    storagePrefix,
    dryRun: !values.apply,
  };
}

async function main(): Promise<void> {
  const args = await parseCliArgs(process.argv.slice(2));
  const summary = await cleanupOrphanHeroes(args);
  log.info({ summary }, "exit");
  process.exit(summary.errors.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
  });
}
