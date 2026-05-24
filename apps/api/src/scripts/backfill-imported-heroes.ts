/**
 * Spec 000 — Hero-Image-Mirror backfill for imported articles.
 *
 * Catches up existing rows whose `hero_image_r2_key IS NULL` but whose source
 * MDX in the Astro repo carries a hero reference. Sits alongside the Cleanup-
 * Branch's C4 re-import as the "belt-and-suspenders" path — idempotent: re-runs
 * are no-ops because the hash-equality refresh whitelist in UpsertArticlesStep
 * also fires here (we share the same `mirrorOneArticle` helper).
 *
 * Default mode is **dry-run**. Pass `--apply` to actually fetch from GitHub,
 * upload to R2, and write the DB columns.
 *
 * Usage:
 *   bun --filter @marketing-auto/api backfill-imported-heroes --project=<slug> [--apply] [--limit=N]
 *
 * Flags:
 *   --project=<slug>   REQUIRED — cross-tenant gate (Pattern D146).
 *   --apply            REQUIRED to mutate. Default omits → safe preview.
 *   --limit=N          Process only the first N candidate articles (sample mode).
 *
 * Pattern mirrors `cleanup-orphan-heroes.ts` (Spec 64.10) + `backfill-brief-
 * embeddings.ts` (Spec 64.15): DI ports for offline tests, `--apply` opt-in,
 * `import.meta.main` guard. Reuses `mirrorOneArticle` from the adapter so
 * production + backfill share one code path.
 */

import { parseArgs } from "node:util";
import {
  type AstroRepoConfig,
  getInstallationOctokit,
} from "@marketing-auto/adapter-astro-sync";
import {
  type HeroFields,
  type MirrorDeps,
  type ParsedEntry,
  COLLECTIONS_WITHOUT_HERO,
  mirrorOneArticle,
} from "@marketing-auto/adapter-astro-sync/import";
import { convertImageToWebp } from "@marketing-auto/adapter-image-webp";
import {
  and,
  articles,
  db,
  eq,
  isNull,
  projects,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("backfill-imported-heroes");

// ─── Public API (exported for unit tests) ────────────────────────────────────

export interface BackfillOptions {
  projectSlug: string;
  apply: boolean;
  limit?: number;
  /** Injection seam for tests; production uses defaults. */
  githubPort?: GithubPort;
  uploadPort?: UploadPort;
  databasePort?: DatabasePort;
}

export interface GithubPort {
  resolveHead: (repo: AstroRepoConfig) => Promise<string>;
  readBytes: MirrorDeps["readSourceBytes"];
}

export interface UploadPort {
  upload: MirrorDeps["uploadWebp"];
}

export interface DatabasePort {
  resolveProject: (slug: string) => Promise<{
    id: string;
    slug: string;
    astroRepo: AstroRepoConfig;
  } | null>;
  countCandidates: (projectId: string) => Promise<number>;
  loadCandidates: (projectId: string, limit?: number) => Promise<CandidateRow[]>;
  findExistingByHash: MirrorDeps["findExistingByHash"];
  updateHeroColumns: (input: { articleId: string; hero: HeroFields }) => Promise<void>;
}

export interface CandidateRow {
  id: string;
  slug: string;
  locale: string;
  collection: string;
  domainExtras: Record<string, unknown> | null;
  importMetadata: Record<string, unknown> | null;
  heroImageAltTextExisting: string | null;
}

export interface BackfillResult {
  apply: boolean;
  projectSlug: string;
  totalCandidates: number;
  processed: number;
  mirrored: number;
  reused: number;
  skippedByCollection: number;
  failed: number;
  uniqueHashes: number;
  failureSamples: Array<{ slug: string; reason: string }>;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function backfillImportedHeroes(opts: BackfillOptions): Promise<BackfillResult> {
  const databasePort = opts.databasePort ?? defaultDatabasePort();
  const githubPort = opts.githubPort ?? defaultGithubPort();
  const uploadPort = opts.uploadPort ?? defaultUploadPort();

  const project = await databasePort.resolveProject(opts.projectSlug);
  if (!project) {
    throw new Error(`backfill-imported-heroes: project '${opts.projectSlug}' not found`);
  }

  const totalCandidates = await databasePort.countCandidates(project.id);

  const result: BackfillResult = {
    apply: opts.apply,
    projectSlug: opts.projectSlug,
    totalCandidates,
    processed: 0,
    mirrored: 0,
    reused: 0,
    skippedByCollection: 0,
    failed: 0,
    uniqueHashes: 0,
    failureSamples: [],
  };

  // Dry-run short-circuit: report counts only, never iterate or fetch.
  // The CLAUDE.md rule "Dry-run loop guard for predicate-based backfill scripts"
  // forbids paginated iteration in dry-run mode — the predicate would stay
  // true forever, spinning the script at 100% CPU.
  if (!opts.apply) {
    log.info(
      { projectSlug: opts.projectSlug, totalCandidates },
      "backfill-imported-heroes: dry-run — pass --apply to mutate",
    );
    return result;
  }

  // Resolve HEAD of the project's default branch ONCE for the whole run.
  // All blob fetches are pinned to this SHA so a concurrent commit during
  // the backfill doesn't confuse hash semantics.
  const refSha = await githubPort.resolveHead(project.astroRepo);
  log.info(
    { projectSlug: opts.projectSlug, refSha, totalCandidates },
    "backfill-imported-heroes: --apply — resolving HEAD",
  );

  const candidates = await databasePort.loadCandidates(project.id, opts.limit);
  const seenHashes = new Map<string, HeroFields>();
  const deps: MirrorDeps = {
    readSourceBytes: githubPort.readBytes,
    findExistingByHash: databasePort.findExistingByHash,
    uploadWebp: uploadPort.upload,
    log,
  };

  for (const cand of candidates) {
    result.processed++;
    if (COLLECTIONS_WITHOUT_HERO.has(cand.collection)) {
      // The SELECT already filters these out, but be defensive — the constant
      // is the canonical list, the SQL is mirrored.
      result.skippedByCollection++;
      continue;
    }
    const entry = candidateToParsedEntry(cand);
    const outcome = await mirrorOneArticle(deps, {
      projectId: project.id,
      projectSlug: project.slug,
      repo: project.astroRepo,
      refSha,
      entry,
      seenHashes,
    });
    switch (outcome.kind) {
      case "mirrored":
        result.mirrored++;
        await databasePort.updateHeroColumns({ articleId: cand.id, hero: outcome.fields });
        break;
      case "reused":
        result.reused++;
        await databasePort.updateHeroColumns({ articleId: cand.id, hero: outcome.fields });
        break;
      case "skipped-collection":
        result.skippedByCollection++;
        break;
      case "skipped-no-hero":
        // Default-hero pathway exhausted the resolver — accounted for as
        // skipped-no-hero only when both heroImage/image AND the default
        // were absent. mirrorOneArticle does not currently emit this case
        // because the default fallback is hard-coded; keeping the branch
        // exhaustive for forward compat.
        result.failed++;
        result.failureSamples.push({ slug: cand.slug, reason: "no_hero_resolved" });
        break;
      case "failed":
        result.failed++;
        if (result.failureSamples.length < 20) {
          result.failureSamples.push({ slug: cand.slug, reason: outcome.reason });
        }
        break;
    }
  }
  result.uniqueHashes = seenHashes.size;

  log.info(
    {
      ...result,
      failureSamplesLength: result.failureSamples.length,
    },
    "backfill-imported-heroes: complete",
  );
  return result;
}

// ─── Translate a CandidateRow into a synthetic ParsedEntry ───────────────────

/**
 * The mirror helper takes the same `ParsedEntry` shape produced by
 * `ParseFrontmatterBatchStep`. We synthesise one here from DB columns so
 * the per-article logic stays identical to the production path. Fields
 * the helper does not read (`filePath`, `gitSha`, `body`, etc.) are
 * stubbed with empty values.
 */
function candidateToParsedEntry(c: CandidateRow): ParsedEntry {
  const extras = (c.domainExtras as Record<string, unknown> | null) ?? {};
  const typed: Record<string, unknown> = {
    slug: c.slug,
    locale: c.locale,
  };
  if (typeof extras.heroImage === "string") typed.heroImage = extras.heroImage;
  if (typeof extras.image === "string") typed.image = extras.image;
  if (typeof extras.heroImageAlt === "string") typed.heroImageAlt = extras.heroImageAlt;
  else if (c.heroImageAltTextExisting !== null) typed.heroImageAlt = c.heroImageAltTextExisting;

  return {
    filePath: "",
    gitSha: "",
    collection: c.collection,
    typed,
    extras,
    metadata: (c.importMetadata as Record<string, unknown> | null) ?? {},
    body: "",
  };
}

// ─── Default ports (production wiring) ───────────────────────────────────────

function defaultDatabasePort(): DatabasePort {
  return {
    async resolveProject(slug) {
      const rows = await db
        .select({
          id: projects.id,
          slug: projects.slug,
          astroRepo: projects.astroRepo,
        })
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (!row.astroRepo) {
        throw new Error(`project '${slug}' has no astro_repo config; backfill cannot proceed`);
      }
      return {
        id: row.id,
        slug: row.slug,
        astroRepo: row.astroRepo as AstroRepoConfig,
      };
    },
    async countCandidates(projectId) {
      // Same predicate as `loadCandidates` so the count matches.
      const excluded: string[] = Array.from(COLLECTIONS_WITHOUT_HERO);
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, projectId),
            eq(articles.source, "imported"),
            isNull(articles.heroImageR2Key),
            sql`${articles.collection} NOT IN ${excluded}`,
          ),
        );
      return rows[0]?.n ?? 0;
    },
    async loadCandidates(projectId, limit) {
      const excluded: string[] = Array.from(COLLECTIONS_WITHOUT_HERO);
      const q = db
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
      if (typeof limit === "number" && limit > 0) q.limit(limit);
      const rows = await q;
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        locale: r.locale ?? "de",
        collection: r.collection,
        domainExtras: (r.domainExtras as Record<string, unknown> | null) ?? null,
        importMetadata: (r.importMetadata as Record<string, unknown> | null) ?? null,
        heroImageAltTextExisting: r.heroImageAltTextExisting,
      }));
    },
    async findExistingByHash({ projectId, sha256 }) {
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
    async updateHeroColumns({ articleId, hero }) {
      // Match the production refresh-whitelist semantics: only overwrite
      // when the hash actually changes. Backfill rows all start at NULL
      // hash so this is effectively unconditional on the first run; a
      // re-run after the file changed in the repo will pick up the new
      // hash; a re-run with the same source bytes is a no-op.
      await db
        .update(articles)
        .set({
          heroImageR2Key: hero.heroImageR2Key,
          heroImagePublicUrl: hero.heroImagePublicUrl,
          heroImageOriginalR2Key: hero.heroImageOriginalR2Key,
          heroImageSourceSha256: hero.heroImageSourceSha256,
          heroImageAltText: hero.heroImageAltText,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(articles.id, articleId),
            // CAS: only proceed if hash hasn't changed since SELECT.
            // `IS DISTINCT FROM` treats NULL on either side as different.
            sql`${articles.heroImageSourceSha256} IS DISTINCT FROM ${hero.heroImageSourceSha256}`,
          ),
        );
    },
  };
}

function defaultGithubPort(): GithubPort {
  return {
    async resolveHead(repo) {
      const octokit = await getInstallationOctokit(repo.installationId);
      const res = await octokit.request(
        "GET /repos/{owner}/{repo}/branches/{branch}",
        {
          owner: repo.owner,
          repo: repo.name,
          branch: repo.defaultBranch,
        },
      );
      return res.data.commit.sha;
    },
    async readBytes({ repo, refSha, repoPath }) {
      const octokit = await getInstallationOctokit(repo.installationId);
      try {
        const contentsRes = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          { owner: repo.owner, repo: repo.name, path: repoPath, ref: refSha },
        );
        const data = contentsRes.data;
        if (Array.isArray(data) || data.type !== "file") return null;
        const fileSha = (data as { sha?: string }).sha;
        if (!fileSha) return null;
        const blobRes = await octokit.request(
          "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
          { owner: repo.owner, repo: repo.name, file_sha: fileSha },
        );
        const buf = Buffer.from(blobRes.data.content, "base64");
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        return { bytes, contentType: contentTypeFromPath(repoPath) };
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
  };
}

function defaultUploadPort(): UploadPort {
  return {
    async upload({ projectId, storagePrefix, bytes, contentType }) {
      const r = await convertImageToWebp({
        projectId,
        bytes,
        contentType,
        storagePrefix,
      });
      return { webpKey: r.webpKey, webpUrl: r.webpUrl, originalKey: r.originalKey };
    },
  };
}

function contentTypeFromPath(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      apply: { type: "boolean", default: false },
      limit: { type: "string" },
    },
    strict: true,
  });

  const projectSlug = args.values.project;
  if (!projectSlug) {
    console.error("Required flag missing: --project=<slug>");
    process.exit(1);
  }

  const limit = args.values.limit ? Number.parseInt(args.values.limit, 10) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    console.error(`Invalid --limit value: ${args.values.limit}`);
    process.exit(1);
  }

  const start = Date.now();
  try {
    const result = await backfillImportedHeroes({
      projectSlug,
      apply: args.values.apply ?? false,
      ...(limit !== undefined ? { limit } : {}),
    });
    const ms = Date.now() - start;
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(JSON.stringify({ ...result, elapsedMs: ms }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error("backfill-imported-heroes failed:", err);
    process.exit(1);
  }
}
