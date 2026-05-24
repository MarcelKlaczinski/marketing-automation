/**
 * Spec 005 IR2 — MirrorBackfillHeroesStep
 *
 * Post-Upsert step that picks up `source='imported'` articles where
 * `hero_image_r2_key IS NULL` and re-mirrors them through the same
 * `mirrorOneArticle` helper used by `MirrorHeroImagesStep` and the
 * `backfill-imported-heroes` CLI. Closes the durability gap exposed by
 * Anomaly-B: when `MirrorHeroImagesStep` fails on first INSERT (404,
 * R2 outage, etc.), the row is INSERTed without heroes and subsequent
 * Re-Imports skip the row via gitSha-equality. This step gives every
 * Re-Import a fresh shot at heroless rows, regardless of MDX state.
 *
 * Architecture: additive — `MirrorHeroImagesStep` keeps its existing
 * in-memory parsed-entries flow (the fast path); this step is the
 * self-healing safety net that runs AFTER `UpsertArticlesStep`. Idempotent:
 * if all rows have heroes, the SELECT returns 0 candidates and the step
 * is a no-op.
 *
 * Shares `mirrorOneArticle` + the WebP adapter route with the CLI
 * (`backfill-imported-heroes.ts`), so dedup, hash semantics, and
 * COLLECTIONS_WITHOUT_HERO behaviour are identical to the per-run mirror.
 */

import { and, articles, db, eq, isNull, projects, sql } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { convertImageToWebp } from "@marketing-auto/adapter-image-webp";
import { getInstallationOctokit } from "../../github-auth.ts";
import { AstroRepoConfigSchema, type AstroRepoConfig } from "../../types.ts";
import {
  COLLECTIONS_WITHOUT_HERO,
  type HeroFields,
  type MirrorDeps,
  type ParsedEntry,
  mirrorOneArticle,
} from "./mirror-hero-images.ts";

const log = createLogger("astro-import:mirror-backfill");

// ───── Public types ──────────────────────────────────────────────────────────

const InputSchema = z.object({
  projectId: z.string().uuid(),
  astroRepo: AstroRepoConfigSchema.optional(),
  headCommitSha: z.string().min(1).optional(),
});

const OutputSchema = z.object({
  candidates: z.number(),
  mirrored: z.number(),
  reused: z.number(),
  skippedByCollection: z.number(),
  failed: z.number(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

const InputSchemaCast = InputSchema as z.ZodType<Input>;
const OutputSchemaCast = OutputSchema as z.ZodType<Output>;

/**
 * DI seam: tests inject a stub `mirrorOneArticleFn` so they stay offline
 * (no GitHub-App tokens, no R2 uploads). Production passes nothing and
 * the step wires the real `mirrorOneArticle` via per-run GitHub-App +
 * R2 deps loaded from `projects.astroRepo`.
 */
export interface BackfillStepDeps {
  mirrorOneArticleFn?: typeof mirrorOneArticle;
}

// Re-export for test convenience
export { COLLECTIONS_WITHOUT_HERO };
export type { HeroFields };

// ───── Shared hash-equality refresh-whitelist helper ─────────────────────────

/**
 * Hash-equality refresh whitelist for hero columns: only flip if the
 * source sha256 actually changed. Used by both the main `UpsertArticlesStep`
 * (for inline UPDATE during incremental imports) and this backfill step
 * (for standalone UPDATE when filling in heroless rows). Centralising the
 * SQL prevents the two sites from drifting on the preservation semantics
 * (e.g. UI-edited `heroImageAltText` must survive an unchanged-content
 * Re-Import).
 *
 * Returns the SET fragment to merge into a Drizzle `.update().set({...})`.
 */
export function heroRefreshWhitelistUpdateSet(hero: HeroFields): {
  heroImageR2Key: ReturnType<typeof sql>;
  heroImagePublicUrl: ReturnType<typeof sql>;
  heroImageOriginalR2Key: ReturnType<typeof sql>;
  heroImageSourceSha256: HeroFields["heroImageSourceSha256"];
  heroImageAltText: ReturnType<typeof sql>;
} {
  return {
    heroImageR2Key: sql`CASE WHEN ${articles.heroImageSourceSha256} IS DISTINCT FROM ${hero.heroImageSourceSha256} THEN ${hero.heroImageR2Key}::text ELSE ${articles.heroImageR2Key} END`,
    heroImagePublicUrl: sql`CASE WHEN ${articles.heroImageSourceSha256} IS DISTINCT FROM ${hero.heroImageSourceSha256} THEN ${hero.heroImagePublicUrl}::text ELSE ${articles.heroImagePublicUrl} END`,
    heroImageOriginalR2Key: sql`CASE WHEN ${articles.heroImageSourceSha256} IS DISTINCT FROM ${hero.heroImageSourceSha256} THEN ${hero.heroImageOriginalR2Key}::text ELSE ${articles.heroImageOriginalR2Key} END`,
    heroImageSourceSha256: hero.heroImageSourceSha256,
    heroImageAltText: sql`CASE WHEN ${articles.heroImageSourceSha256} IS DISTINCT FROM ${hero.heroImageSourceSha256} THEN ${hero.heroImageAltText}::text ELSE ${articles.heroImageAltText} END`,
  };
}

// ───── Candidate loading + ParsedEntry reconstruction ────────────────────────

interface CandidateRow {
  id: string;
  slug: string;
  locale: string;
  collection: string;
  /** `articles.domainExtras` is `$type<Record<string,unknown>>().notNull().default({})` — always present. */
  domainExtras: Record<string, unknown>;
  /** `articles.importMetadata` is `$type<ImportMetadata>().notNull().default({})` — always present. */
  importMetadata: Record<string, unknown>;
  heroImageAltTextExisting: string | null;
}

async function loadHerolessCandidates(projectId: string): Promise<CandidateRow[]> {
  const excluded: string[] = Array.from(COLLECTIONS_WITHOUT_HERO);
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      locale: articles.locale,
      collection: articles.collection,
      domainExtras: articles.domainExtras,
      importMetadata: articles.importMetadata,
      heroImageAltTextExisting: articles.heroImageAltText,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.source, "imported"),
        isNull(articles.heroImageR2Key),
        sql`${articles.collection} NOT IN ${excluded}`,
      ),
    )
    .orderBy(articles.collection, articles.slug);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    locale: r.locale ?? "de",
    collection: r.collection,
    domainExtras: r.domainExtras,
    importMetadata: r.importMetadata,
    heroImageAltTextExisting: r.heroImageAltTextExisting,
  }));
}

/**
 * Reconstructs a synthetic `ParsedEntry` from a DB row so the shared
 * `mirrorOneArticle` helper can drive it without a fresh MDX parse.
 * Mirrors the CLI's `candidateToParsedEntry` (see
 * `apps/api/src/scripts/backfill-imported-heroes.ts`) so behaviour stays
 * identical across the in-pipeline backfill and the ad-hoc CLI path.
 */
function candidateToParsedEntry(c: CandidateRow): ParsedEntry {
  const extras = c.domainExtras;
  const typed: Record<string, unknown> = {
    slug: c.slug,
    locale: c.locale,
  };
  if (typeof extras["heroImage"] === "string") typed["heroImage"] = extras["heroImage"];
  if (typeof extras["image"] === "string") typed["image"] = extras["image"];
  if (typeof extras["heroImageAlt"] === "string")
    typed["heroImageAlt"] = extras["heroImageAlt"];
  else if (c.heroImageAltTextExisting !== null)
    typed["heroImageAlt"] = c.heroImageAltTextExisting;

  return {
    filePath: "",
    gitSha: "",
    collection: c.collection,
    typed,
    extras,
    metadata: c.importMetadata,
    body: "",
  };
}

// ───── BaseStep ──────────────────────────────────────────────────────────────

export class MirrorBackfillHeroesStep extends BaseStep<Input, Output> {
  readonly name = "mirror-backfill-heroes";
  readonly inputSchema = InputSchemaCast;
  readonly outputSchema = OutputSchemaCast;

  /** DI seam — production uses the real `mirrorOneArticle`. */
  private readonly mirrorFn: typeof mirrorOneArticle;
  /**
   * Tracks whether the mirror function was injected. Used to skip the
   * production dep-construction path (GitHub-App + R2 wiring) when a
   * test passes its own stub — the stub ignores `deps`, so spinning up
   * an Octokit client would either crash or require live credentials.
   */
  private readonly stubMode: boolean;

  constructor(deps: BackfillStepDeps = {}) {
    super();
    this.mirrorFn = deps.mirrorOneArticleFn ?? mirrorOneArticle;
    this.stubMode = deps.mirrorOneArticleFn !== undefined;
  }

  override estimatedCostEur(): number {
    // R2 PUTs are free on the Cloudflare plan; sharp CPU is local;
    // GitHub-App API is free. Mirror's only paid surface is the WebP
    // adapter's optional Replicate path, which is not used here.
    return 0;
  }

  override pausableInDebug(): boolean {
    return false;
  }

  async execute(input: Input, _ctx: StepContext): Promise<Output> {
    const candidates = await loadHerolessCandidates(input.projectId);

    const stats: Output = {
      candidates: candidates.length,
      mirrored: 0,
      reused: 0,
      skippedByCollection: 0,
      failed: 0,
    };

    if (candidates.length === 0) {
      log.info({ projectId: input.projectId }, "no heroless candidates — skipping");
      return stats;
    }

    // Load project once for projectSlug + repo config (if not in pipeline input)
    const project = await loadProjectForBackfill(input.projectId);
    const repo = input.astroRepo ?? project.astroRepo;
    if (!repo) {
      throw new Error(
        `mirror-backfill-heroes: project ${input.projectId} has no astro_repo config and no override in pipeline input`,
      );
    }
    const refSha = input.headCommitSha ?? repo.defaultBranch; // fallback: branch ref

    // Build production deps unless the test injected a stub mirror function
    // (which ignores `deps` entirely, so spinning up an Octokit client is
    // both unnecessary and would require live GitHub-App credentials).
    const deps: MirrorDeps = this.stubMode
      ? STUB_MIRROR_DEPS
      : await buildProductionMirrorDeps(repo);

    const seenHashes = new Map<string, HeroFields>();

    for (const cand of candidates) {
      const entry = candidateToParsedEntry(cand);
      const outcome = await this.mirrorFn(deps, {
        projectId: input.projectId,
        projectSlug: project.slug,
        repo,
        refSha,
        entry,
        seenHashes,
      });

      switch (outcome.kind) {
        case "mirrored":
        case "reused":
          if (outcome.kind === "mirrored") stats.mirrored++;
          else stats.reused++;
          await db
            .update(articles)
            .set(heroRefreshWhitelistUpdateSet(outcome.fields))
            .where(eq(articles.id, cand.id));
          break;
        case "skipped-collection":
          // Defensive: the SELECT already excludes these; counted for parity
          // with MirrorHeroImagesStep.
          stats.skippedByCollection++;
          break;
        case "skipped-no-hero":
          stats.failed++;
          break;
        case "failed":
          stats.failed++;
          log.warn(
            {
              articleId: cand.id,
              slug: cand.slug,
              collection: cand.collection,
              reason: outcome.reason,
            },
            "mirror-backfill: per-article mirror failed; row stays heroless",
          );
          break;
      }
    }

    log.info(
      {
        projectId: input.projectId,
        ...stats,
      },
      "mirror-backfill: complete",
    );

    return stats;
  }
}

// ───── Test-stub deps (only ever passed to a stubbed mirror function) ───────

const STUB_MIRROR_DEPS: MirrorDeps = {
  readSourceBytes: async () => null,
  findExistingByHash: async () => null,
  uploadWebp: async () => {
    throw new Error("STUB_MIRROR_DEPS.uploadWebp called — test should inject mirrorOneArticleFn");
  },
};

// ───── Production wiring ─────────────────────────────────────────────────────

async function loadProjectForBackfill(projectId: string): Promise<{
  slug: string;
  astroRepo: AstroRepoConfig | null;
}> {
  const [row] = await db
    .select({ slug: projects.slug, astroRepo: projects.astroRepo })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row?.slug) {
    throw new Error(`mirror-backfill-heroes: project ${projectId} not found`);
  }
  // `projects.astroRepo` is `jsonb.$type<AstroRepoConfig>()` — Drizzle already
  // types this as `AstroRepoConfig | null` (column has no `.notNull()`).
  return {
    slug: row.slug,
    astroRepo: row.astroRepo,
  };
}

async function buildProductionMirrorDeps(repo: AstroRepoConfig): Promise<MirrorDeps> {
  const octokit = await getInstallationOctokit(repo.installationId);
  return {
    readSourceBytes: async ({ repo: r, refSha, repoPath }) => {
      try {
        const contentsRes = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          { owner: r.owner, repo: r.name, path: repoPath, ref: refSha },
        );
        const data = contentsRes.data;
        if (Array.isArray(data) || data.type !== "file") return null;
        const fileSha = (data as { sha?: string }).sha;
        if (!fileSha) return null;
        const blobRes = await octokit.request(
          "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
          { owner: r.owner, repo: r.name, file_sha: fileSha },
        );
        const buf = Buffer.from(blobRes.data.content, "base64");
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        const lower = repoPath.toLowerCase();
        const contentType = lower.endsWith(".webp")
          ? "image/webp"
          : lower.endsWith(".png")
          ? "image/png"
          : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? "image/jpeg"
          : lower.endsWith(".gif")
          ? "image/gif"
          : lower.endsWith(".avif")
          ? "image/avif"
          : "application/octet-stream";
        return { bytes, contentType };
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          "status" in err &&
          (err as { status: unknown }).status === 404
        ) {
          return null;
        }
        throw err;
      }
    },
    findExistingByHash: async ({ projectId, sha256 }) => {
      const [row] = await db
        .select({
          heroImageR2Key: articles.heroImageR2Key,
          heroImagePublicUrl: articles.heroImagePublicUrl,
          heroImageOriginalR2Key: articles.heroImageOriginalR2Key,
        })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, projectId),
            eq(articles.heroImageSourceSha256, sha256),
          ),
        )
        .limit(1);
      if (!row || !row.heroImageR2Key || !row.heroImagePublicUrl) return null;
      return {
        heroImageR2Key: row.heroImageR2Key,
        heroImagePublicUrl: row.heroImagePublicUrl,
        heroImageOriginalR2Key: row.heroImageOriginalR2Key,
      };
    },
    uploadWebp: async ({ projectId, storagePrefix, bytes, contentType }) => {
      const r = await convertImageToWebp({
        projectId,
        bytes,
        contentType,
        storagePrefix,
      });
      return {
        webpKey: r.webpKey,
        webpUrl: r.webpUrl,
        originalKey: r.originalKey,
      };
    },
    log,
  };
}
