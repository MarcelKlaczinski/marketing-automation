/**
 * Spec 002 follow-up — smoke tests for reassign-uncategorized-clusters.
 *
 * In-memory DatabasePort DI fakes; no Postgres roundtrip. Verifies:
 *   - dry-run never mutates
 *   - --apply re-points the clusters + creates target pillar if absent
 *   - --apply with target pillar already present skips creation
 *   - idempotent re-apply (second call finds 0 candidates)
 *   - missing project rejected
 *   - cross-tenant guard (resolved projectId carries through every DB call)
 *   - skip-when-no-config (project without reassignment groups → no-op)
 */

import { describe, expect, it } from "bun:test";
import {
  type DatabasePort,
  reassignUncategorizedClusters,
} from "../../src/scripts/reassign-uncategorized-clusters.ts";

interface FakeState {
  touchedProjectIds: string[];
  createdPillars: Array<{ name: string; description: string }>;
}

interface FakeOptions {
  projectIdBySlug: Record<string, string>;
  /** Map of pillar-name → existing pillar id. Names absent here will trigger createPillar(). */
  existingPillars?: Record<string, string>;
  /**
   * Per-group budget of candidate clusters to reassign. Indexed by target
   * pillar name. Drain after apply so a second call returns 0.
   */
  candidatesByGroup?: Record<string, number>;
  /** When true, drain candidates to 0 after first apply (idempotency). */
  drainOnApply?: boolean;
}

function makeFakeDb(opts: FakeOptions): { db: DatabasePort; state: FakeState } {
  const state: FakeState = {
    touchedProjectIds: [],
    createdPillars: [],
  };
  const recordTouch = (pid: string) => state.touchedProjectIds.push(pid);

  const existingPillars = new Map<string, string>(
    Object.entries(opts.existingPillars ?? {}),
  );
  const candidatesByGroupRead = new Map<string, number>(
    Object.entries(opts.candidatesByGroup ?? {}),
  );
  const candidatesByGroupApply = new Map<string, number>(
    Object.entries(opts.candidatesByGroup ?? {}),
  );

  const db: DatabasePort = {
    async resolveProjectIdBySlug(slug) {
      return opts.projectIdBySlug[slug] ?? null;
    },

    async resolvePillarIdByName(projectId, name) {
      recordTouch(projectId);
      return existingPillars.get(name) ?? null;
    },

    async createPillar(projectId, name, description) {
      recordTouch(projectId);
      const newId = `fake-pillar-id-${name}-${state.createdPillars.length}`;
      existingPillars.set(name, newId);
      state.createdPillars.push({ name, description });
      return newId;
    },

    async countReassignCandidates(projectId, _clusterNames, _targetPillarId) {
      recordTouch(projectId);
      // Find the group key via target-pillar-id-to-name reverse lookup.
      // Easier: just track per-group budget by target-pillar-id.
      const groupName = [...existingPillars.entries()].find(
        ([_, id]) => id === _targetPillarId,
      )?.[0];
      if (!groupName) return 0;
      return candidatesByGroupRead.get(groupName) ?? 0;
    },

    async reassignClusters(projectId, clusterNames, targetPillarId, _targetPillarName) {
      recordTouch(projectId);
      const groupName = [...existingPillars.entries()].find(
        ([_, id]) => id === targetPillarId,
      )?.[0];
      if (!groupName) return [];
      const budget = candidatesByGroupApply.get(groupName) ?? 0;
      const reassignedCount = Math.min(clusterNames.length, budget);
      if (opts.drainOnApply) {
        candidatesByGroupApply.set(groupName, 0);
        candidatesByGroupRead.set(groupName, 0);
      } else {
        candidatesByGroupApply.set(groupName, budget - reassignedCount);
      }
      return clusterNames.slice(0, reassignedCount).map((name, i) => ({
        id: `cluster-${name}-${i}`,
        name,
      }));
    },
  };

  return { db, state };
}

const TOOLWIKI_ID = "11111111-1111-1111-1111-111111111111";
const BELLEMANN_ID = "22222222-2222-2222-2222-222222222222";

describe("reassign-uncategorized-clusters (Spec 002 follow-up)", () => {
  // ── Test 1: dry-run no-op (Toolwiki real-shape — 2 groups, 8 + 12 clusters) ─
  it("dry-run reports counts, never mutates, never creates pillars", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      existingPillars: { comparisons: "pid-comp" }, // usecases pillar absent
      candidatesByGroup: { comparisons: 8, usecases: 12 },
    });

    const result = await reassignUncategorizedClusters({
      projectSlug: "toolwiki",
      apply: false,
      database: db,
    });

    expect(result.dryRun).toBe(true);
    expect(result.groups.length).toBe(2);

    const comp = result.groups.find((g) => g.targetPillarName === "comparisons");
    const usecases = result.groups.find((g) => g.targetPillarName === "usecases");
    expect(comp?.candidates).toBe(8);
    expect(comp?.affected).toBe(0);
    expect(comp?.pillarCreated).toBe(false);
    expect(usecases?.candidates).toBe(12);
    expect(usecases?.affected).toBe(0);
    expect(usecases?.pillarCreated).toBe(false);

    // No pillar creation in dry-run.
    expect(state.createdPillars).toHaveLength(0);
  });

  // ── Test 2: --apply creates absent target pillar + reassigns ──────────────
  it("--apply creates the usecases pillar (absent) and reassigns all clusters", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      existingPillars: { comparisons: "pid-comp" },
      candidatesByGroup: { comparisons: 8, usecases: 12 },
    });

    const result = await reassignUncategorizedClusters({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });

    expect(result.dryRun).toBe(false);
    const comp = result.groups.find((g) => g.targetPillarName === "comparisons");
    const usecases = result.groups.find((g) => g.targetPillarName === "usecases");

    expect(comp?.pillarCreated).toBe(false); // existed
    expect(comp?.affected).toBe(8);

    expect(usecases?.pillarCreated).toBe(true); // created on apply
    expect(usecases?.affected).toBe(12);

    expect(state.createdPillars).toHaveLength(1);
    expect(state.createdPillars[0]?.name).toBe("usecases");
  });

  // ── Test 3: --apply when target pillar already present skips creation ─────
  it("--apply skips creation when target pillar already exists", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      existingPillars: { comparisons: "pid-comp", usecases: "pid-usecases" },
      candidatesByGroup: { comparisons: 8, usecases: 12 },
    });

    const result = await reassignUncategorizedClusters({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });

    expect(state.createdPillars).toHaveLength(0);
    expect(result.groups.every((g) => !g.pillarCreated)).toBe(true);
    expect(result.groups.every((g) => g.affected > 0)).toBe(true);
  });

  // ── Test 4: idempotent re-apply (second call finds 0 candidates) ──────────
  it("second --apply finds 0 candidates (idempotent)", async () => {
    const { db } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      existingPillars: { comparisons: "pid-comp", usecases: "pid-usecases" },
      candidatesByGroup: { comparisons: 8, usecases: 12 },
      drainOnApply: true,
    });

    const first = await reassignUncategorizedClusters({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });
    expect(first.groups.find((g) => g.targetPillarName === "comparisons")?.affected).toBe(8);
    expect(first.groups.find((g) => g.targetPillarName === "usecases")?.affected).toBe(12);

    const second = await reassignUncategorizedClusters({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });
    expect(second.groups.every((g) => g.candidates === 0)).toBe(true);
    expect(second.groups.every((g) => g.affected === 0)).toBe(true);
  });

  // ── Test 5: missing project → throws ──────────────────────────────────────
  it("rejects when --project resolves to no row", async () => {
    const { db } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
    });

    await expect(
      reassignUncategorizedClusters({
        projectSlug: "does-not-exist",
        apply: true,
        database: db,
      }),
    ).rejects.toThrow(/Project not found: does-not-exist/);
  });

  // ── Test 6: cross-tenant guard ───────────────────────────────────────────
  it("scopes every DB call to the resolved project_id (cross-tenant guard)", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: {
        toolwiki: TOOLWIKI_ID,
        bellemann: BELLEMANN_ID,
      },
      existingPillars: { comparisons: "pid-comp", usecases: "pid-usecases" },
      candidatesByGroup: { comparisons: 1, usecases: 1 },
    });

    const result = await reassignUncategorizedClusters({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });

    expect(result.projectId).toBe(TOOLWIKI_ID);
    expect(state.touchedProjectIds.every((id) => id === TOOLWIKI_ID)).toBe(true);
    expect(state.touchedProjectIds.includes(BELLEMANN_ID)).toBe(false);
  });

  // ── Test 7: project without reassignment groups → no-op ──────────────────
  it("skips when project has no configured reassignment groups", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { bellemann: BELLEMANN_ID },
    });

    const result = await reassignUncategorizedClusters({
      projectSlug: "bellemann",
      apply: true,
      database: db,
    });

    expect(result.groups).toHaveLength(0);
    expect(state.createdPillars).toHaveLength(0);
  });
});
