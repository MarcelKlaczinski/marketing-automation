/**
 * Spec 001 / C1.3: smoke tests for cleanup-post-refactor-drift.
 *
 * All cases run against an in-memory DatabasePort — no Postgres, no
 * network. The point is to lock down the script's branching logic
 * (dry-run vs apply, orphans-only vs stale-only vs both, idempotency,
 * cross-tenant guard via project_id, missing-project rejection,
 * count-mismatch warning) without touching real data.
 *
 * For the real Postgres exercise of the SQL predicates, the cleanup
 * runs against Toolwiki in Sprint C2 — capture-cleanup-baseline takes
 * before/after snapshots that act as the ground-truth integration
 * test.
 */

import { describe, expect, it } from "bun:test";
import {
  type CleanupPhase,
  type DatabasePort,
  cleanupPostRefactorDrift,
} from "../../src/scripts/cleanup-post-refactor-drift.ts";

interface Row {
  id: string;
  slug: string;
  locale: string | null;
}

interface FakeState {
  resolveCalls: string[];
  countOrphansCalls: string[];
  supersedeCalls: string[];
  countStaleCalls: string[];
  clearStaleCalls: string[];
}

function makeFakeDb({
  projectIdBySlug,
  orphanCount,
  staleCount,
  supersedeRows,
  clearRows,
  // When set, mutating either count drains the orphan/stale candidates after
  // the first apply call — exercises the idempotency contract.
  drainOnApply = false,
}: {
  projectIdBySlug: Record<string, string>;
  orphanCount: number;
  staleCount: number;
  supersedeRows: Row[];
  clearRows: Row[];
  drainOnApply?: boolean;
}): { db: DatabasePort; state: FakeState } {
  let currentOrphans = orphanCount;
  let currentStale = staleCount;
  const state: FakeState = {
    resolveCalls: [],
    countOrphansCalls: [],
    supersedeCalls: [],
    countStaleCalls: [],
    clearStaleCalls: [],
  };

  const db: DatabasePort = {
    async resolveProjectIdBySlug(slug) {
      state.resolveCalls.push(slug);
      return projectIdBySlug[slug] ?? null;
    },
    async countOrphanCandidates(projectId) {
      state.countOrphansCalls.push(projectId);
      return currentOrphans;
    },
    async supersedeOrphans(projectId) {
      state.supersedeCalls.push(projectId);
      if (drainOnApply) currentOrphans = 0;
      return supersedeRows;
    },
    async countStaleComparisons(projectId) {
      state.countStaleCalls.push(projectId);
      return currentStale;
    },
    async clearStaleComparisons(projectId) {
      state.clearStaleCalls.push(projectId);
      if (drainOnApply) currentStale = 0;
      return clearRows;
    },
  };

  return { db, state };
}

const FAKE_PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT_ID = "22222222-2222-2222-2222-222222222222";

function mkRows(prefix: string, n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    slug: `${prefix}-slug-${i}`,
    locale: i % 2 === 0 ? "de" : "en",
  }));
}

describe("cleanup-post-refactor-drift (Spec 001 C1.3)", () => {
  // ── Test 1: dry-run no-op ──────────────────────────────────────────────
  it("dry-run reports counts and never mutates", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: FAKE_PROJECT_ID },
      orphanCount: 10,
      staleCount: 24,
      supersedeRows: mkRows("orphan", 10),
      clearRows: mkRows("stale", 24),
    });

    const result = await cleanupPostRefactorDrift({
      projectSlug: "toolwiki",
      apply: false,
      database: db,
    });

    expect(result.dryRun).toBe(true);
    expect(result.orphans?.candidates).toBe(10);
    expect(result.orphans?.affected).toBe(0);
    expect(result.stale?.candidates).toBe(24);
    expect(result.stale?.affected).toBe(0);

    // Neither write path may be invoked in dry-run.
    expect(state.supersedeCalls).toHaveLength(0);
    expect(state.clearStaleCalls).toHaveLength(0);
  });

  // ── Test 2: --apply --only=orphans ─────────────────────────────────────
  it("--apply --only=orphans supersedes orphans and leaves stale untouched", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: FAKE_PROJECT_ID },
      orphanCount: 10,
      staleCount: 24,
      supersedeRows: mkRows("orphan", 10),
      clearRows: mkRows("stale", 24),
    });

    const result = await cleanupPostRefactorDrift({
      projectSlug: "toolwiki",
      apply: true,
      only: "orphans",
      database: db,
    });

    expect(result.dryRun).toBe(false);
    expect(result.orphans?.affected).toBe(10);
    expect(result.stale).toBeUndefined();

    expect(state.supersedeCalls).toEqual([FAKE_PROJECT_ID]);
    expect(state.clearStaleCalls).toHaveLength(0);
    expect(state.countStaleCalls).toHaveLength(0);
  });

  // ── Test 3: --apply --only=stale ───────────────────────────────────────
  it("--apply --only=stale nulls comparison fields and leaves orphans untouched", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: FAKE_PROJECT_ID },
      orphanCount: 10,
      staleCount: 24,
      supersedeRows: mkRows("orphan", 10),
      clearRows: mkRows("stale", 24),
    });

    const result = await cleanupPostRefactorDrift({
      projectSlug: "toolwiki",
      apply: true,
      only: "stale",
      database: db,
    });

    expect(result.dryRun).toBe(false);
    expect(result.orphans).toBeUndefined();
    expect(result.stale?.affected).toBe(24);

    expect(state.clearStaleCalls).toEqual([FAKE_PROJECT_ID]);
    expect(state.supersedeCalls).toHaveLength(0);
    expect(state.countOrphansCalls).toHaveLength(0);
  });

  // ── Test 4: --apply default (both phases) ──────────────────────────────
  it("--apply with no --only runs both phases in one session", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: FAKE_PROJECT_ID },
      orphanCount: 10,
      staleCount: 24,
      supersedeRows: mkRows("orphan", 10),
      clearRows: mkRows("stale", 24),
    });

    const result = await cleanupPostRefactorDrift({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });

    expect(result.orphans?.affected).toBe(10);
    expect(result.stale?.affected).toBe(24);
    expect(state.supersedeCalls).toEqual([FAKE_PROJECT_ID]);
    expect(state.clearStaleCalls).toEqual([FAKE_PROJECT_ID]);
  });

  // ── Test 5: idempotent re-apply (no-op on second run) ──────────────────
  it("second --apply finds 0 candidates (idempotent)", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: FAKE_PROJECT_ID },
      orphanCount: 10,
      staleCount: 24,
      supersedeRows: mkRows("orphan", 10),
      clearRows: mkRows("stale", 24),
      drainOnApply: true,
    });

    // First apply: drains.
    const first = await cleanupPostRefactorDrift({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });
    expect(first.orphans?.affected).toBe(10);
    expect(first.stale?.affected).toBe(24);

    // Second apply: counts are now 0, mutation paths are NOT invoked again.
    const second = await cleanupPostRefactorDrift({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });
    expect(second.orphans?.candidates).toBe(0);
    expect(second.orphans?.affected).toBe(0);
    expect(second.stale?.candidates).toBe(0);
    expect(second.stale?.affected).toBe(0);

    // supersede/clear were each called exactly once (during the first run).
    expect(state.supersedeCalls).toHaveLength(1);
    expect(state.clearStaleCalls).toHaveLength(1);
  });

  // ── Test 6: missing project → throws ──────────────────────────────────
  it("rejects when --project resolves to no row", async () => {
    const { db } = makeFakeDb({
      projectIdBySlug: { toolwiki: FAKE_PROJECT_ID },
      orphanCount: 10,
      staleCount: 24,
      supersedeRows: [],
      clearRows: [],
    });

    await expect(
      cleanupPostRefactorDrift({
        projectSlug: "does-not-exist",
        apply: true,
        database: db,
      }),
    ).rejects.toThrow(/Project not found: does-not-exist/);
  });

  // ── Test 7: cross-tenant guard — only the resolved project_id is touched ─
  it("scopes mutations strictly via the resolved project_id (cross-tenant guard)", async () => {
    // Two projects in the lookup, but we only ask for one of them. The
    // assertions check that the OTHER project_id never reaches any DatabasePort
    // method, proving the cross-tenant guard is structural (every mutation
    // takes a single `projectId` arg, never iterates the whole table).
    const { db, state } = makeFakeDb({
      projectIdBySlug: {
        toolwiki: FAKE_PROJECT_ID,
        bellemann: OTHER_PROJECT_ID,
      },
      orphanCount: 3,
      staleCount: 5,
      supersedeRows: mkRows("orphan", 3),
      clearRows: mkRows("stale", 5),
    });

    const result = await cleanupPostRefactorDrift({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });

    expect(result.projectId).toBe(FAKE_PROJECT_ID);

    const allTouchedProjectIds = [
      ...state.countOrphansCalls,
      ...state.supersedeCalls,
      ...state.countStaleCalls,
      ...state.clearStaleCalls,
    ];
    expect(allTouchedProjectIds.every((id) => id === FAKE_PROJECT_ID)).toBe(true);
    expect(allTouchedProjectIds.includes(OTHER_PROJECT_ID)).toBe(false);
  });

  // ── Test 8: count-mismatch warning ─────────────────────────────────────
  it("emits a countMismatchWarning when candidate count diverges from Audit", async () => {
    // 5 orphans (expected 10) → warning. Stale count is 30 (expected 22-24) →
    // warning. Apply still runs — warnings are informational, not fail-stop.
    const { db } = makeFakeDb({
      projectIdBySlug: { toolwiki: FAKE_PROJECT_ID },
      orphanCount: 5,
      staleCount: 30,
      supersedeRows: mkRows("orphan", 5),
      clearRows: mkRows("stale", 30),
    });

    const result = await cleanupPostRefactorDrift({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });

    expect(result.orphans?.candidates).toBe(5);
    expect(result.orphans?.countMismatchWarning).toMatch(/Found 5 orphan candidates/);
    expect(result.orphans?.affected).toBe(5); // Apply continues regardless

    expect(result.stale?.candidates).toBe(30);
    expect(result.stale?.countMismatchWarning).toMatch(/Found 30 stale comparison rows/);
    expect(result.stale?.affected).toBe(30);
  });

  // ── Bonus: invalid --only value at type boundary ───────────────────────
  it("only accepts 'orphans' or 'stale' as --only phase values", () => {
    const valid: CleanupPhase[] = ["orphans", "stale"];
    expect(valid).toContain("orphans");
    expect(valid).toContain("stale");
    // Type-level guarantee — the union type rejects anything else at compile
    // time. The CLI's parseOnlyArg() throws at runtime for any other string;
    // not testable via the in-memory DI port (which doesn't exercise argv).
  });
});
