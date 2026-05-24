# Spec 005 (Importer-Robustness) — IMPLEMENTED

_Date: 2026-05-24_
_Branch: `feature/importer-robustness`_
_Spec: [specs/005-import-robustness.md](../../../specs/005-import-robustness.md)_

## Summary

Two pattern-conflicts in `RepoImportPipeline` closed:

- **IR1** — `UpsertArticlesStep` no longer matches against `status='superseded'` rows during slug-conflict resolution. Migration 0103 swaps the hard unique index for a partial one `WHERE status != 'superseded'`. The fix is structural (DB-level), not application-layer.
- **IR2** — New `MirrorBackfillHeroesStep` runs after `UpsertArticlesStep`. Self-heals heroless `source='imported'` rows on every Re-Import, regardless of MDX gitSha state.

Plus one tech-debt cleanup: extracted `heroRefreshWhitelistUpdateSet()` into a shared helper so `UpsertArticlesStep` + the new backfill step both use identical hash-equality preservation SQL.

## Files Touched

### Migrations
- `packages/db/drizzle/0103_articles_slug_unique_active_only.sql` — DROP hard unique + CREATE partial unique
- `packages/db/drizzle/meta/_journal.json` — register migration

### DB schema
- `packages/db/src/schema/content.ts` — rename + widen index to partial `.where(sql\`status != 'superseded'\`)`

### Adapter steps
- `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts` — add `targetWhere` on `onConflictDoUpdate`; use shared `heroRefreshWhitelistUpdateSet()` helper
- `packages/adapters/astro-sync/src/import/steps/filter-changed-files.ts` — exclude superseded rows from `existingByPath` index
- `packages/adapters/astro-sync/src/import/steps/mirror-backfill-heroes.ts` — **NEW** — post-Upsert backfill step + shared `heroRefreshWhitelistUpdateSet()` helper
- `packages/adapters/astro-sync/src/import/pipeline.ts` — register new step + bridges
- `packages/adapters/astro-sync/src/import/index.ts` — re-export new step + helper + types

### Tests
- `packages/adapters/astro-sync/test/upsert-articles-supersede.test.ts` — **NEW** — 4 IR1 smokes
- `packages/adapters/astro-sync/test/upsert-articles-regression-anomaly-a.test.ts` — **NEW** — 1 IR1.5 regression
- `packages/adapters/astro-sync/test/mirror-after-upsert.test.ts` — **NEW** — 4 IR2 smokes
- `packages/adapters/astro-sync/test/mirror-after-upsert-regression-anomaly-b.test.ts` — **NEW** — 1 IR2.5 regression

### Docs
- `docs/discovery/ir1-upsert-articles-code-read.md` — **NEW** — IR1 Code-Read incl. defense-in-depth
- `docs/discovery/ir2-mirror-step-ordering-code-read.md` — **NEW** — IR2 Code-Read incl. defense-in-depth
- `docs/backlog/post-cleanup-followups.md` — both backlog entries marked ✅ CLOSED with cross-refs
- `packages/adapters/astro-sync/CLAUDE.md` — two new pattern sections (to be added in /update-docs)

## Test Counts

- IR1: **4 smokes + 1 regression = 5 tests** (all green post-fix)
- IR2: **4 smokes + 1 regression = 5 tests** (all green post-fix)
- Workspace: 105 pass / 0 fail across the `@marketing-auto/adapter-astro-sync` package; 0 typecheck errors on db / astro-sync / api.

## Pipeline Diagram

### Before

```
ExtractCollectionSchemas
  → ListContentFiles
  → FilterChangedFiles       ← reads DB by filePath, no status filter (silently included superseded rows)
  → ParseFrontmatterBatch
  → MirrorHeroImages         ← in-memory: stamps hero per parsed entry
  → UpsertArticles           ← INSERT/UPDATE with hero cols inline; hard unique on (project,source,coll,locale,slug) silently matched superseded rows
  → LinkTranslationPairs
  → SyncClustersFromFrontmatter
  → DetectContentGaps
  → UpdateImportRun
```

### After

```
ExtractCollectionSchemas
  → ListContentFiles
  → FilterChangedFiles       ← reads DB by filePath, EXCLUDES superseded rows
  → ParseFrontmatterBatch
  → MirrorHeroImages         ← unchanged
  → UpsertArticles           ← targetWhere mirrors the partial unique predicate; superseded rows are tombstones
  → MirrorBackfillHeroes     ← NEW: self-heals heroless rows in same run
  → LinkTranslationPairs
  → SyncClustersFromFrontmatter
  → DetectContentGaps
  → UpdateImportRun
```

## Discovered & Deviations

### From spec assumptions

1. **Spec IR1's "cornerstoneKeyword/filePath-Heuristik" narrative was wrong.** Matching is purely on the unique constraint `(project, source, collection, locale, slug)` via Postgres native `onConflictDoUpdate`. No application-layer heuristic exists. The bug class is real (Anomaly-A reproduced) but the root cause is the hard unique index, not a heuristic match.

2. **Spec IR1's Option A (manual select-then-insert/update with `status != 'superseded'` filter) is structurally broken.** The hard unique constraint still trips on INSERT — Option A as written needs either a try/catch on UNIQUE violations or a synthetic slug suffix. Option D (partial unique index) was selected instead because it fixes the structural invariant at the DB level rather than working around it at the application layer.

3. **Spec IR2's "MirrorHeroImagesStep iteriert über DB-Rows VOR dem Upsert" narrative was wrong.** Mirror always operated on in-memory parsed entries via the `parse → mirror → upsert` bridge chain — it sees new entries fine. The actual Anomaly-B was caused by a default-hero-path bug (`/heroes/default.webp` vs `/heroes/auto/default.webp`), already fixed on 2026-05-24 15:57Z.

4. **The real Anomaly-B durability gap was different from the spec's framing.** Any Mirror failure (404, R2 outage, GitHub transient) on a new INSERT leaves a heroless row, and `FilterChangedFilesStep`'s gitSha-equality skip blocks self-healing on subsequent Re-Imports. The fix is to add a post-Upsert self-healing step (Option B), not to reorder Mirror.

5. **Spec IR2's Option A (step-reorder + Mirror reads DB) is a bigger refactor than acknowledged.** Would have broken 3+ existing test files and split atomic Parse→Mirror→Upsert into Parse→Upsert→Mirror with separate UPDATE atomicity. Option B (additive backfill step) keeps the existing flow intact and only adds the self-healing pass.

6. **No `unique-constraint widening` needed beyond the partial-WHERE variant.** Spec §IR1.3 anticipated possible migration; this came true (0103) but in the simpler form (just add a WHERE clause) instead of widening the key tuple.

### Implementation tradeoffs

7. **`heroRefreshWhitelistUpdateSet()` helper extracted** so both Upsert (inline) and Backfill (standalone) share identical preservation SQL. 30min cost, eliminates a drift target.

8. **`backfill-imported-heroes` CLI kept post-fix** (Marcel's decision). Same posture as Spec 64.10's `cleanup-orphan-heroes` — useful for ad-hoc dry-run audits without triggering a full Re-Import.

9. **DI seam for tests via `BackfillStepDeps.mirrorOneArticleFn`** plus a `stubMode` flag that gates production dep construction. When a test stubs the mirror function, the step skips `getInstallationOctokit` / WebP-adapter wiring entirely (because the stub ignores `deps`). Avoids needing live GitHub-App credentials in offline tests.

10. **`mirrorOneArticle` second-arg shape (`args.entry.typed.slug`) is the test contract**, not `args` as a single object. Caught in the first test run — fixed by changing stub signatures to `async (_mirrorDeps, args) => ...`. Reflects the actual `mirrorOneArticle(deps, input)` signature.

11. **Pre-migration safety check** verified zero existing duplicates that would violate the new partial constraint. Ran `SELECT … WHERE status != 'superseded' GROUP BY (project, source, coll, locale, slug) HAVING COUNT(*) > 1` against Toolwiki prod → 0 rows. Documented inline in the migration SQL.

12. **`v3 Lesson 3 (IR3 Scope-Collision out-of-scope)` respected.** F1.5 noLocaleSplit slug-collision pattern was not touched — backlog entry stays in `docs/backlog/post-cleanup-followups.md` with future-trigger-conditions documented in [`packages/adapters/astro-sync/CLAUDE.md`](../../../packages/adapters/astro-sync/CLAUDE.md) "Bare-Slug Collision in noLocaleSplit Collections".

## Live Verification (deferred)

The fix doesn't require live Toolwiki verification — the regression tests reproduce both Anomaly-A and Anomaly-B exactly. However, the next real Re-Import will exercise both:

- If any future slug-rename hits a superseded row: confirmed the new active row INSERTs cleanly via `targetWhere`.
- If any future Mirror failure leaves a heroless INSERT: confirmed the backfill step heals it in the same run.

Worker restart required after deploy (touches `packages/adapters/astro-sync/src/`).

## Patterns Surfaced

- **Partial unique index for "active-only" invariants.** When `(scope, key)` should be unique among non-tombstoned rows, use `UNIQUE WHERE status != 'tombstone'` plus `targetWhere` on `onConflictDoUpdate`. Same as `topic_briefs_unique_open_per_gap` (Spec 0032 / 0084). Tombstones can coexist with fresh rows at the same key.
- **Additive self-healing step vs upstream refactor.** When a step has a graceful-skip failure mode that leaves derivative state incomplete, add a downstream backfill step that reads the derivative DB state and retries — rather than refactoring the upstream step to retry inline. Preserves atomicity of the upstream operation and lets the backfill share the same per-item helper as ad-hoc CLI tooling.
- **Shared SQL fragment for hash-equality refresh whitelist.** Multiple write sites that touch the same set of columns should share a helper that returns the CASE-WHEN preservation fragment. Prevents drift on preservation semantics (e.g. "preserve UI-edited alt-text on unchanged content").
- **DI seam with `stubMode` flag.** When a step's production wiring has heavy side-effects (Octokit client, R2 client) that tests don't need, gate the wiring behind a flag set during construction. Cleaner than nullable-everywhere or two-mode classes.
