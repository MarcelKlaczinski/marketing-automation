// Spec 64.20 — end-to-end test for github-inventory-refresh.worker.
//
// Covers the wiring that DB-helper tests don't reach: the tick handler reads
// PAT from vault, dispatches per-row to the adapter, persists results via
// markInventoryOk / markInventoryError, branches into the skill detector for
// `objectType='skill'`, and short-circuits on rate-limit.
//
// All adapter calls go through DI deps (Pattern 121 — Spec 64.10), keeping
// the test offline and avoiding mock.module global pollution.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  contentSourceInventory,
  createInventoryRow,
  db,
  eq,
  getInventoryById,
  projects,
} from "@marketing-auto/db";
import {
  GitHubRateLimitError,
  type GithubInventoryMetadata,
} from "@marketing-auto/adapter-github-inventory";
import {
  handleInventoryRefresh,
  type InventoryRefreshDeps,
} from "../../src/workers/github-inventory-refresh.worker.ts";

const SAMPLE_METADATA: GithubInventoryMetadata = {
  starsCount: 25000,
  forksCount: 1234,
  watchersCount: 500,
  primaryLanguage: "TypeScript",
  license: "MIT",
  topics: ["ai", "cli"],
  defaultBranch: "main",
  createdAt: "2024-09-01T00:00:00.000Z",
  pushedAt: "2026-05-20T12:00:00.000Z",
  latestRelease: {
    tag: "v1.0.0",
    name: "First Release",
    publishedAt: "2024-12-15T10:00:00.000Z",
  },
};

let projectId: string;

beforeAll(async () => {
  const ts = Date.now();
  const [proj] = await db
    .insert(projects)
    .values({
      slug: `gh-inv-worker-${ts}`,
      name: "GH Inv Worker Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;
});

afterEach(async () => {
  await db.delete(contentSourceInventory).where(eq(contentSourceInventory.projectId, projectId));
});

afterAll(async () => {
  await db.delete(contentSourceInventory).where(eq(contentSourceInventory.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

function fakeDeps(overrides: Partial<InventoryRefreshDeps> = {}): InventoryRefreshDeps {
  return {
    readCreds: async () => ({ personal_access_token: "ghp_fake_for_test" }),
    fetchFullRepoMetadata: async () => ({ metadata: { ...SAMPLE_METADATA }, rateLimit: null }),
    detectSkill: async () => ({ frontmatter: null, rateLimit: null }),
    ...overrides,
  };
}

/**
 * Backdate a row's createdAt past the worker's AGE_BUFFER_SECONDS=30 grace
 * window so cron-triggered mode picks it up. Without this, freshly-INSERTed
 * rows are filtered out of `listInventoryDueForRefresh` and the tick is a
 * no-op against them.
 */
async function makeRefreshable(id: string): Promise<void> {
  await db
    .update(contentSourceInventory)
    .set({ createdAt: new Date(Date.now() - 60_000) })
    .where(eq(contentSourceInventory.id, id));
}

describe("handleInventoryRefresh — end-to-end", () => {
  it("populates metadata + fetchStatus='ok' for a due tool row", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "anthropics/claude-code",
      displayName: "Claude Code",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    await handleInventoryRefresh({ projectId, type: "cron-triggered" }, fakeDeps());

    const after = await getInventoryById(row.id);
    expect(after?.fetchStatus).toBe("ok");
    expect(after?.lastFetchedAt).not.toBeNull();
    expect(after?.fetchError).toBeNull();
    expect(after?.githubMetadata.starsCount).toBe(25000);
    expect(after?.githubMetadata.latestRelease?.tag).toBe("v1.0.0");
  });

  it("branches into skill detector for objectType='skill' and persists frontmatter", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "skill",
      sourceIdentifier: "anthropics/skills:web-design",
      displayName: "Web Design Skill",
      refreshIntervalHours: 720,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    let detectSkillCalledWith = "" as string;
    await handleInventoryRefresh(
      { projectId, type: "cron-triggered" },
      fakeDeps({
        detectSkill: async (sourceIdentifier) => {
          detectSkillCalledWith = sourceIdentifier;
          return {
            frontmatter: {
              name: "web-design",
              description: "Generates web UI mockups",
              category: "development",
            },
            rateLimit: null,
          };
        },
      }),
    );

    expect(detectSkillCalledWith).toBe("anthropics/skills:web-design");
    const after = await getInventoryById(row.id);
    expect(after?.fetchStatus).toBe("ok");
    expect(after?.githubMetadata.skillFrontmatter?.name).toBe("web-design");
    expect(after?.githubMetadata.skillFrontmatter?.category).toBe("development");
  });

  it("persists fetch_error on adapter-thrown error (non-rate-limit)", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "ghost/repo",
      displayName: "Ghost",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    await handleInventoryRefresh(
      { projectId, type: "cron-triggered" },
      fakeDeps({
        fetchFullRepoMetadata: async () => {
          throw new Error("404 not found");
        },
      }),
    );

    const after = await getInventoryById(row.id);
    expect(after?.fetchStatus).toBe("error");
    expect(after?.fetchError).toContain("404 not found");
  });

  it("short-circuits the batch on GitHubRateLimitError; subsequent rows stay pending", async () => {
    const r1 = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "rate/limited",
      displayName: "Rate-limited row",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    const r2 = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "next/row",
      displayName: "Next row",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(r1.id);
    await makeRefreshable(r2.id);

    let callCount = 0;
    await handleInventoryRefresh(
      { projectId, type: "cron-triggered" },
      fakeDeps({
        fetchFullRepoMetadata: async () => {
          callCount += 1;
          throw new GitHubRateLimitError("rate limit exceeded", new Date(Date.now() + 60_000));
        },
      }),
    );

    // Only the first row triggered the adapter; loop broke before the second.
    expect(callCount).toBe(1);
    const after1 = await getInventoryById(r1.id);
    const after2 = await getInventoryById(r2.id);
    expect(after1?.fetchStatus).toBe("error");
    expect(after1?.fetchError).toBe("rate_limit");
    expect(after2?.fetchStatus).toBe("pending"); // untouched
  });

  it("returns silently when no PAT is configured in vault", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "novault/row",
      displayName: "No vault",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });

    let adapterCalled = false;
    await handleInventoryRefresh(
      { projectId, type: "cron-triggered" },
      fakeDeps({
        readCreds: async () => ({}),
        fetchFullRepoMetadata: async () => {
          adapterCalled = true;
          return { metadata: { ...SAMPLE_METADATA }, rateLimit: null };
        },
      }),
    );

    expect(adapterCalled).toBe(false);
    const after = await getInventoryById(row.id);
    expect(after?.fetchStatus).toBe("pending"); // untouched
  });

  it("processes explicit ids via refresh-manual mode", async () => {
    const r1 = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "manual/included",
      displayName: "Included",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    const r2 = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "manual/excluded",
      displayName: "Excluded",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });

    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [r1.id] },
      fakeDeps(),
    );

    const after1 = await getInventoryById(r1.id);
    const after2 = await getInventoryById(r2.id);
    expect(after1?.fetchStatus).toBe("ok");
    expect(after2?.fetchStatus).toBe("pending"); // not in ids[]
  });
});
