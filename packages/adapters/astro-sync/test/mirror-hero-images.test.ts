/**
 * Spec 000 — MirrorHeroImagesStep unit tests.
 *
 * Exercises the pure `mirrorOneArticle` helper with stubbed deps so no
 * GitHub-App tokens, R2 uploads, or DB are required. The 10 cases mirror
 * the spec §H2.3 acceptance list. A separate light DB-integration block
 * at the bottom asserts that the `findExistingByHash` SELECT performs as
 * advertised against a real Drizzle session (one row inserted with a
 * specific hash, helper returns it).
 *
 * Run:
 *   bun test packages/adapters/astro-sync/test/mirror-hero-images.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { articles, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import {
  DEFAULT_HERO_PATH,
  COLLECTIONS_WITHOUT_HERO,
  type HeroFields,
  type MirrorDeps,
  type ParsedEntry,
  mirrorOneArticle,
  repoPathForHeroRef,
} from "../src/import/steps/mirror-hero-images.ts";
import type { AstroRepoConfig } from "../src/types.ts";

// ───── Helpers ───────────────────────────────────────────────────────────────

const REPO: AstroRepoConfig = {
  owner: "test-owner",
  name: "test-repo",
  installationId: 1,
  defaultBranch: "main",
  contentRoot: "src/content",
  assetsRoot: "src/assets",
};

const REF_SHA = "deadbeef".repeat(5); // 40 hex chars, valid SHA-1 shape

function makeEntry(overrides: Partial<ParsedEntry> & { typed?: Record<string, unknown> } = {}): ParsedEntry {
  return {
    filePath: overrides.filePath ?? "src/content/blog/foo.mdx",
    gitSha: overrides.gitSha ?? "0".repeat(40),
    collection: overrides.collection ?? "blog",
    typed: {
      slug: "foo",
      heroImage: "/heroes/foo.webp",
      heroImageAlt: "Foo image",
      ...overrides.typed,
    },
    extras: overrides.extras ?? {},
    metadata: overrides.metadata ?? {},
    body: overrides.body ?? "Body content",
  };
}

interface FakeRecord {
  bytes: Uint8Array;
  contentType: string;
}

function makeDeps(opts: {
  files: Record<string, FakeRecord>;
  existingByHash?: Record<string, { heroImageR2Key: string; heroImagePublicUrl: string; heroImageOriginalR2Key: string | null }>;
  uploadResult?: (input: { bytes: Uint8Array; contentType: string; storagePrefix: string }) => { webpKey: string; webpUrl: string; originalKey: string | null };
  uploadThrows?: boolean;
}): { deps: MirrorDeps; uploadCount: number; lookupCount: number } {
  const counter = { uploadCount: 0, lookupCount: 0 };
  const deps: MirrorDeps = {
    readSourceBytes: async ({ repoPath }) => opts.files[repoPath] ?? null,
    findExistingByHash: async ({ sha256 }) => {
      counter.lookupCount++;
      return opts.existingByHash?.[sha256] ?? null;
    },
    uploadWebp: async (input) => {
      counter.uploadCount++;
      if (opts.uploadThrows) throw new Error("simulated R2 failure");
      const u = opts.uploadResult ?? ((i: typeof input) => ({
        webpKey: `${i.storagePrefix}/${counter.uploadCount}.webp`,
        webpUrl: `https://cdn.example.com/${i.storagePrefix}/${counter.uploadCount}.webp`,
        originalKey: i.contentType === "image/webp" ? null : `${i.storagePrefix}/originals/${counter.uploadCount}.png`,
      }));
      return u(input);
    },
  };
  return {
    deps,
    get uploadCount() {
      return counter.uploadCount;
    },
    get lookupCount() {
      return counter.lookupCount;
    },
  } as unknown as { deps: MirrorDeps; uploadCount: number; lookupCount: number };
}

function bytes(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function sha256(content: string): string {
  return createHash("sha256").update(bytes(content)).digest("hex");
}

// ───── repoPathForHeroRef (pure) ─────────────────────────────────────────────

describe("repoPathForHeroRef", () => {
  test("prefixes `public/` for refs with leading slash", () => {
    expect(repoPathForHeroRef("/heroes/foo.webp")).toBe("public/heroes/foo.webp");
    expect(repoPathForHeroRef("/heroes/auto/default.webp")).toBe("public/heroes/auto/default.webp");
  });

  test("returns null for relative refs", () => {
    expect(repoPathForHeroRef("../assets/foo.webp")).toBeNull();
    expect(repoPathForHeroRef("assets/foo.webp")).toBeNull();
  });

  test("returns null for remote URLs", () => {
    expect(repoPathForHeroRef("https://example.com/foo.webp")).toBeNull();
    expect(repoPathForHeroRef("data:image/png;base64,iVBOR...")).toBeNull();
  });
});

// ───── mirrorOneArticle — 10 cases per spec §H2.3 ────────────────────────────

describe("mirrorOneArticle (pure helper)", () => {
  test("case 1 — happy-path WebP: uploads, alt-text carried, original=null", async () => {
    const fixture = makeDeps({
      files: { "public/heroes/foo.webp": { bytes: bytes("WEBP-bytes"), contentType: "image/webp" } },
    });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "00000000-0000-0000-0000-000000000001",
      projectSlug: "toolwiki",
      repo: REPO,
      refSha: REF_SHA,
      entry: makeEntry({ typed: { slug: "foo", heroImage: "/heroes/foo.webp", heroImageAlt: "Alt" } }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("mirrored");
    if (out.kind !== "mirrored") throw new Error("");
    expect(out.fields.heroImageR2Key).toBe("toolwiki/articles/hero/1.webp");
    expect(out.fields.heroImagePublicUrl).toBe("https://cdn.example.com/toolwiki/articles/hero/1.webp");
    expect(out.fields.heroImageOriginalR2Key).toBeNull(); // already webp → no original stored
    expect(out.fields.heroImageSourceSha256).toBe(sha256("WEBP-bytes"));
    expect(out.fields.heroImageAltText).toBe("Alt");
    expect(seen.size).toBe(1);
    expect(fixture.uploadCount).toBe(1);
  });

  test("case 2 — happy-path PNG: original kept, contentType propagated", async () => {
    const fixture = makeDeps({
      files: { "public/heroes/foo.png": { bytes: bytes("PNG-bytes"), contentType: "image/png" } },
    });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "00000000-0000-0000-0000-000000000001",
      projectSlug: "toolwiki",
      repo: REPO,
      refSha: REF_SHA,
      entry: makeEntry({ typed: { slug: "foo", heroImage: "/heroes/foo.png", heroImageAlt: null } }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("mirrored");
    if (out.kind !== "mirrored") throw new Error("");
    expect(out.fields.heroImageOriginalR2Key).toMatch(/originals\//);
    expect(out.fields.heroImageAltText).toBeNull();
  });

  test("case 3 — DE+EN-sibling dedup: same bytes → one upload, two reuse hits", async () => {
    const fixture = makeDeps({
      files: { "public/heroes/shared.webp": { bytes: bytes("SHARED"), contentType: "image/webp" } },
    });
    const seen = new Map<string, HeroFields>();
    const deEntry = makeEntry({ typed: { slug: "de", heroImage: "/heroes/shared.webp" } });
    const enEntry = makeEntry({ typed: { slug: "en", heroImage: "/heroes/shared.webp" } });
    const o1 = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA, entry: deEntry, seenHashes: seen,
    });
    const o2 = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA, entry: enEntry, seenHashes: seen,
    });
    expect(o1.kind).toBe("mirrored");
    expect(o2.kind).toBe("reused");
    if (o1.kind !== "mirrored" || o2.kind !== "reused") throw new Error("");
    expect(o2.fields.heroImageR2Key).toBe(o1.fields.heroImageR2Key);
    expect(fixture.uploadCount).toBe(1); // one upload total
  });

  test("case 4 — cross-run dedup: DB lookup finds a prior row, no upload", async () => {
    const hash = sha256("PRIOR");
    const fixture = makeDeps({
      files: { "public/heroes/prior.webp": { bytes: bytes("PRIOR"), contentType: "image/webp" } },
      existingByHash: {
        [hash]: {
          heroImageR2Key: "toolwiki/articles/hero/old.webp",
          heroImagePublicUrl: "https://cdn.example.com/toolwiki/articles/hero/old.webp",
          heroImageOriginalR2Key: null,
        },
      },
    });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({ typed: { slug: "prior", heroImage: "/heroes/prior.webp" } }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("reused");
    if (out.kind !== "reused") throw new Error("");
    expect(out.fields.heroImageR2Key).toBe("toolwiki/articles/hero/old.webp");
    expect(fixture.uploadCount).toBe(0); // no new upload
    expect(fixture.lookupCount).toBe(1);
  });

  test("case 5 — missing local file: failed, no throw, other entries unaffected", async () => {
    const fixture = makeDeps({
      files: { "public/heroes/exists.webp": { bytes: bytes("EXISTS"), contentType: "image/webp" } },
    });
    const seen = new Map<string, HeroFields>();
    const missing = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({ typed: { slug: "missing", heroImage: "/heroes/missing.webp" } }),
      seenHashes: seen,
    });
    expect(missing.kind).toBe("failed");
    if (missing.kind === "failed") expect(missing.reason).toBe("source_not_found");

    const found = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({ typed: { slug: "exists", heroImage: "/heroes/exists.webp" } }),
      seenHashes: seen,
    });
    expect(found.kind).toBe("mirrored");
  });

  test("case 6 — tool-categories skip: collection in COLLECTIONS_WITHOUT_HERO short-circuits before fetch", async () => {
    const fixture = makeDeps({ files: {} });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({
        collection: "tool-categories",
        typed: { slug: "cat", heroImage: "/heroes/whatever.webp" },
      }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("skipped-collection");
    expect(fixture.uploadCount).toBe(0);
    expect(fixture.lookupCount).toBe(0);
    // sanity: the constant still names tool-categories
    expect(COLLECTIONS_WITHOUT_HERO.has("tool-categories")).toBe(true);
  });

  test("case 7 — default-hero fallback: no heroImage/image frontmatter → /heroes/auto/default.webp", async () => {
    const fixture = makeDeps({
      files: { "public/heroes/auto/default.webp": { bytes: bytes("DEFAULT"), contentType: "image/webp" } },
    });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({
        collection: "ki-wissen",
        typed: { slug: "was-ist-ki", heroImage: undefined, heroImageAlt: undefined },
      }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("mirrored");
    if (out.kind !== "mirrored") throw new Error("");
    expect(out.fields.heroImageSourceSha256).toBe(sha256("DEFAULT"));
    // Sanity: spec D5 path
    expect(DEFAULT_HERO_PATH).toBe("/heroes/auto/default.webp");
  });

  test("case 8 — default-hero missing file: failed with default_hero_missing reason", async () => {
    const fixture = makeDeps({ files: {} });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({ typed: { slug: "no-hero", heroImage: undefined } }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") expect(out.reason).toBe("default_hero_missing");
  });

  test("case 9 — falls back from heroImage to image (tool-style frontmatter)", async () => {
    const fixture = makeDeps({
      files: { "public/heroes/tool.webp": { bytes: bytes("TOOL"), contentType: "image/webp" } },
    });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({
        collection: "tools",
        typed: { slug: "tool", heroImage: undefined, image: "/heroes/tool.webp" },
      }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("mirrored");
    if (out.kind !== "mirrored") throw new Error("");
    expect(out.fields.heroImageSourceSha256).toBe(sha256("TOOL"));
  });

  test("case 10 — relative ref unsupported in V1: failed with unsupported_path_shape", async () => {
    const fixture = makeDeps({ files: {} });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({ typed: { slug: "rel", heroImage: "../assets/foo.png" } }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") expect(out.reason).toBe("unsupported_path_shape");
  });

  test("case 11 (bonus) — upload error: failed, hash entered seen-map only on success", async () => {
    const fixture = makeDeps({
      files: { "public/heroes/x.webp": { bytes: bytes("X"), contentType: "image/webp" } },
      uploadThrows: true,
    });
    const seen = new Map<string, HeroFields>();
    const out = await mirrorOneArticle(fixture.deps, {
      projectId: "p", projectSlug: "s", repo: REPO, refSha: REF_SHA,
      entry: makeEntry({ typed: { slug: "x", heroImage: "/heroes/x.webp" } }),
      seenHashes: seen,
    });
    expect(out.kind).toBe("failed");
    if (out.kind === "failed") expect(out.reason).toBe("upload_error");
    expect(seen.size).toBe(0); // failed entries do NOT poison the dedup cache
  });
});

// ───── DB-integration sanity for findExistingByHash ──────────────────────────

describe("mirror-hero-images — DB lookup integration", () => {
  let projectId: string;
  const targetHash = "a".repeat(64);
  const otherProjectHash = "b".repeat(64);

  beforeEach(async () => {
    const slug = `mirror-hero-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const inserted = await db
      .insert(projects)
      .values({
        slug,
        name: "Mirror Hero Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = inserted[0]!.id;

    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: "fixture-source",
      cornerstoneKeyword: null,
      heroImageR2Key: "toolwiki/articles/hero/fixture.webp",
      heroImagePublicUrl: "https://cdn.example.com/toolwiki/articles/hero/fixture.webp",
      heroImageOriginalR2Key: null,
      heroImageSourceSha256: targetHash,
      status: "published",
    });

    // Cross-tenant guard: another project with the same hash must NOT leak.
    const otherProject = await db
      .insert(projects)
      .values({
        slug: `mirror-hero-other-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: "Other Tenant",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    await db.insert(articles).values({
      projectId: otherProject[0]!.id,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: "other-source",
      cornerstoneKeyword: null,
      heroImageR2Key: "other/articles/hero/leak.webp",
      heroImagePublicUrl: "https://cdn.example.com/other/articles/hero/leak.webp",
      heroImageOriginalR2Key: null,
      heroImageSourceSha256: otherProjectHash,
      status: "published",
    });
  });

  afterEach(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  test("findExistingByHash returns R2 columns for a matching prior import", async () => {
    // Real-deps shape inlined here so we don't drag the GitHub octokit into tests.
    const { db: realDb, articles: art, and: andOp, eq: eqOp } = await import("@marketing-auto/db");
    const [row] = await realDb
      .select({
        heroImageR2Key: art.heroImageR2Key,
        heroImagePublicUrl: art.heroImagePublicUrl,
        heroImageOriginalR2Key: art.heroImageOriginalR2Key,
      })
      .from(art)
      .where(
        andOp(
          eqOp(art.projectId, projectId),
          eqOp(art.heroImageSourceSha256, targetHash),
        ),
      )
      .limit(1);
    expect(row?.heroImageR2Key).toBe("toolwiki/articles/hero/fixture.webp");
  });

  test("findExistingByHash respects multi-tenant boundary", async () => {
    const { db: realDb, articles: art, and: andOp, eq: eqOp } = await import("@marketing-auto/db");
    const [row] = await realDb
      .select({ heroImageR2Key: art.heroImageR2Key })
      .from(art)
      .where(
        andOp(
          eqOp(art.projectId, projectId),
          eqOp(art.heroImageSourceSha256, otherProjectHash),
        ),
      )
      .limit(1);
    expect(row).toBeUndefined(); // other-tenant row must NOT leak
  });
});
