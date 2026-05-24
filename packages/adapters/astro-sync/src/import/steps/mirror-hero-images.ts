import { createHash } from "node:crypto";
import { convertImageToWebp } from "@marketing-auto/adapter-image-webp";
import { and, articles, db, eq, projects } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger, type Logger } from "@marketing-auto/shared";
import { z } from "zod";
import { getInstallationOctokit } from "../../github-auth.ts";
import { AstroRepoConfigSchema, type AstroRepoConfig } from "../../types.ts";

const log = createLogger("astro-import:mirror-hero");

/**
 * Spec 000 — Hero-Image-Mirror.
 *
 * Collections that have no hero by design. Audit (`docs/discovery/hero-image-state-audit.md`)
 * confirmed `tool-categories` has 0/14 hero coverage in Toolwiki and the
 * Astro layout never renders one. Extend this set when adding a future
 * collection that has the same property — keep the documentation in
 * `packages/adapters/astro-sync/CLAUDE.md` in sync.
 */
export const COLLECTIONS_WITHOUT_HERO: ReadonlySet<string> = new Set([
  "tool-categories",
]);

/**
 * Fallback path used when an article has no `heroImage` / `image` frontmatter.
 * The Astro repo MUST commit a file at `public/heroes/default.webp` —
 * documented in root CLAUDE.md (External Repo Reserved Assets) and the
 * Astro-Repo CLAUDE.md. If the file is missing, the mirror entry is recorded
 * as failed with a one-line warn (no spam).
 */
export const DEFAULT_HERO_PATH = "/heroes/default.webp";

const R2_PATH_PREFIX = "articles/hero";

// ───── Public input/output ───────────────────────────────────────────────────

const ParsedEntrySchema = z.object({
  filePath: z.string(),
  gitSha: z.string(),
  collection: z.string(),
  typed: z.record(z.unknown()),
  extras: z.record(z.unknown()),
  metadata: z.record(z.unknown()),
  body: z.string(),
});

const MirrorStatsSchema = z.object({
  mirrored: z.number(),
  reused: z.number(),
  unchanged: z.number(),
  skippedByCollection: z.number(),
  skippedNoHero: z.number(),
  failed: z.number(),
  uniqueHashes: z.number(),
});

const HeroFieldsSchema = z.object({
  heroImageR2Key: z.string(),
  heroImagePublicUrl: z.string(),
  heroImageOriginalR2Key: z.string().nullable(),
  heroImageSourceSha256: z.string(),
  heroImageAltText: z.string().nullable(),
});

const ParsedEntryWithMirrorSchema = ParsedEntrySchema.extend({
  hero: HeroFieldsSchema.nullable(),
});

const InputSchema = z.object({
  projectId: z.string().uuid(),
  astroRepo: AstroRepoConfigSchema,
  headCommitSha: z.string().min(1),
  parsed: z.array(ParsedEntrySchema),
});

const OutputSchema = z.object({
  parsed: z.array(ParsedEntryWithMirrorSchema),
  stats: MirrorStatsSchema,
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

// `AstroRepoConfigSchema` has `.default()` fields → cast pattern.
const InputSchemaCast = InputSchema as z.ZodType<Input>;
const OutputSchemaCast = OutputSchema as z.ZodType<Output>;

export type ParsedEntry = z.infer<typeof ParsedEntrySchema>;
export type HeroFields = z.infer<typeof HeroFieldsSchema>;
export type MirrorStats = z.infer<typeof MirrorStatsSchema>;
export type ParsedEntryWithMirror = z.infer<typeof ParsedEntryWithMirrorSchema>;

// ───── Helper deps (injection seam for tests + backfill) ─────────────────────

export interface MirrorDeps {
  /**
   * Reads the raw bytes of a hero source file from the Astro repo,
   * resolved against `headCommitSha`. Returns null when the path doesn't exist.
   * Implementations:
   *   - production: GitHub-App API blob fetch
   *   - backfill: same GitHub-App fetch
   *   - tests: fixture-table or in-memory fake
   */
  readSourceBytes: (input: {
    repo: AstroRepoConfig;
    refSha: string;
    repoPath: string;
  }) => Promise<{ bytes: Uint8Array; contentType: string } | null>;

  /**
   * Looks for an existing article in the same project whose source hash
   * already matches — used for cross-run dedup. Returns the R2 columns
   * to reuse, or null if no match is found.
   */
  findExistingByHash: (input: {
    projectId: string;
    sha256: string;
  }) => Promise<{
    heroImageR2Key: string;
    heroImagePublicUrl: string;
    heroImageOriginalR2Key: string | null;
  } | null>;

  /**
   * Routes raw image bytes through `@marketing-auto/adapter-image-webp`
   * (Pattern 119). Returns the R2 keys + URLs the caller should stamp on
   * the article row.
   */
  uploadWebp: (input: {
    projectId: string;
    storagePrefix: string;
    bytes: Uint8Array;
    contentType: string;
  }) => Promise<{
    webpKey: string;
    webpUrl: string;
    originalKey: string | null;
  }>;

  log?: Logger;
}

// ───── Pure per-article helper — reused by step + backfill ───────────────────

interface MirrorOneInput {
  projectId: string;
  projectSlug: string;
  repo: AstroRepoConfig;
  refSha: string;
  entry: ParsedEntry;
  /**
   * In-run cache of `sha256 → MirrorResult` so DE+EN siblings with the same
   * bytes pay for ONE upload. Mutated by this function.
   */
  seenHashes: Map<string, HeroFields>;
}

type MirrorOneOutcome =
  | { kind: "mirrored"; fields: HeroFields }
  | { kind: "reused"; fields: HeroFields }
  | { kind: "skipped-collection" }
  | { kind: "skipped-no-hero" }
  | { kind: "failed"; reason: string };

export async function mirrorOneArticle(
  deps: MirrorDeps,
  input: MirrorOneInput,
): Promise<MirrorOneOutcome> {
  const { entry, projectId, projectSlug, repo, refSha, seenHashes } = input;
  const ownLog = deps.log ?? log;

  if (COLLECTIONS_WITHOUT_HERO.has(entry.collection)) {
    return { kind: "skipped-collection" };
  }

  // Resolve the hero reference. Spec D9: alt-text comes from frontmatter,
  // null when missing. We carry alt-text alongside the R2 fields so the
  // upsert step can write it under the same refresh-whitelist.
  const heroRef = pickHeroRef(entry.typed);
  const altRaw = entry.typed["heroImageAlt"];
  const altText: string | null = typeof altRaw === "string" && altRaw.length > 0 ? altRaw : null;

  let resolvedRef: string;
  let usingDefault: boolean;
  if (heroRef && heroRef.length > 0) {
    resolvedRef = heroRef;
    usingDefault = false;
  } else {
    resolvedRef = DEFAULT_HERO_PATH;
    usingDefault = true;
  }

  // Convert the frontmatter ref into a repo-local path.
  // Astro convention: leading `/` denotes the `public/` route.
  // We only support that convention in V1. Refs without a leading slash
  // (relative paths to `src/assets/...`) are reported as `failed` so the
  // backfill output surfaces them for follow-up. See Spec §10 Q for the
  // open assumption.
  const repoPath = repoPathForHeroRef(resolvedRef);
  if (repoPath === null) {
    ownLog.warn(
      {
        slug: entry.typed.slug,
        collection: entry.collection,
        heroRef: resolvedRef,
      },
      "hero-mirror: unsupported hero path shape; only `/public/...` refs are mirrored",
    );
    return { kind: "failed", reason: "unsupported_path_shape" };
  }

  let bytes: Uint8Array;
  let contentType: string;
  try {
    const fetched = await deps.readSourceBytes({ repo, refSha, repoPath });
    if (!fetched) {
      // Default-hero missing surfaces here on the first article. We do not
      // spam the log per entry — the per-failure warn already carries enough
      // context, and the pipeline summary line aggregates the count.
      ownLog.warn(
        {
          slug: entry.typed.slug,
          collection: entry.collection,
          repoPath,
          usingDefault,
        },
        "hero-mirror: source file not found in repo",
      );
      return {
        kind: "failed",
        reason: usingDefault ? "default_hero_missing" : "source_not_found",
      };
    }
    bytes = fetched.bytes;
    contentType = fetched.contentType;
  } catch (err) {
    ownLog.warn(
      {
        slug: entry.typed.slug,
        collection: entry.collection,
        repoPath,
        err,
      },
      "hero-mirror: source fetch failed",
    );
    return { kind: "failed", reason: "fetch_error" };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // (a) In-run dedup
  const cached = seenHashes.get(sha256);
  if (cached) {
    return {
      kind: "reused",
      fields: { ...cached, heroImageAltText: altText },
    };
  }

  // (b) Cross-run dedup — same project, prior import already uploaded these bytes
  const existing = await deps.findExistingByHash({ projectId, sha256 });
  if (existing) {
    const fields: HeroFields = {
      heroImageR2Key: existing.heroImageR2Key,
      heroImagePublicUrl: existing.heroImagePublicUrl,
      heroImageOriginalR2Key: existing.heroImageOriginalR2Key,
      heroImageSourceSha256: sha256,
      heroImageAltText: altText,
    };
    seenHashes.set(sha256, fields);
    return { kind: "reused", fields };
  }

  // (c) New upload
  let upload: Awaited<ReturnType<MirrorDeps["uploadWebp"]>>;
  try {
    upload = await deps.uploadWebp({
      projectId,
      storagePrefix: `${projectSlug}/${R2_PATH_PREFIX}`,
      bytes,
      contentType,
    });
  } catch (err) {
    ownLog.warn(
      {
        slug: entry.typed.slug,
        collection: entry.collection,
        repoPath,
        err,
      },
      "hero-mirror: webp conversion / R2 upload failed",
    );
    return { kind: "failed", reason: "upload_error" };
  }

  const fields: HeroFields = {
    heroImageR2Key: upload.webpKey,
    heroImagePublicUrl: upload.webpUrl,
    heroImageOriginalR2Key: upload.originalKey,
    heroImageSourceSha256: sha256,
    heroImageAltText: altText,
  };
  seenHashes.set(sha256, fields);
  return { kind: "mirrored", fields };
}

// ───── Path resolution + ref extraction ──────────────────────────────────────

function pickHeroRef(typed: Record<string, unknown>): string | null {
  const heroImage = typed["heroImage"];
  if (typeof heroImage === "string" && heroImage.length > 0) return heroImage;
  const image = typed["image"];
  if (typeof image === "string" && image.length > 0) return image;
  return null;
}

/**
 * Convert an Astro frontmatter hero ref into a repo-local path.
 * Supported shapes:
 *   - `/heroes/foo.webp` → `public/heroes/foo.webp`
 *   - `/heroes/default.webp` → `public/heroes/default.webp` (the default fallback)
 * Rejected (returns null — caller logs as `failed`):
 *   - `../assets/foo.webp` (relative to MDX file — Astro src/assets route)
 *   - `https://example.com/foo.webp` (remote)
 *   - `data:image/...` (inline)
 * The strict allow-list keeps V1 scoped to the audit-confirmed Toolwiki pattern.
 * Extend here when a future tenant uses `src/assets/...` refs.
 */
export function repoPathForHeroRef(ref: string): string | null {
  if (ref.startsWith("/")) {
    // Strip the leading slash and stuff into `public/`.
    return `public${ref}`;
  }
  return null;
}

// ───── BaseStep wrapper ──────────────────────────────────────────────────────

export class MirrorHeroImagesStep extends BaseStep<Input, Output> {
  readonly name = "mirror-hero-images";
  readonly inputSchema = InputSchemaCast;
  readonly outputSchema = OutputSchemaCast;

  override estimatedCostEur(): number {
    // R2 PUT operations are free on the Cloudflare plan; sharp CPU is local.
    // No external paid API → no cost-tracker integration required.
    return 0;
  }

  override pausableInDebug(): boolean {
    // Non-LLM, deterministic; pausing adds no inspection value.
    return false;
  }

  async execute(input: Input, _ctx: StepContext): Promise<Output> {
    const projectSlug = await loadProjectSlug(input.projectId);
    const repo = input.astroRepo as AstroRepoConfig;
    const octokit = await getInstallationOctokit(repo.installationId);

    const deps: MirrorDeps = {
      readSourceBytes: async ({ repo: r, refSha, repoPath }) => {
        return await fetchBytesViaGithub(octokit, r, refSha, repoPath);
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

    const seenHashes = new Map<string, HeroFields>();
    const augmented: ParsedEntryWithMirror[] = [];
    const stats: MirrorStats = {
      mirrored: 0,
      reused: 0,
      unchanged: 0,
      skippedByCollection: 0,
      skippedNoHero: 0,
      failed: 0,
      uniqueHashes: 0,
    };

    for (const entry of input.parsed) {
      const outcome = await mirrorOneArticle(deps, {
        projectId: input.projectId,
        projectSlug,
        repo,
        refSha: input.headCommitSha,
        entry,
        seenHashes,
      });

      switch (outcome.kind) {
        case "mirrored":
          stats.mirrored++;
          augmented.push({ ...entry, hero: outcome.fields });
          break;
        case "reused":
          stats.reused++;
          augmented.push({ ...entry, hero: outcome.fields });
          break;
        case "skipped-collection":
          stats.skippedByCollection++;
          augmented.push({ ...entry, hero: null });
          break;
        case "skipped-no-hero":
          stats.skippedNoHero++;
          augmented.push({ ...entry, hero: null });
          break;
        case "failed":
          stats.failed++;
          augmented.push({ ...entry, hero: null });
          break;
      }
    }

    stats.uniqueHashes = seenHashes.size;

    log.info(
      {
        ...stats,
        totalEntries: input.parsed.length,
      },
      "hero-mirror: complete",
    );

    return { parsed: augmented, stats };
  }
}

// ───── GitHub-API blob fetch ─────────────────────────────────────────────────

type Octokit = Awaited<ReturnType<typeof getInstallationOctokit>>;

/**
 * Resolves a repo path at a specific commit via the GitHub-App API.
 * Returns null when the path does not exist at that commit (404).
 * Throws on other API errors.
 *
 * The two-call sequence (`GET /contents/{path}?ref={sha}` → `GET /git/blobs/{file_sha}`)
 * mirrors how `ParseFrontmatterBatchStep` reads MDX files. The first call
 * gives us the blob SHA pinned to the commit; the second pulls the bytes
 * (base64-encoded). For files ≤ 1 MB the content is returned inline by the
 * `contents` endpoint, but the dedicated blob endpoint works for any size
 * and is what we use uniformly.
 */
async function fetchBytesViaGithub(
  octokit: Octokit,
  repo: AstroRepoConfig,
  refSha: string,
  repoPath: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const contentsRes = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: repo.owner,
        repo: repo.name,
        path: repoPath,
        ref: refSha,
      },
    );
    // Single-file shape — the union excludes directory + submodule by checking
    // the `type` field. Symlinks have no `content` field but their `type` is
    // also `"symlink"`; we treat symlinks as "not a regular file".
    const data = contentsRes.data;
    if (Array.isArray(data) || data.type !== "file") {
      return null;
    }
    const fileSha = (data as { sha?: string }).sha;
    if (!fileSha) return null;

    const blobRes = await octokit.request(
      "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
      { owner: repo.owner, repo: repo.name, file_sha: fileSha },
    );
    const buf = Buffer.from(blobRes.data.content, "base64");
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const contentType = contentTypeFromPath(repoPath);
    return { bytes, contentType };
  } catch (err) {
    // Octokit throws on 404 — surface as "not found" so the caller can route
    // to the default-hero-missing / source-not-found branches.
    if (isOctokitNotFound(err)) return null;
    throw err;
  }
}

function isOctokitNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 404
  );
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

async function loadProjectSlug(projectId: string): Promise<string> {
  const [row] = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row?.slug) {
    throw new Error(`mirror-hero-images: project ${projectId} not found`);
  }
  return row.slug;
}
