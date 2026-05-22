/**
 * Spec 64.6c: historical-backfill for hero images that predate the
 * @marketing-auto/adapter-image-webp pipeline.
 *
 * For each article with `hero_image_r2_key IS NOT NULL AND hero_image_original_r2_key IS NULL`:
 *  1. Download bytes from R2
 *  2. Sniff actual format via magic bytes (cannot trust the R2 content-type header
 *     — Spec 64.6 Discovery #14 showed Gemini set image/webp on PNG bytes)
 *  3. Skip when sniffed === "webp" (set hero_image_original_r2_key = the existing
 *     key so subsequent runs see "processed" — same column doubles as a marker)
 *  4. Otherwise convert via convertImageToWebp + swap the canonical key:
 *     - hero_image_r2_key -> new WebP key
 *     - hero_image_public_url -> new WebP URL
 *     - hero_image_original_r2_key -> the prior key (forensic)
 *
 * Idempotent: the partial-index on `hero_image_original_r2_key IS NULL` means
 * a re-run only picks up articles still missing the column. Pass `--dry-run` to
 * count + report what would change without writing.
 *
 * Usage:
 *   bun --filter @marketing-auto/api convert-existing-heroes [<project-slug>] [--dry-run]
 */

import { convertImageToWebp, sniffImageFormat } from "@marketing-auto/adapter-image-webp";
import { getFile } from "@marketing-auto/adapter-storage";
import { articles, db, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

const log = createLogger("convert-existing-heroes");

interface ProcessResult {
  articleId: string;
  slug: string | null;
  action: "already-webp-marked" | "converted" | "skip-r2-error" | "skip-empty" | "dry-run";
  fromFormat: string;
  toFormat: string;
  fromKey: string;
  toKey: string | null;
  bytes: number | null;
}

async function processArticle(
  article: {
    id: string;
    slug: string | null;
    projectId: string;
    projectSlug: string;
    heroImageR2Key: string;
    heroImageOriginalR2Key: string | null;
  },
  options: { dryRun: boolean }
): Promise<ProcessResult> {
  const base: Omit<ProcessResult, "action" | "fromFormat" | "toFormat" | "toKey" | "bytes"> = {
    articleId: article.id,
    slug: article.slug,
    fromKey: article.heroImageR2Key,
  };

  // Defence: if the prior backfill stamped original_r2_key, skip.
  if (article.heroImageOriginalR2Key) {
    return { ...base, action: "already-webp-marked", fromFormat: "skipped", toFormat: "skipped", toKey: null, bytes: null };
  }

  // Download + sniff
  let bytes: Uint8Array;
  try {
    const file = await getFile(article.heroImageR2Key);
    const arrayBuffer = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuffer);
  } catch (err) {
    log.warn(
      { err, articleId: article.id, key: article.heroImageR2Key },
      "convert-existing-heroes: R2 download failed — skipping",
    );
    return { ...base, action: "skip-r2-error", fromFormat: "unknown", toFormat: "unknown", toKey: null, bytes: null };
  }

  if (bytes.length === 0) {
    return { ...base, action: "skip-empty", fromFormat: "empty", toFormat: "empty", toKey: null, bytes: null };
  }

  const sniffed = sniffImageFormat(bytes);

  // Already WebP per magic bytes → just stamp the marker column (set original = canonical).
  // This is safe: re-runs will see the column populated and skip. R2 storage cost is the same.
  if (sniffed === "webp") {
    if (!options.dryRun) {
      // CAS guard: only stamp the marker if no concurrent pipeline run filled it in
      // between our SELECT and this UPDATE. Defensive — this script is manual-run only,
      // but pre-empts a future "called from a worker on a schedule" misuse.
      await db
        .update(articles)
        .set({ heroImageOriginalR2Key: article.heroImageR2Key })
        .where(and(eq(articles.id, article.id), isNull(articles.heroImageOriginalR2Key)));
    }
    return {
      ...base,
      action: options.dryRun ? "dry-run" : "already-webp-marked",
      fromFormat: "webp",
      toFormat: "webp",
      toKey: article.heroImageR2Key,
      bytes: bytes.length,
    };
  }

  // Convert path. Upload new WebP + new original copy (under /originals/), then swap.
  if (options.dryRun) {
    return {
      ...base,
      action: "dry-run",
      fromFormat: sniffed,
      toFormat: "webp",
      toKey: null,
      bytes: bytes.length,
    };
  }

  // Strip the filename portion of the existing key so the new WebP lands under the
  // same logical prefix (e.g. "toolwiki/articles/hero" — NOT under a /<uuid>/ subpath).
  const lastSlash = article.heroImageR2Key.lastIndexOf("/");
  const storagePrefix =
    lastSlash > 0 ? article.heroImageR2Key.slice(0, lastSlash) : `${article.projectSlug}/articles/hero`;

  const converted = await convertImageToWebp({
    projectId: article.projectId,
    bytes,
    contentType: `image/${sniffed}`,
    storagePrefix,
  });

  // CAS guard on the UPDATE — prevents clobbering a fresh pipeline write that
  // raced between our SELECT and this point. If the WHERE doesn't match, the
  // script silently no-ops on this row (count check below for observability).
  const updated = await db
    .update(articles)
    .set({
      heroImageR2Key: converted.webpKey,
      heroImagePublicUrl: converted.webpUrl,
      // Forensic: prefer the new "originals/" copy from convertImageToWebp; fall back
      // to the prior canonical key if for some reason the adapter didn't keep a copy.
      heroImageOriginalR2Key: converted.originalKey ?? article.heroImageR2Key,
    })
    .where(and(eq(articles.id, article.id), isNull(articles.heroImageOriginalR2Key)))
    .returning({ id: articles.id });

  if (updated.length === 0) {
    log.warn(
      { articleId: article.id, newWebpKey: converted.webpKey, newOriginalKey: converted.originalKey },
      "convert-existing-heroes: row was filled in by a concurrent process — uploaded artifacts are orphans",
    );
  }

  return {
    ...base,
    action: "converted",
    fromFormat: sniffed,
    toFormat: "webp",
    toKey: converted.webpKey,
    bytes: converted.webpBytes,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const slug = args.find((a) => !a.startsWith("--"));

  log.info({ slug, dryRun }, "convert-existing-heroes: starting");

  // Resolve project filter to projectId (script-time concern; one JOIN keeps the inner
  // SELECT cheap and lets us preserve project_slug for logging).
  const projectFilter = slug
    ? await db
        .select({ id: projects.id, slug: projects.slug })
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1)
    : null;
  if (slug && (!projectFilter || projectFilter.length === 0)) {
    log.error({ slug }, "convert-existing-heroes: project not found");
    process.exit(1);
  }
  const projectId = projectFilter?.[0]?.id;

  const whereCond = projectId
    ? and(
        eq(articles.projectId, projectId),
        isNotNull(articles.heroImageR2Key),
        isNull(articles.heroImageOriginalR2Key),
      )
    : and(isNotNull(articles.heroImageR2Key), isNull(articles.heroImageOriginalR2Key));

  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      heroImageR2Key: articles.heroImageR2Key,
      heroImageOriginalR2Key: articles.heroImageOriginalR2Key,
      projectId: projects.id,
      projectSlug: projects.slug,
    })
    .from(articles)
    .innerJoin(projects, eq(articles.projectId, projects.id))
    .where(whereCond);

  log.info({ count: rows.length }, "convert-existing-heroes: candidates to process");

  const summary = {
    converted: 0,
    "already-webp-marked": 0,
    "skip-r2-error": 0,
    "skip-empty": 0,
    "dry-run": 0,
  };

  for (const row of rows) {
    // Defensive narrow — the inner-JOIN shape Drizzle returns guarantees these but TS doesn't.
    if (!row.heroImageR2Key || !row.projectSlug) continue;
    const result = await processArticle(
      {
        id: row.id,
        slug: row.slug,
        projectId: row.projectId,
        projectSlug: row.projectSlug,
        heroImageR2Key: row.heroImageR2Key,
        heroImageOriginalR2Key: row.heroImageOriginalR2Key,
      },
      { dryRun },
    );
    summary[result.action] = (summary[result.action] ?? 0) + 1;
    log.info(result, "convert-existing-heroes: processed");
  }

  log.info(summary, "convert-existing-heroes: done");
  process.exit(0);
}

main().catch((e) => {
  log.error({ err: e }, "convert-existing-heroes: fatal");
  process.exit(1);
});
