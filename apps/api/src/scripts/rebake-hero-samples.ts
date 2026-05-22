/**
 * Spec 64.6d: ad-hoc Nano Banana 2 hero-image sample generator.
 *
 * Picks N diverse articles from one project (across distinct `collection` values)
 * and runs a fresh hero-image generation per article. Used after the 64.6c WebP-
 * adapter + 64.6d request-shape + prompt-injection fixes to produce real Nano
 * Banana 2 samples Marcel can visually classify (A/B/C-tier).
 *
 * Usage:
 *   bun --filter @marketing-auto/api rebake-hero-samples \
 *     --project toolwiki \
 *     --count 5 \
 *     --collections blog,comparisons,ki-wissen \
 *     --dry-run
 *
 * Flags:
 *   --project <slug>       Required. Project slug to query articles from.
 *   --count <N>            Default 3. Number of articles to sample.
 *   --collections <csv>    Optional. Comma-separated allow-list of collections.
 *                          Default: blog, tools, comparisons, ki-wissen, usecases.
 *                          Always excludes "authors" (no hero image needed).
 *   --dry-run              No adapter calls — just logs the selection + augmented
 *                          prompts. Use this first to verify the picker before
 *                          spending €.
 *
 * Cost: live mode @ Toolwiki defaults (nano-banana-2 @ 1K) ≈ €0.062/article.
 *       Live run with --count 3 ≈ €0.19.
 */

import { generateImage as nanoBananaGenerate } from "@marketing-auto/adapter-nano-banana";
import { replicate } from "@marketing-auto/adapter-replicate";
import { COST_OPS, estimateHeroImageCost } from "@marketing-auto/core/cost";
import { articles, db, projects } from "@marketing-auto/db";
import {
  buildPromptWithResolutionHint,
  resolveImageConfig,
  seedFromArticleId,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, inArray } from "drizzle-orm";

const log = createLogger("rebake-hero-samples");

const DEFAULT_COLLECTIONS = ["blog", "tools", "comparisons", "ki-wissen", "usecases"] as const;

export interface RebakeOptions {
  projectSlug: string;
  count: number;
  collections?: string[];
  dryRun: boolean;
}

export interface RebakeResult {
  previewedSlugs: string[];
  previewedCollections: string[];
  bakedSlugs: string[];
  failedSlugs: Array<{ slug: string; err: string }>;
}

/**
 * Articles emitted by ArticleSelectQuery — narrow shape used by the picker.
 * Mirrors the column subset we actually need; declared explicitly to keep TS
 * happy under exactOptionalPropertyTypes (Drizzle's `$type<>` doesn't carry through
 * .select() projections).
 */
interface SampleArticle {
  id: string;
  slug: string;
  title: string;
  collection: string;
  outline: { heroImagePrompt: string } | null;
}

/**
 * Diversifies the candidate pool by collection: rounds through each collection
 * picking one article at a time until `target` is hit. If one collection runs
 * dry the loop continues with the remaining ones — graceful fallback for projects
 * with imbalanced collections.
 */
export function pickDiverseByCollection(
  pool: SampleArticle[],
  target: number,
): SampleArticle[] {
  const byCollection = new Map<string, SampleArticle[]>();
  for (const a of pool) {
    const bucket = byCollection.get(a.collection) ?? [];
    bucket.push(a);
    byCollection.set(a.collection, bucket);
  }

  const result: SampleArticle[] = [];
  let progressed = true;
  while (progressed && result.length < target) {
    progressed = false;
    for (const [, bucket] of byCollection) {
      if (bucket.length === 0) continue;
      const next = bucket.shift();
      if (next) {
        result.push(next);
        progressed = true;
        if (result.length >= target) break;
      }
    }
  }
  return result;
}

/**
 * Discovery 64.8 §1: imported articles (source='imported') have outline=NULL.
 * Synthesizes a generic editorial prompt from `title` + `collection` so the
 * rebake can still run against existing Toolwiki content without re-running
 * the outline step.
 *
 * The fallback is intentionally generic — Marcel uses these samples to judge
 * Nano Banana 2's visual quality, not the prompt-engineering quality of the
 * upstream outline step. If samples come back B/C-tier with this fallback,
 * that's a signal Spec 64.8 (Post-Draft Refactor) is needed.
 */
export function buildFallbackHeroPrompt(article: { title: string; collection: string }): string {
  return [
    `Editorial flatlay scene that evokes "${article.title}".`,
    `Subject domain: ${article.collection}.`,
    "Style: clean editorial photography, cream linen background, soft warm studio lighting.",
    "Composition: overhead three-quarter angle, physical objects only.",
    "NO text labels, no typography, no signage, no readable writing of any kind.",
  ].join(" ");
}

export async function rebakeHeroSamples(opts: RebakeOptions): Promise<RebakeResult> {
  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, opts.projectSlug))
    .limit(1);
  if (!project) {
    throw new Error(`Project not found: slug='${opts.projectSlug}'`);
  }

  const allowList = (opts.collections ?? [...DEFAULT_COLLECTIONS]).filter((c) => c !== "authors");
  if (allowList.length === 0) {
    throw new Error("--collections must include at least one non-authors collection");
  }

  // Pull 3× the target so the picker has room to diversify by collection.
  // Order by createdAt DESC so we sample recent imports (more representative
  // of current Toolwiki content) rather than legacy seed data.
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      collection: articles.collection,
      outline: articles.outline,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, project.id),
        inArray(articles.collection, allowList),
      ),
    )
    .limit(opts.count * 3);

  // articles.title is nullable in the DB schema; filter rows where it's NULL or
  // empty so the fallback-prompt builder always has a usable subject string.
  const candidates: SampleArticle[] = rows
    .filter((r): r is typeof r & { title: string } => typeof r.title === "string" && r.title.length > 0)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      collection: r.collection,
      outline:
        r.outline && typeof r.outline === "object" && "heroImagePrompt" in r.outline
          ? { heroImagePrompt: (r.outline as { heroImagePrompt: string }).heroImagePrompt }
          : null,
    }));

  const picked = pickDiverseByCollection(candidates, opts.count);
  log.info(
    {
      project: project.slug,
      requested: opts.count,
      candidatePool: candidates.length,
      picked: picked.length,
      slugs: picked.map((a) => a.slug),
      collections: [...new Set(picked.map((a) => a.collection))],
      dryRun: opts.dryRun,
    },
    "rebake-hero-samples: selection complete",
  );

  const result: RebakeResult = {
    previewedSlugs: picked.map((a) => a.slug),
    previewedCollections: [...new Set(picked.map((a) => a.collection))],
    bakedSlugs: [],
    failedSlugs: [],
  };

  if (opts.dryRun) {
    for (const article of picked) {
      const base = article.outline?.heroImagePrompt ?? buildFallbackHeroPrompt(article);
      log.info(
        {
          slug: article.slug,
          collection: article.collection,
          source: article.outline ? "outline.heroImagePrompt" : "fallback",
          basePromptLen: base.length,
        },
        "rebake-hero-samples: DRY RUN — would bake",
      );
    }
    return result;
  }

  // Live mode: resolve provider once, generate per-article.
  const { provider, resolution } = await resolveImageConfig(project.id);
  const storagePrefix = `${project.slug}/articles/hero`;
  // Mirror HeroImageStep — use the project-aware estimator instead of a
  // hardcoded value so cost_logs.metadata.estimatedCostEur reflects the real
  // per-tenant rate (root CLAUDE.md: never hardcode estimates in adapter calls).
  const perCallEstimate = estimateHeroImageCost(provider, resolution);

  for (const article of picked) {
    const base = article.outline?.heroImagePrompt ?? buildFallbackHeroPrompt(article);
    const augmentedPrompt = buildPromptWithResolutionHint(base, resolution);
    const seed = seedFromArticleId(article.id);

    try {
      if (provider === "nano-banana-2") {
        const out = await nanoBananaGenerate({
          projectId: project.id,
          articleId: article.id,
          operation: COST_OPS.HERO_IMAGE,
          model: "nano-banana-2",
          prompt: augmentedPrompt,
          aspectRatio: "16:9",
          resolution,
          outputFormat: "webp",
          outputQuality: 90,
          seed,
          storagePrefix,
          estimatedCostEur: perCallEstimate,
        });
        log.info(
          {
            slug: article.slug,
            publicUrl: out.publicUrl,
            r2Key: out.r2Key,
            bytesStored: out.bytesStored,
          },
          "rebake-hero-samples: baked",
        );
        result.bakedSlugs.push(article.slug);
      } else {
        const out = await replicate.generateImage({
          projectId: project.id,
          articleId: article.id,
          operation: COST_OPS.HERO_IMAGE,
          model: "flux-1.1-pro",
          prompt: augmentedPrompt,
          aspectRatio: "16:9",
          outputFormat: "webp",
          storagePrefix,
          estimatedCostEur: perCallEstimate,
          seed,
        });
        log.info(
          {
            slug: article.slug,
            publicUrl: out.publicUrl,
            r2Key: out.r2Key,
          },
          "rebake-hero-samples: baked (replicate)",
        );
        result.bakedSlugs.push(article.slug);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ slug: article.slug, err: msg }, "rebake-hero-samples: bake failed");
      result.failedSlugs.push({ slug: article.slug, err: msg });
    }
  }

  log.info(
    { baked: result.bakedSlugs.length, failed: result.failedSlugs.length },
    "rebake-hero-samples: done — review images in R2",
  );
  return result;
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): RebakeOptions {
  let projectSlug: string | undefined;
  let count = 3;
  let collections: string[] | undefined;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project") {
      const next = argv[++i];
      if (next !== undefined) projectSlug = next;
    } else if (arg === "--count") {
      const parsed = Number.parseInt(argv[++i] ?? "0", 10);
      if (!Number.isNaN(parsed) && parsed > 0) count = parsed;
    } else if (arg === "--collections") {
      const csv = argv[++i] ?? "";
      collections = csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  if (!projectSlug) {
    log.error("Missing --project <slug>");
    process.exit(1);
  }

  return collections !== undefined
    ? { projectSlug, count, collections, dryRun }
    : { projectSlug, count, dryRun };
}

if (import.meta.main) {
  const opts = parseArgs(Bun.argv.slice(2));
  rebakeHeroSamples(opts)
    .then((r) => {
      log.info(r, "rebake-hero-samples: final");
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err }, "rebake-hero-samples: fatal");
      process.exit(1);
    });
}
