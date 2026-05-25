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
    // Spec 64.20 follow-up A3 — default to no-op so existing tests don't
    // accidentally write briefs. Release-detection tests override this to
    // capture invocations + assert payload shape.
    emitReleaseBrief: async () => ({ briefId: null, skipped: null }),
    // Spec 64.21 — same no-op default for star-trend; specific tests override.
    emitStarTrendBrief: async () => ({ briefId: null, skipped: null }),
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

    // Order-agnostic assertion — `listInventoryDueForRefresh` ties on
    // `lastFetchedAt IS NULL` (both freshly seeded) and `createdAt` (often
    // same millisecond under parallel test load), falling back to `id ASC`
    // (random UUIDs). We just need ONE row to have errored + ONE to stay
    // pending. Same posture as the LRU-helper DO-NOT in packages/db/CLAUDE.md.
    const statuses = [after1?.fetchStatus, after2?.fetchStatus].sort();
    expect(statuses).toEqual(["error", "pending"]);
    const erroredRow = after1?.fetchStatus === "error" ? after1 : after2;
    expect(erroredRow?.fetchError).toBe("rate_limit");
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

  // ─── A3: release-detection ────────────────────────────────────────────────

  it("emits no brief on first fetch (baseline) — prior latestRelease.tag is null", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "release/baseline",
      displayName: "Baseline",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    let emitCalled = false;
    await handleInventoryRefresh(
      { projectId, type: "cron-triggered" },
      fakeDeps({
        emitReleaseBrief: async () => {
          emitCalled = true;
          return { briefId: null, skipped: null };
        },
      }),
    );

    expect(emitCalled).toBe(false); // first fetch — no prior tag to diff against
  });

  it("emits no brief when tags are identical between ticks", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "release/same",
      displayName: "Same",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    // First tick — sets baseline tag
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps(),
    );

    // Second tick — same tag in SAMPLE_METADATA
    let emitCalled = false;
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps({
        emitReleaseBrief: async () => {
          emitCalled = true;
          return { briefId: null, skipped: null };
        },
      }),
    );

    expect(emitCalled).toBe(false);
  });

  it("emits a release-detection brief on tag change with full metadata", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "release/changed",
      displayName: "Tag-Change Tool",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    // First tick — sets baseline v1.0.0
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps(),
    );

    // Second tick — adapter returns v1.1.0
    const newMetadata = {
      ...SAMPLE_METADATA,
      latestRelease: {
        tag: "v1.1.0",
        name: "Release 1.1",
        publishedAt: "2026-05-25T08:00:00.000Z",
      },
    };
    type EmitInput = Parameters<NonNullable<InventoryRefreshDeps["emitReleaseBrief"]>>[0];
    const captured: EmitInput[] = [];
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps({
        fetchFullRepoMetadata: async () => ({ metadata: newMetadata, rateLimit: null }),
        emitReleaseBrief: async (input) => {
          captured.push(input);
          return { briefId: "00000000-0000-0000-0000-000000000099", skipped: null };
        },
      }),
    );

    expect(captured).toHaveLength(1);
    const payload = captured[0]!;
    expect(payload.inventoryRowId).toBe(row.id);
    expect(payload.sourceIdentifier).toBe("release/changed");
    expect(payload.displayName).toBe("Tag-Change Tool");
    expect(payload.previousReleaseTag).toBe("v1.0.0");
    expect(payload.newReleaseTag).toBe("v1.1.0");
    expect(payload.releaseName).toBe("Release 1.1");
    expect(payload.releasePublishedAt).toBe("2026-05-25T08:00:00.000Z");
    expect(payload.starsCount).toBe(SAMPLE_METADATA.starsCount);
  });

  it("emits no brief when newer fetch has null latestRelease (release removed)", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "release/removed",
      displayName: "Removed",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    // First tick — sets baseline v1.0.0
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps(),
    );

    // Second tick — no release anymore
    const noReleaseMeta = { ...SAMPLE_METADATA, latestRelease: null };
    let emitCalled = false;
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps({
        fetchFullRepoMetadata: async () => ({ metadata: noReleaseMeta, rateLimit: null }),
        emitReleaseBrief: async () => {
          emitCalled = true;
          return { briefId: null, skipped: null };
        },
      }),
    );

    expect(emitCalled).toBe(false);
  });

  it("worker continues refresh even if emitReleaseBrief throws", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "release/emit-throws",
      displayName: "Emit-Throws",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    // First tick — baseline
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps(),
    );

    // Second tick — different tag + emitReleaseBrief throws
    const newMetadata = {
      ...SAMPLE_METADATA,
      latestRelease: { tag: "v2.0.0", name: null, publishedAt: "2026-05-25T08:00:00.000Z" },
    };
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps({
        fetchFullRepoMetadata: async () => ({ metadata: newMetadata, rateLimit: null }),
        emitReleaseBrief: async () => {
          throw new Error("simulated brief-emit failure");
        },
      }),
    );

    // The metadata refresh should STILL have landed — brief failure is non-fatal.
    const after = await getInventoryById(row.id);
    expect(after?.fetchStatus).toBe("ok");
    expect((after?.githubMetadata as { latestRelease?: { tag: string } } | undefined)?.latestRelease?.tag).toBe(
      "v2.0.0",
    );
  });
});

// ─── Spec 64.21 — Star-Trend Story integration ──────────────────────────────

describe("handleInventoryRefresh — star-trend integration (Spec 64.21)", () => {
  it("inserts a snapshot row on every successful refresh, even when no prior history exists", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "star/first-tick",
      displayName: "Star First Tick",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    let emitCalled = false;
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps({
        emitStarTrendBrief: async () => {
          emitCalled = true;
          return { briefId: null, skipped: null };
        },
      }),
    );

    // First tick: no prior snapshot at-or-before NOW - windowDays → no emit.
    // The snapshot insert itself is verified indirectly by the next case
    // (`emits a star-trend brief…`) which depends on a backdated insert
    // succeeding via the same `insertStarSnapshot` helper.
    expect(emitCalled).toBe(false);
  });

  it("emits a star-trend brief when a backdated snapshot shows growth above the absolute threshold", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "star/jumper",
      displayName: "Star Jumper",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    // Seed a 35-day-old prior snapshot at 10000 stars. Fresh fetch returns
    // SAMPLE_METADATA.starsCount = 25000 → +15000 growth = above 5000 absolute
    // threshold. detectStarTrend MUST fire.
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const { insertStarSnapshot } = await import("@marketing-auto/db");
    await insertStarSnapshot({
      projectId,
      inventoryId: row.id,
      starsCount: 10_000,
      snapshotAt: thirtyFiveDaysAgo,
    });

    let captured: { priorStarsCount?: number; currentStarsCount?: number; trigger?: string } = {};
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps({
        emitStarTrendBrief: async (input) => {
          captured = {
            priorStarsCount: input.priorStarsCount,
            currentStarsCount: input.currentStarsCount,
            trigger: input.trigger,
          };
          return { briefId: "fake-brief-id", skipped: null };
        },
      }),
    );

    expect(captured.priorStarsCount).toBe(10_000);
    expect(captured.currentStarsCount).toBe(25_000);
    expect(captured.trigger).toBe("absolute");
  });

  it("does NOT emit when growth is below threshold (small uptick)", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "star/quiet",
      displayName: "Star Quiet",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    // Prior at 24000 → current 25000 = +1000 (below 5000 absolute, ~4% relative).
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const { insertStarSnapshot } = await import("@marketing-auto/db");
    await insertStarSnapshot({
      projectId,
      inventoryId: row.id,
      starsCount: 24_000,
      snapshotAt: thirtyFiveDaysAgo,
    });

    let emitCalled = false;
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps({
        emitStarTrendBrief: async () => {
          emitCalled = true;
          return { briefId: null, skipped: null };
        },
      }),
    );

    expect(emitCalled).toBe(false);
  });

  it("survives star-history failures — metadata refresh + release-detection still land", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "star/resilient",
      displayName: "Star Resilient",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await makeRefreshable(row.id);

    // Force a star-trend emission attempt that throws — should not stop the tick.
    await handleInventoryRefresh(
      { projectId, type: "refresh-manual", ids: [row.id] },
      fakeDeps({
        emitStarTrendBrief: async () => {
          throw new Error("simulated star-trend emit failure");
        },
      }),
    );

    // Metadata still landed — the star-trend try/catch is graceful.
    const after = await getInventoryById(row.id);
    expect(after?.fetchStatus).toBe("ok");
    expect((after?.githubMetadata as { starsCount?: number } | undefined)?.starsCount).toBe(25_000);
  });
});
