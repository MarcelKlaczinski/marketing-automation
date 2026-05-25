/**
 * Spec 65.2 — backfill `tool_brand_assets` rows for every tool-article in a project.
 *
 * For each article with `collection='tools'` and no matching row in
 * `tool_brand_assets`, resolves the logo via the pipelines chain
 * (simple-icons → iconify → lobe-icons → deterministic avatar), uploads the
 * SVG to R2 when the chain hits, and upserts the row with
 * `needs_review=true` so Marcel can fill colors via the Settings-UI editor.
 *
 * Default mode is dry-run (count of candidates only). Pass `--apply` to actually
 * resolve + upload + write rows.
 *
 * Usage:
 *   bun --filter @marketing-auto/api backfill-tool-brand-assets --project=<slug> [--apply]
 *
 * Flags:
 *   --project <slug>   Project to scope the backfill to (MANDATORY per Memory D26).
 *   --apply            Actually resolve + write. Without this flag the script
 *                      only counts candidates and exits.
 *   --force            Re-process tools that already have a brand-asset row.
 *                      Skips rows where source='manual' so Marcel-uploaded
 *                      custom logos aren't overwritten. Use after a code
 *                      change (e.g. new brandColorHint seeding) when you need
 *                      to refresh the chain-resolved rows.
 *   --batch-size <n>   Page size for the iteration. Default: 50.
 *   --limit <n>        Optional hard cap on total rows processed (test convenience).
 */
import {
  and,
  articles,
  countToolsMissingBrandAssets,
  db,
  eq,
  inArray,
  isNotNull,
  ne,
  listToolsMissingBrandAssets,
  not,
  projects,
  sql,
  toolBrandAssets,
  upsertBrandAsset,
} from "@marketing-auto/db";

/**
 * Strip the BCP-47 region tag (`de-DE` → `de`) so the value matches
 * `articles.locale` which is stored as a 2-letter code. Mirrors the helper
 * in `routes/projects/tool-brand-assets.ts`.
 */
function resolvePrimaryLocale(projectTargetLocales: string[] | null): string {
  const first = projectTargetLocales?.[0];
  if (!first) return "de";
  return first.split("-")[0] ?? "de";
}

/**
 * `--force` mode helpers: select tool-articles whose brand-asset row exists
 * BUT was not manually curated (source != 'manual'). Lets a code change
 * (e.g. brandColorHint seeding) re-process previously-chain-resolved rows
 * without wiping Marcel's custom uploads.
 */
async function countForceCandidates(projectId: string, locale: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .innerJoin(toolBrandAssets, eq(toolBrandAssets.toolId, articles.id))
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.locale, locale),
        ne(toolBrandAssets.source, "manual"),
        isNotNull(toolBrandAssets.toolId),
      ),
    );
  return result[0]?.count ?? 0;
}

async function listForceCandidates(
  projectId: string,
  locale: string,
  limit: number,
  excludeIds: string[] = [],
): Promise<string[]> {
  // Force-mode predicate doesn't shrink as rows get UPDATEd (vs the
  // missing-mode INSERT path which moves rows out of `WHERE NULL`), so
  // pagination needs an explicit exclude-set to avoid replaying the same
  // page indefinitely.
  const conditions = [
    eq(articles.projectId, projectId),
    eq(articles.collection, "tools"),
    eq(articles.locale, locale),
    ne(toolBrandAssets.source, "manual"),
  ];
  if (excludeIds.length > 0) {
    conditions.push(not(inArray(articles.id, excludeIds)));
  }

  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .innerJoin(toolBrandAssets, eq(toolBrandAssets.toolId, articles.id))
    .where(and(...conditions))
    .orderBy(sql`${articles.createdAt} ASC`)
    .limit(limit);
  return rows.map((r) => r.id);
}
import { createLogger } from "@marketing-auto/shared";
import { parseArgs } from "node:util";
import { resolveToolBrandAsset } from "../lib/tool-brand-asset-service.ts";

const log = createLogger("backfill-tool-brand-assets");

// Source resolved → bucket name on the summary. `manual` cannot appear from
// the chain; included so future widening doesn't need a default branch.
const SOURCE_BUCKETS = [
  "simple-icons",
  "iconify",
  "lobe-icons",
  "deterministic-avatar",
] as const;
type SourceBucket = (typeof SOURCE_BUCKETS)[number];

export interface BackfillOptions {
  projectSlug: string;
  apply: boolean;
  /**
   * Re-process tools that already have a brand-asset row. Excludes
   * source='manual' rows so Marcel-uploaded custom logos survive. Use
   * after a code change to refresh chain-resolved rows.
   */
  force?: boolean;
  batchSize?: number;
  limit?: number;
  resolver?: typeof resolveToolBrandAsset;
}

export interface BackfillSummary {
  projectSlug: string;
  candidatesBeforeRun: number;
  totalProcessed: number;
  bySource: Record<SourceBucket, number>;
  needsReviewCount: number;
  errors: Array<{ toolId: string; error: string }>;
  dryRun: boolean;
}

export async function backfillToolBrandAssets(
  opts: BackfillOptions,
): Promise<BackfillSummary> {
  const projectRows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      targetLocales: projects.targetLocales,
    })
    .from(projects)
    .where(eq(projects.slug, opts.projectSlug))
    .limit(1);
  const project = projectRows[0];
  if (!project) {
    throw new Error(`project not found: ${opts.projectSlug}`);
  }

  // V1 fix: bilingual projects (Toolwiki since Spec 59.2) have DE + EN
  // article rows per tool; without this filter we'd write the same logo
  // twice per logical tool. Always backfill the primary locale only.
  const primaryLocale = resolvePrimaryLocale(project.targetLocales);

  // Force mode also counts the existing chain-resolved rows (excluding
  // source='manual') so the dry-run summary is honest about how many rows
  // will be re-written.
  const candidatesBeforeRun = opts.force
    ? await countForceCandidates(project.id, primaryLocale)
    : await countToolsMissingBrandAssets({
        projectId: project.id,
        locale: primaryLocale,
      });

  log.info(
    {
      projectSlug: opts.projectSlug,
      primaryLocale,
      candidatesBeforeRun,
      apply: opts.apply,
      force: opts.force ?? false,
    },
    "backfill starting",
  );

  const summary: BackfillSummary = {
    projectSlug: opts.projectSlug,
    candidatesBeforeRun,
    totalProcessed: 0,
    bySource: {
      "simple-icons": 0,
      iconify: 0,
      "lobe-icons": 0,
      "deterministic-avatar": 0,
    },
    needsReviewCount: 0,
    errors: [],
    dryRun: !opts.apply,
  };

  if (!opts.apply) {
    log.info(
      { candidatesBeforeRun },
      "DRY RUN — pass --apply to resolve + write rows",
    );
    return summary;
  }

  const resolver = opts.resolver ?? resolveToolBrandAsset;
  const batchSize = opts.batchSize ?? 50;
  const hardCap = opts.limit ?? Number.POSITIVE_INFINITY;

  // Track IDs we've already attempted in this run so a resolver failure
  // doesn't trigger an infinite retry — the WHERE-predicate `tba.tool_id IS
  // NULL` stays true for failed tools, but we never re-issue them within the
  // same invocation. Mirrors the Spec 64.15 dry-run-loop-guard rule applied
  // to apply-mode error tolerance.
  const seenInRun = new Set<string>();

  while (summary.totalProcessed + summary.errors.length < hardCap) {
    const remaining = hardCap - summary.totalProcessed - summary.errors.length;
    const batch = opts.force
      ? await listForceCandidates(
          project.id,
          primaryLocale,
          Math.min(batchSize, remaining),
          [...seenInRun],
        )
      : await listToolsMissingBrandAssets({
          projectId: project.id,
          locale: primaryLocale,
          limit: Math.min(batchSize, remaining),
        });
    const fresh = batch.filter((id) => !seenInRun.has(id));
    if (fresh.length === 0) break;

    // Load the matching article rows so we have slug + title for the resolver
    // and the canonical brand-name seed.
    const toolRows = await db
      .select({ id: articles.id, slug: articles.slug, title: articles.title })
      .from(articles)
      .where(eq(articles.projectId, project.id));
    const byId = new Map(toolRows.map((r) => [r.id, r]));

    for (const toolId of fresh) {
      seenInRun.add(toolId);
      const article = byId.get(toolId);
      if (!article) {
        summary.errors.push({ toolId, error: "article row vanished mid-batch" });
        continue;
      }

      try {
        const resolved = await resolver({
          toolId,
          toolSlug: article.slug,
          projectId: project.id,
          projectSlug: project.slug,
        });

        await upsertBrandAsset({
          toolId,
          logoUrl: resolved.logoUrl,
          logoWordmarkUrl: resolved.logoWordmarkUrl,
          // Seed primary/secondary/tertiary_color from the chain's brand-color
          // hints. simple-icons emits a single hex; lobe-icons emits up to 3
          // distinct hexes (multi-color brands like Gemini); iconify usually
          // none. Marcel can override via the Settings-UI, but this gives a
          // sensible V1 default so cards aren't monochrome on first view.
          primaryColor: resolved.brandColorHint,
          secondaryColor: resolved.additionalBrandColors[0] ?? null,
          tertiaryColor: resolved.additionalBrandColors[1] ?? null,
          brandNameCanonical: article.title,
          source: resolved.source,
          needsReview: true,
          fetchedAt: new Date(),
        });

        if (SOURCE_BUCKETS.includes(resolved.source as SourceBucket)) {
          summary.bySource[resolved.source as SourceBucket]++;
        }
        summary.needsReviewCount++;
        summary.totalProcessed++;

        log.debug(
          { toolId, slug: article.slug, source: resolved.source },
          "resolved + upserted",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ toolId, error: message });
        log.error({ toolId, err }, "resolver/upsert failed");
      }
    }
  }

  log.info(summary, "backfill complete");
  return summary;
}

interface ResolvedCliArgs {
  projectSlug: string;
  apply: boolean;
  force?: boolean;
  batchSize?: number;
  limit?: number;
}

export function parseCliArgs(argv: string[]): ResolvedCliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      apply: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "batch-size": { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: false,
  });

  if (!values.project) {
    throw new Error("--project=<slug> is required (Memory D26)");
  }

  const out: ResolvedCliArgs = {
    projectSlug: values.project,
    apply: !!values.apply,
  };
  if (values.force) out.force = true;
  if (values["batch-size"]) out.batchSize = Number.parseInt(values["batch-size"], 10);
  if (values.limit) out.limit = Number.parseInt(values.limit, 10);
  return out;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const summary = await backfillToolBrandAssets(args);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.errors.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
  });
}
