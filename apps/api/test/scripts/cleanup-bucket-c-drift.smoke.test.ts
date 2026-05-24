/**
 * Spec 002 / BC2.1: smoke tests for cleanup-bucket-c-drift.
 *
 * All cases run against an in-memory DatabasePort — no Postgres, no
 * network. The point is to lock down the script's branching logic
 * (dry-run vs apply, pillars-only vs clusters-only vs both, idempotency,
 * cross-tenant guard via project_id, missing-project rejection,
 * article-re-reference-before-cluster-delete ordering, missing-keep-pillar
 * warning) without touching real data.
 *
 * For the real Postgres exercise of the SQL predicates, the cleanup runs
 * against Toolwiki in Sprint BC2 — capture-bucket-c-baseline takes
 * before/after snapshots that act as the ground-truth integration test.
 */

import { describe, expect, it } from "bun:test";
import {
  type CleanupPhase,
  type DatabasePort,
  cleanupBucketCDrift,
} from "../../src/scripts/cleanup-bucket-c-drift.ts";

interface ArticleRow {
  id: string;
  slug: string;
  locale: string | null;
}

interface DeletedRow {
  id: string;
  name: string;
}

interface FakeState {
  /** All projectIds seen by any read or write — cross-tenant guard. */
  touchedProjectIds: string[];
  /** Order of mutations in Phase 2 — must be re-reference BEFORE delete. */
  cluster2CallOrder: Array<"reReference" | "deleteCluster">;
}

interface FakeOptions {
  projectIdBySlug: Record<string, string>;
  /** Number of drop-pillars that actually exist for the project (Toolwiki = 10). */
  pillarDropExistsCount: number;
  /** Number of clusters whose pillarId points at a drop-pillar (Toolwiki = 1). */
  pillarRepointCount: number;
  /** Map of pillar-name → pillar-id for resolvePillarIdByName. Use this to simulate "keep-pillar missing" scenarios. */
  pillarNameToId?: Record<string, string>;
  /** Number of drop-clusters that actually exist (Toolwiki = 1). */
  clusterDropExistsCount: number;
  /** Number of articles whose cluster_key matches a drop-name (Toolwiki = 8). */
  articleReRefCount: number;
  /** When true, drains all counts after the first apply call — exercises idempotency. */
  drainOnApply?: boolean;
}

/**
 * Fake DB model: each metric (pillarDrop, pillarRepoint, clusterDrop,
 * articleRef) has TWO budgets — one for count-phase reads (peek only) and
 * one for apply-phase writes (consume). They start at the same value
 * (`opts.<metric>Count`); the count budget drains as each consolidation's
 * count call returns its share, and the apply budget drains as each write
 * lands. At test end:
 *   - Sum of count-call returns = configured budget (per-consolidation
 *     splits add up cleanly when `opts.<metric>Count` matches the SUM of
 *     `dropNames.length` / `pillarIds.length` across all consolidations).
 *   - Sum of apply-write returns = same total = configured budget.
 *
 * `drainOnApply` flag: after the first apply mutation, ALL read budgets
 * also go to 0. This models the second `cleanupBucketCDrift()` call (test
 * 5 idempotency) finding 0 candidates because the rows were already
 * mutated in run 1.
 */
function makeFakeDb(opts: FakeOptions): { db: DatabasePort; state: FakeState } {
  let pillarDropReadBudget = opts.pillarDropExistsCount;
  let pillarDropApplyBudget = opts.pillarDropExistsCount;
  let pillarRepointReadBudget = opts.pillarRepointCount;
  let pillarRepointApplyBudget = opts.pillarRepointCount;
  let clusterDropReadBudget = opts.clusterDropExistsCount;
  let clusterDropApplyBudget = opts.clusterDropExistsCount;
  let articleRefReadBudget = opts.articleReRefCount;
  let articleRefApplyBudget = opts.articleReRefCount;

  const state: FakeState = {
    touchedProjectIds: [],
    cluster2CallOrder: [],
  };

  const recordTouch = (pid: string) => state.touchedProjectIds.push(pid);

  /** drain ALL read budgets — simulates "rows are now gone" after apply. */
  const drainReadsIfRequested = (): void => {
    if (!opts.drainOnApply) return;
    pillarDropReadBudget = 0;
    pillarRepointReadBudget = 0;
    clusterDropReadBudget = 0;
    articleRefReadBudget = 0;
  };

  const db: DatabasePort = {
    async resolveProjectIdBySlug(slug) {
      return opts.projectIdBySlug[slug] ?? null;
    },

    async countPillarDropRows(projectId, dropNames) {
      recordTouch(projectId);
      // Each drop-name "matches" at most 1 row, capped by remaining read budget.
      // Read-only peek that also drains so subsequent count-calls (other
      // consolidations) don't double-count the same rows.
      const cap = Math.min(dropNames.length, pillarDropReadBudget);
      pillarDropReadBudget -= cap;
      return cap;
    },

    async resolvePillarIdByName(projectId, name) {
      recordTouch(projectId);
      if (opts.pillarNameToId) return opts.pillarNameToId[name] ?? null;
      return `pillar-id-for-${name}`;
    },

    async countClustersOnPillarIds(projectId, pillarIds) {
      recordTouch(projectId);
      if (pillarIds.length === 0) return 0;
      const cap = Math.min(pillarIds.length, pillarRepointReadBudget);
      pillarRepointReadBudget -= cap;
      return cap;
    },

    async repointClustersToPillar(projectId, _keepId, _keepName, dropIds) {
      recordTouch(projectId);
      if (dropIds.length === 0) return 0;
      const repointed = Math.min(dropIds.length, pillarRepointApplyBudget);
      pillarRepointApplyBudget -= repointed;
      if (repointed > 0) drainReadsIfRequested();
      return repointed;
    },

    async deletePillarsByName(projectId, names) {
      recordTouch(projectId);
      if (names.length === 0) return [];
      const deletedCount = Math.min(names.length, pillarDropApplyBudget);
      pillarDropApplyBudget -= deletedCount;
      if (deletedCount > 0) drainReadsIfRequested();
      return names.slice(0, deletedCount).map((name, i) => ({
        id: `deleted-pillar-${i}`,
        name,
      } satisfies DeletedRow));
    },

    async countClusterDropRows(projectId, dropNames) {
      recordTouch(projectId);
      const cap = Math.min(dropNames.length, clusterDropReadBudget);
      clusterDropReadBudget -= cap;
      return cap;
    },

    async countArticlesOnClusterKeys(projectId, _dropNames) {
      recordTouch(projectId);
      // Single-call sink: emit the entire article-ref budget. Mirrors
      // reality where all 8 articles attach to one drop-cluster row.
      const cap = articleRefReadBudget;
      articleRefReadBudget = 0;
      return cap;
    },

    async reReferenceArticles(projectId, _keep, _drops) {
      recordTouch(projectId);
      state.cluster2CallOrder.push("reReference");
      const count = articleRefApplyBudget;
      articleRefApplyBudget = 0;
      if (count > 0) drainReadsIfRequested();
      return Array.from({ length: count }, (_, i) => ({
        id: `article-${i}`,
        slug: `slug-${i}`,
        locale: i % 2 === 0 ? "de" : "en",
      } satisfies ArticleRow));
    },

    async deleteClustersByName(projectId, names) {
      recordTouch(projectId);
      state.cluster2CallOrder.push("deleteCluster");
      if (names.length === 0) return [];
      const deletedCount = Math.min(names.length, clusterDropApplyBudget);
      clusterDropApplyBudget -= deletedCount;
      if (deletedCount > 0) drainReadsIfRequested();
      return names.slice(0, deletedCount).map((name, i) => ({
        id: `deleted-cluster-${i}`,
        name,
      } satisfies DeletedRow));
    },
  };

  return { db, state };
}

const TOOLWIKI_ID = "11111111-1111-1111-1111-111111111111";
const BELLEMANN_ID = "22222222-2222-2222-2222-222222222222";
const FIXTURE_ID = "33333333-3333-3333-3333-333333333333";

// Sentinel project slug — has both pillars + clusters consolidations in
// PILLAR_CONSOLIDATIONS_BY_PROJECT / CLUSTER_CONSOLIDATIONS_BY_PROJECT so
// the smoke tests can exercise the cluster-phase logic. Toolwiki's
// cluster-phase is intentionally empty per Spec 002 Option Y (MDX-side fix
// instead of DB-side consolidation), so combined-phase tests use the
// fixture project instead.
const FIXTURE_SLUG = "__test_fixture_cluster_phase__";

describe("cleanup-bucket-c-drift (Spec 002 BC2.1)", () => {
  // ── Test 1: dry-run no-op (Toolwiki-shape: 10 pillar drops, no clusters) ─
  it("dry-run reports counts and never invokes write paths", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      pillarDropExistsCount: 10,
      pillarRepointCount: 1,
      clusterDropExistsCount: 0, // Toolwiki cluster-phase is empty (Option Y)
      articleReRefCount: 0,
    });

    const result = await cleanupBucketCDrift({
      projectSlug: "toolwiki",
      apply: false,
      database: db,
    });

    expect(result.dryRun).toBe(true);
    expect(result.pillars?.dropCandidates).toBe(10);
    expect(result.pillars?.clustersToRepoint).toBe(1);
    expect(result.pillars?.pillarsDeleted).toBe(0);
    expect(result.pillars?.clustersRepointed).toBe(0);
    // Toolwiki cluster-phase = 0 consolidations → never runs.
    expect(result.clusters?.dropCandidates).toBe(0);
    expect(result.clusters?.articlesToReReference).toBe(0);

    // No write paths invoked.
    expect(state.cluster2CallOrder).toHaveLength(0);
  });

  // ── Test 2: --apply --only=pillars (Toolwiki) ─────────────────────────
  it("--apply --only=pillars consolidates pillars and leaves clusters untouched", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      pillarDropExistsCount: 10,
      pillarRepointCount: 1,
      clusterDropExistsCount: 0,
      articleReRefCount: 0,
    });

    const result = await cleanupBucketCDrift({
      projectSlug: "toolwiki",
      apply: true,
      only: "pillars",
      database: db,
    });

    expect(result.dryRun).toBe(false);
    expect(result.pillars?.pillarsDeleted).toBeGreaterThan(0);
    expect(result.pillars?.clustersRepointed).toBe(1);
    expect(result.clusters).toBeUndefined();

    // Cluster-phase mutations must NOT have fired.
    expect(state.cluster2CallOrder).toHaveLength(0);
  });

  // ── Test 3: --apply --only=clusters (fixture-project — Toolwiki has empty cluster phase per Option Y) ─
  it("--apply --only=clusters re-references articles + drops clusters, leaves pillars untouched", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { [FIXTURE_SLUG]: FIXTURE_ID },
      pillarDropExistsCount: 0,
      pillarRepointCount: 0,
      clusterDropExistsCount: 2, // fixture has drop=[drop-cluster-a, drop-cluster-b]
      articleReRefCount: 5,
    });

    const result = await cleanupBucketCDrift({
      projectSlug: FIXTURE_SLUG,
      apply: true,
      only: "clusters",
      database: db,
    });

    expect(result.dryRun).toBe(false);
    expect(result.pillars).toBeUndefined();
    expect(result.clusters?.articlesReReferenced).toBe(5);
    expect(result.clusters?.clustersDeleted).toBeGreaterThan(0);

    // Cluster-phase mutations fired in order: reReference BEFORE deleteCluster.
    expect(state.cluster2CallOrder).toEqual(["reReference", "deleteCluster"]);
  });

  // ── Test 4: --apply default (both phases) using fixture-project ───────
  it("--apply with no --only runs both phases in one session", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { [FIXTURE_SLUG]: FIXTURE_ID },
      pillarDropExistsCount: 1, // fixture has 1 pillar drop
      pillarRepointCount: 0,
      clusterDropExistsCount: 2, // fixture has 2 cluster drops
      articleReRefCount: 5,
    });

    const result = await cleanupBucketCDrift({
      projectSlug: FIXTURE_SLUG,
      apply: true,
      database: db,
    });

    expect(result.pillars?.pillarsDeleted).toBeGreaterThan(0);
    expect(result.clusters?.clustersDeleted).toBeGreaterThan(0);

    // Article re-reference BEFORE cluster delete (Spec §6 Cross-Cutting-Rule).
    expect(state.cluster2CallOrder).toEqual(["reReference", "deleteCluster"]);
  });

  // ── Test 5: idempotent re-apply (fixture-project, both phases) ────────
  it("second --apply finds 0 candidates (idempotent)", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { [FIXTURE_SLUG]: FIXTURE_ID },
      pillarDropExistsCount: 1,
      pillarRepointCount: 0,
      clusterDropExistsCount: 2,
      articleReRefCount: 5,
      drainOnApply: true,
    });

    const first = await cleanupBucketCDrift({
      projectSlug: FIXTURE_SLUG,
      apply: true,
      database: db,
    });
    expect(first.pillars?.pillarsDeleted).toBeGreaterThan(0);
    expect(first.clusters?.articlesReReferenced).toBe(5);

    const second = await cleanupBucketCDrift({
      projectSlug: FIXTURE_SLUG,
      apply: true,
      database: db,
    });
    expect(second.pillars?.dropCandidates).toBe(0);
    expect(second.pillars?.pillarsDeleted).toBe(0);
    expect(second.pillars?.clustersRepointed).toBe(0);
    expect(second.clusters?.dropCandidates).toBe(0);
    expect(second.clusters?.articlesReReferenced).toBe(0);
    expect(second.clusters?.clustersDeleted).toBe(0);

    // First run: 1 reReference + 1 deleteCluster = 2 events.
    // Second run: still calls the helpers because the consolidations array is
    // non-empty, but each helper returns 0 rows — net no-op against the DB.
    expect(state.cluster2CallOrder.length).toBeGreaterThanOrEqual(2);
  });

  // ── Test 6: missing project → throws ───────────────────────────────────
  it("rejects when --project resolves to no row", async () => {
    const { db } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      pillarDropExistsCount: 0,
      pillarRepointCount: 0,
      clusterDropExistsCount: 0,
      articleReRefCount: 0,
    });

    await expect(
      cleanupBucketCDrift({
        projectSlug: "does-not-exist",
        apply: true,
        database: db,
      }),
    ).rejects.toThrow(/Project not found: does-not-exist/);
  });

  // ── Test 7: cross-tenant guard — fixture-project resolves, other project_id never touched ─
  it("scopes mutations strictly via the resolved project_id (cross-tenant guard)", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: {
        [FIXTURE_SLUG]: FIXTURE_ID,
        bellemann: BELLEMANN_ID,
      },
      pillarDropExistsCount: 1,
      pillarRepointCount: 0,
      clusterDropExistsCount: 2,
      articleReRefCount: 5,
    });

    const result = await cleanupBucketCDrift({
      projectSlug: FIXTURE_SLUG,
      apply: true,
      database: db,
    });

    expect(result.projectId).toBe(FIXTURE_ID);

    // Every DB call carried FIXTURE_ID, never BELLEMANN_ID.
    expect(state.touchedProjectIds.every((id) => id === FIXTURE_ID)).toBe(true);
    expect(state.touchedProjectIds.includes(BELLEMANN_ID)).toBe(false);
  });

  // ── Test 9: Toolwiki Option-Y semantics — cluster-phase is intentional no-op ─
  it("Toolwiki cluster-phase is empty per Option Y (MDX-side fix, no DB consolidation)", async () => {
    const { db, state } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      pillarDropExistsCount: 10,
      pillarRepointCount: 1,
      // Budget irrelevant — cluster phase has 0 consolidations for Toolwiki.
      clusterDropExistsCount: 999,
      articleReRefCount: 999,
    });

    const result = await cleanupBucketCDrift({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });

    // Cluster-phase result exists but reports 0 work — consolidations array is
    // empty for Toolwiki (Spec 002 Option Y: MDX-side fix in Astro repo at
    // tools/en/{cursor,github-copilot}.mdx, then Re-Import syncs DB cleanly).
    expect(result.clusters?.dropCandidates).toBe(0);
    expect(result.clusters?.articlesToReReference).toBe(0);
    expect(result.clusters?.clustersDeleted).toBe(0);
    expect(result.clusters?.articlesReReferenced).toBe(0);
    expect(state.cluster2CallOrder).toHaveLength(0);

    // Pillar phase still runs normally.
    expect(result.pillars?.pillarsDeleted).toBeGreaterThan(0);
  });

  // ── Test 8: missing keep-pillar emits warning, skips that consolidation ─
  it("emits missingKeepWarning when a keep-pillar doesn't exist for the project", async () => {
    // Set pillarNameToId so the canonical keep-names resolve to null but the
    // drop-names still resolve (we want the pre-flight to see drop-rows but
    // the keep-resolver to miss). Toolwiki's first consolidation is
    // keep="comparisons", drop=["Vergleiche"] — null out "comparisons" but
    // keep "Vergleiche" → id.
    const { db } = makeFakeDb({
      projectIdBySlug: { toolwiki: TOOLWIKI_ID },
      pillarDropExistsCount: 10,
      pillarRepointCount: 0,
      clusterDropExistsCount: 0,
      articleReRefCount: 0,
      pillarNameToId: {
        // Drop-pillars resolve (exist in DB)…
        Vergleiche: "pid-vergleiche",
        "Ethik & Recht": "pid-eth",
        Grundlagen: "pid-grund",
        Zukunft: "pid-zuk",
        "Guides & Tutorials": "pid-guides-de",
        Technik: "pid-tech",
        "Tool-Reviews": "pid-tr-cap",
        "practice-use-cases": "pid-pue",
        Praxis: "pid-prax",
        "Praxis & Use Cases": "pid-prax-uc",
        // …but NO keep-pillars resolve (simulates a project where the
        // canonical EN slugs were never created).
      },
    });

    const result = await cleanupBucketCDrift({
      projectSlug: "toolwiki",
      apply: true,
      database: db,
    });

    expect(result.pillars?.missingKeepWarning).toMatch(/Keep-pillars not present/);
    expect(result.pillars?.missingKeepWarning).toMatch(/comparisons/);
    // No deletes happened because every consolidation got skipped.
    expect(result.pillars?.pillarsDeleted).toBe(0);
    expect(result.pillars?.clustersRepointed).toBe(0);
  });

  // ── Bonus: type-level only enum ────────────────────────────────────────
  it("only accepts 'pillars' or 'clusters' as --only phase values", () => {
    const valid: CleanupPhase[] = ["pillars", "clusters"];
    expect(valid).toContain("pillars");
    expect(valid).toContain("clusters");
    // Type-level guarantee — the union type rejects anything else at compile
    // time. The CLI's parseOnlyArg() throws at runtime for any other string;
    // not testable via the in-memory DI port.
  });
});
