/**
 * Spec 000 — smoke tests for the `backfill-imported-heroes` CLI script.
 *
 * The script's I/O is fully decoupled via DatabasePort + GithubPort + UploadPort,
 * so these tests run with in-memory fakes — no DB, no R2, no GitHub.
 *
 * Run:
 *   bun test apps/api/test/scripts/backfill-imported-heroes.smoke.test.ts
 */

import { describe, expect, it } from "bun:test";
import type { AstroRepoConfig } from "@marketing-auto/adapter-astro-sync";
import {
  type CandidateRow,
  type DatabasePort,
  type GithubPort,
  type UploadPort,
  backfillImportedHeroes,
} from "../../src/scripts/backfill-imported-heroes.ts";

const REPO: AstroRepoConfig = {
  owner: "test-owner",
  name: "test-repo",
  installationId: 1,
  defaultBranch: "main",
  contentRoot: "src/content",
  assetsRoot: "src/assets",
};
const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

function makeDb(opts: {
  projectExists?: boolean;
  candidates?: CandidateRow[];
  totalCandidates?: number;
}): { port: DatabasePort; updateCalls: Array<{ articleId: string; hash: string }> } {
  const updateCalls: Array<{ articleId: string; hash: string }> = [];
  const port: DatabasePort = {
    async resolveProject(slug) {
      if (opts.projectExists === false) return null;
      return { id: PROJECT_ID, slug, astroRepo: REPO };
    },
    async countCandidates() {
      return opts.totalCandidates ?? opts.candidates?.length ?? 0;
    },
    async loadCandidates(_pid, limit) {
      const all = opts.candidates ?? [];
      return typeof limit === "number" ? all.slice(0, limit) : all;
    },
    async findExistingByHash() {
      return null; // tests don't exercise cross-run dedup here
    },
    async updateHeroColumns({ articleId, hero }) {
      updateCalls.push({ articleId, hash: hero.heroImageSourceSha256 });
    },
  };
  return { port, updateCalls };
}

function makeGithub(files: Record<string, { bytes: Uint8Array; contentType: string }>): GithubPort {
  return {
    async resolveHead() {
      return "abc123";
    },
    async readBytes({ repoPath }) {
      return files[repoPath] ?? null;
    },
  };
}

function makeUpload(): { port: UploadPort; count: number } {
  let count = 0;
  const port: UploadPort = {
    async upload({ storagePrefix }) {
      count++;
      return {
        webpKey: `${storagePrefix}/${count}.webp`,
        webpUrl: `https://cdn.example.com/${storagePrefix}/${count}.webp`,
        originalKey: null,
      };
    },
  };
  return {
    port,
    get count() {
      return count;
    },
  } as { port: UploadPort; count: number };
}

function candidate(over: Partial<CandidateRow> & { heroImage?: string }): CandidateRow {
  return {
    id: over.id ?? `${Math.random().toString(36).slice(2)}-id`,
    slug: over.slug ?? "slug",
    locale: over.locale ?? "de",
    collection: over.collection ?? "blog",
    domainExtras: { heroImage: over.heroImage ?? "/heroes/foo.webp" },
    importMetadata: null,
    heroImageAltTextExisting: null,
  };
}

describe("backfill-imported-heroes (Spec 000)", () => {
  it("dry-run reports the candidate count without touching anything", async () => {
    const db = makeDb({ totalCandidates: 42 });
    const upload = makeUpload();
    const result = await backfillImportedHeroes({
      projectSlug: "toolwiki",
      apply: false,
      databasePort: db.port,
      uploadPort: upload.port,
      githubPort: makeGithub({}),
    });
    expect(result.apply).toBe(false);
    expect(result.totalCandidates).toBe(42);
    expect(result.processed).toBe(0);
    expect(result.mirrored).toBe(0);
    expect(db.updateCalls).toHaveLength(0);
    expect(upload.count).toBe(0); // no upload, no GitHub fetch, no spin
  });

  it("--apply mirrors a single article and writes the hero columns", async () => {
    const candA = candidate({ id: "a", slug: "a", heroImage: "/heroes/a.webp" });
    const db = makeDb({ candidates: [candA] });
    const upload = makeUpload();
    const github = makeGithub({
      "public/heroes/a.webp": { bytes: new TextEncoder().encode("A"), contentType: "image/webp" },
    });
    const result = await backfillImportedHeroes({
      projectSlug: "toolwiki",
      apply: true,
      databasePort: db.port,
      uploadPort: upload.port,
      githubPort: github,
    });
    expect(result.apply).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.mirrored).toBe(1);
    expect(db.updateCalls).toHaveLength(1);
    expect(db.updateCalls[0]?.articleId).toBe("a");
    expect(db.updateCalls[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(upload.count).toBe(1);
  });

  it("--apply: DE+EN siblings sharing a hero file dedup to one upload", async () => {
    const sharedHero = "/heroes/shared.webp";
    const de = candidate({ id: "de", slug: "x-de", locale: "de", heroImage: sharedHero });
    const en = candidate({ id: "en", slug: "x-en", locale: "en", heroImage: sharedHero });
    const db = makeDb({ candidates: [de, en] });
    const upload = makeUpload();
    const github = makeGithub({
      "public/heroes/shared.webp": {
        bytes: new TextEncoder().encode("SHARED"),
        contentType: "image/webp",
      },
    });
    const result = await backfillImportedHeroes({
      projectSlug: "toolwiki",
      apply: true,
      databasePort: db.port,
      uploadPort: upload.port,
      githubPort: github,
    });
    expect(result.processed).toBe(2);
    expect(result.mirrored).toBe(1); // one upload
    expect(result.reused).toBe(1);   // sibling reused via in-run cache
    expect(upload.count).toBe(1);
    expect(db.updateCalls).toHaveLength(2);
    expect(db.updateCalls[0]?.hash).toBe(db.updateCalls[1]?.hash);
  });

  it("--apply: failed rows do not poison the dedup cache and other rows succeed", async () => {
    const okCand = candidate({ id: "ok", slug: "ok", heroImage: "/heroes/ok.webp" });
    const missing = candidate({ id: "missing", slug: "missing", heroImage: "/heroes/missing.webp" });
    const db = makeDb({ candidates: [missing, okCand] });
    const upload = makeUpload();
    const github = makeGithub({
      "public/heroes/ok.webp": { bytes: new TextEncoder().encode("OK"), contentType: "image/webp" },
    });
    const result = await backfillImportedHeroes({
      projectSlug: "toolwiki",
      apply: true,
      databasePort: db.port,
      uploadPort: upload.port,
      githubPort: github,
    });
    expect(result.processed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.mirrored).toBe(1);
    expect(result.failureSamples[0]?.slug).toBe("missing");
    expect(result.failureSamples[0]?.reason).toBe("source_not_found");
    expect(db.updateCalls.map((c) => c.articleId)).toEqual(["ok"]);
  });

  it("--apply with --limit caps the candidate set", async () => {
    const cands: CandidateRow[] = [];
    for (let i = 0; i < 10; i++) {
      cands.push(candidate({ id: `a${i}`, slug: `a${i}`, heroImage: `/heroes/a${i}.webp` }));
    }
    const db = makeDb({ candidates: cands, totalCandidates: 10 });
    const upload = makeUpload();
    const fileFixtures: Record<string, { bytes: Uint8Array; contentType: string }> = {};
    for (let i = 0; i < 10; i++) {
      fileFixtures[`public/heroes/a${i}.webp`] = {
        bytes: new TextEncoder().encode(`A${i}`),
        contentType: "image/webp",
      };
    }
    const github = makeGithub(fileFixtures);
    const result = await backfillImportedHeroes({
      projectSlug: "toolwiki",
      apply: true,
      limit: 3,
      databasePort: db.port,
      uploadPort: upload.port,
      githubPort: github,
    });
    expect(result.totalCandidates).toBe(10);
    expect(result.processed).toBe(3);
    expect(result.mirrored).toBe(3);
    expect(db.updateCalls).toHaveLength(3);
  });

  it("throws when --project slug doesn't resolve", async () => {
    const db = makeDb({ projectExists: false });
    const upload = makeUpload();
    const github = makeGithub({});
    await expect(
      backfillImportedHeroes({
        projectSlug: "nonexistent",
        apply: false,
        databasePort: db.port,
        uploadPort: upload.port,
        githubPort: github,
      }),
    ).rejects.toThrow(/project 'nonexistent' not found/);
  });

  it("falls back to default-hero when an article has no heroImage frontmatter", async () => {
    const noHero = candidate({ id: "x", slug: "x" });
    // strip the default heroImage from domainExtras so the fallback kicks in
    noHero.domainExtras = {};
    const db = makeDb({ candidates: [noHero] });
    const upload = makeUpload();
    const github = makeGithub({
      "public/heroes/default.webp": {
        bytes: new TextEncoder().encode("DEFAULT"),
        contentType: "image/webp",
      },
    });
    const result = await backfillImportedHeroes({
      projectSlug: "toolwiki",
      apply: true,
      databasePort: db.port,
      uploadPort: upload.port,
      githubPort: github,
    });
    expect(result.mirrored).toBe(1);
    expect(db.updateCalls).toHaveLength(1);
  });

  it("treats domainExtras.image as a heroImage fallback (tool-style frontmatter)", async () => {
    const tool = candidate({ id: "t", slug: "t" });
    tool.collection = "tools";
    tool.domainExtras = { image: "/heroes/tool.webp" };
    const db = makeDb({ candidates: [tool] });
    const upload = makeUpload();
    const github = makeGithub({
      "public/heroes/tool.webp": { bytes: new TextEncoder().encode("T"), contentType: "image/webp" },
    });
    const result = await backfillImportedHeroes({
      projectSlug: "toolwiki",
      apply: true,
      databasePort: db.port,
      uploadPort: upload.port,
      githubPort: github,
    });
    expect(result.mirrored).toBe(1);
    expect(upload.count).toBe(1);
  });
});
