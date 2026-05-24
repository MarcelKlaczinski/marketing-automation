# Spec 004 Mini-Cleanup-Followups — Implementation Log

_Spec: [`specs/004-mini-cleanup.md`](../../../specs/004-mini-cleanup.md)_
_Branch: `feature/mini-cleanup-followups`_
_Implemented: 2026-05-24_

## TL;DR

Three independent footguns from the Cleanup-Cycle backlog closed in one session.
F2 turned out to be a misdiagnosis and closed as doc-only (Decision D in spec §3.2);
F1 + F3 shipped real code fixes plus their smoke tests.

| Sprint | Outcome | Tests added |
| ------ | ------- | ----------- |
| F1 — `forecast-re-import-state` noLocaleSplit | Code fix + pure-helper extraction | 4 |
| F2 — `pipeline_runs` 11-rows-per-trigger | Doc-only (Decision D — by-design) | 0 |
| F3 — `schema_json_ld` source filter | Code fix at trigger + HTTP route layers | 4 |

**Total**: 8 new smoke tests + 2 doc updates + 1 discovery doc. Workspace
typecheck clean across `@marketing-auto/pipelines`, `@marketing-auto/api`,
`@marketing-auto/db`.

## Changes by Sprint

### F1 — Forecast `noLocaleSplit`-Bug

**Files touched:**

- [`apps/api/src/scripts/discovery/forecast-re-import-state.ts`](../../../apps/api/src/scripts/discovery/forecast-re-import-state.ts)
  - Extracted pure `computeForecastDiff(repoInventory, dbInventory)` from
    the script body so smoke tests can exercise the matching rules without
    a real DB.
  - Built a second lookup key `<coll>|_any_locale` alongside the existing
    `<coll>|<locale>` key. `noLocaleSplit` collections (`categories`) now
    match against the any-locale bucket → DB rows written by the importer
    with `locale='de'` are recognized as known, not flagged as new inserts.
  - Tightened the truthy check on `repoColl.byLocale` to also require
    `Object.keys(...).length > 0`. `repo-inventory.json` serialises
    noLocaleSplit entries with `"byLocale": {}` alongside the populated
    `noLocaleSplit` block; the old truthy check sent the entry into the
    per-locale branch with zero `Object.entries` iterations and dropped the
    collection from the report entirely.
  - Exported `RepoCollectionInventory`, `DbInventoryRow`, `PerLocaleDiff`,
    `ForecastReport` so tests can construct typed fixtures.

- [`apps/api/test/scripts/forecast-re-import-state.smoke.test.ts`](../../../apps/api/test/scripts/forecast-re-import-state.smoke.test.ts) — new
  - 4 tests / 34 expect() calls, all in-memory:
    1. noLocaleSplit collection matches DB rows with `locale='de'`
    2. byLocale collection still diff's per locale (regression guard)
    3a. `byLocale: {} + noLocaleSplit` shape from `repo-inventory.json`
        falls through correctly into the noLocaleSplit branch
    3. mixed byLocale + noLocaleSplit in one forecast

### F2 — Pipeline-Observability bei `astro:repo-import`

**Outcome:** Decision **D** (Status-Quo + Doku) — no code change.

**Files touched:**

- [`docs/discovery/f2-pipeline-observability-codeRead.md`](../../discovery/f2-pipeline-observability-codeRead.md) — new
  - Full code-read explaining that the 11 rows per Re-Import trigger are
    NOT BullMQ-dedup duplicates or no-op runs.
  - Pattern verified via DB: `pipeline_runs = 1 parent + N step children`
    for every registered pipeline (`astro:repo-import` 10 steps → 11 rows;
    `article:blog` 13 steps → 14 rows confirmed in live data).
  - Substep child rows back step-pause FK, rerun supersession
    (`supersedeOldSubstep`), SSE events (`step.paused`, `step.resolved`),
    and idempotency-cache attribution — all by-design.
  - Spec's "10 No-Op Runs (0-16s)" claim was misdiagnosis on a fast
    incremental import; full imports (post-C2 cleanup) show
    mirror-hero 30s, upsert 26s, parse-frontmatter 10s.
  - Decision-matrix walks through Options A/B/C/D and concludes D.

### F3 — Schema-Extension `source`-Filter

**Files touched:**

- [`packages/pipelines/src/schema-extension/trigger.ts`](../../../packages/pipelines/src/schema-extension/trigger.ts)
  - Widened return type from `{ jobId: string }` to
    `EnqueueSchemaExtensionResult = { jobId: string } | { skipped: 'imported-article' }`
    (discriminated union; new exported type).
  - Added `if (article.source === 'imported') return { skipped: ... }`
    gate. Wrong-status path still `throw`s (spec §7 FU-3 Single-Point-of-
    Decision, Option A from the start-task clarification — preserves
    afterComplete behaviour where the throw bubbles into the existing
    `try/catch + log.warn` swallow).

- [`apps/api/src/routes/articles.ts`](../../../apps/api/src/routes/articles.ts) `POST /:id/extend-schema`
  - Added pre-trigger gate: selects `articles.source` alongside
    `id, projectId`, returns `422 { ok: false, error, skipped: 'imported-article' }`
    for imported rows. Necessary because the HTTP route enqueues via
    `enqueueSchemaExtensionPipeline` (a parallel preRunId wrapper in
    `packages/pipelines/src/article/trigger.ts`), NOT via
    `enqueueSchemaExtension` — the trigger-layer gate alone would NOT
    close this attack vector. See Discovered §1 below.

- [`apps/api/src/scripts/article/extend-schema.ts`](../../../apps/api/src/scripts/article/extend-schema.ts)
  - Added `if ("skipped" in result)` branch + skip-explanation log.
    Otherwise the CLI's `result.jobId` access would TS-error on the new
    discriminated union.

- [`packages/db/src/schema/content.ts`](../../../packages/db/src/schema/content.ts)
  - Replaced the "Defense delegated to documentation" block in the
    `schemaJsonLd` doc-comment with the two-layer Spec 004 / F3 defense
    description. Documented that `/sync` stays source-agnostic
    intentionally (future retrofit use-case + Branch-B-clean MDX as
    long as no Astro collection declares `schema:` field).

- [`packages/pipelines/test/schema-extension/trigger.test.ts`](../../../packages/pipelines/test/schema-extension/trigger.test.ts) — new
  - 4 tests / 11 expect() calls against a real DB-fixture project:
    1. Generated + final_review → enqueued + status flips to schema_extending
    2. Generated + proposed → throws (regression guard)
    3. Imported + final_review → skipped, status stays at final_review
    4. Imported + schema_extending → skipped (defensive: shouldn't occur in
       prod since imported rows never reach that status, but the gate must
       short-circuit even if it does)

### F4 — Backlog + Doku

**Files touched:**

- [`docs/backlog/post-cleanup-followups.md`](../../backlog/post-cleanup-followups.md)
  - Added new "Spec 004 Mini-Cleanup-Followups — ✅ COMPLETED 2026-05-24"
    block at the top of Priorität 1 with per-sprint summary lines + cross-
    references to this doc.

- This file.

## Verification

```bash
# F1 smoke tests
bun test apps/api/test/scripts/forecast-re-import-state.smoke.test.ts
# → 4 pass / 0 fail / 34 expect() calls

# F3 smoke tests
bun test packages/pipelines/test/schema-extension/trigger.test.ts
# → 4 pass / 0 fail / 11 expect() calls

# Workspace typechecks
bun --filter @marketing-auto/pipelines typecheck  # → exit 0
bun --filter @marketing-auto/api typecheck         # → exit 0
bun --filter @marketing-auto/db typecheck          # → exit 0

# F1 manual-verify against Toolwiki (post-fix)
bun --filter @marketing-auto/api forecast-re-import-state toolwiki
# → "### categories/(no-locale)" block now present in output
#   (pre-fix the entire categories collection was silently missing
#    from the report due to the `byLocale: {}` truthy short-circuit)
```

## Discovered & Deviations

### 1. F3 — Spec's chosen fix-location only covered ½ the attack surface

Spec §3.3 F3.1 proposed adding the source filter to `enqueueSchemaExtension`
on the rationale of "Single-Point-of-Decision, alle HTTP-Routes profitieren"
(spec §7 FU-3). Discovery during implementation: the HTTP route
`POST /api/articles/:id/extend-schema` does NOT delegate through
`enqueueSchemaExtension` — it uses `enqueueSchemaExtensionPipeline`, a
parallel preRunId wrapper in `packages/pipelines/src/article/trigger.ts`
that exists independently. Adding the gate ONLY to `enqueueSchemaExtension`
would close the internal `afterComplete` callers (Blog / Refresh /
Translation pipelines) but NOT the actual HTTP exploit path the spec §1 F3
describes.

**Deviation:** Defense-in-depth at both layers. The trigger-layer gate
covers afterComplete + the admin CLI; the HTTP-route gate (returns 422 with
skip reason) covers the actual reachable attack vector. The doc-comment on
`schemaJsonLd` reflects both defenses. The spec's text rationale stands —
the trigger gate IS a Single-Point-of-Decision for the paths that flow
through it — it just doesn't reach the HTTP route.

### 2. F1 — Discovered second latent bug while applying the locale fix

The spec described the bug as a locale-column matching problem only. While
implementing, I found the bug had a sibling: `repo-inventory.json` serialises
noLocaleSplit entries with `"byLocale": {}` (empty object) ALONGSIDE the
populated `noLocaleSplit` block. The pre-fix code's truthy check
`if (repoColl.byLocale)` short-circuited the entry into the per-locale
branch where `Object.entries({})` iterates zero times → the entire `categories`
collection silently dropped out of the report.

**Fix:** Tightened the check to also require
`Object.keys(repoColl.byLocale).length > 0`. Added a 4th smoke test
(test 3a) locking down the real `repo-inventory.json` shape. Same root
cause as the spec-described bug (noLocaleSplit handling), one-line fix.

### 3. F1 — Discovered slug-format mismatch (out-of-scope, flagged for follow-up)

After my F1 fix the manual-verify against Toolwiki still showed `categories`
with 31 inserts + 30 dbOnly (instead of all 30 matching as updates). Root
cause is a **separate** bug: `repo-inventory.json` lists categories slugs
as `blog/comparisons`, `blog/ethics-law`, `knowledge/fundamentals` etc.
(with path prefix) while the importer writes DB rows with bare slugs
(`comparisons`, `ethics-law`, `fundamentals`).

Either the inventory generator should strip the prefix, OR the importer
should preserve it — needs Marcel-decision on which side is canonical.
Per spec §8 R4 strict 4-5h time-box, did not extend F1 scope. The F1
locale fix is correct on its own merits: when the slug-format mismatch is
resolved (in either direction), the locale fix ensures correct matching
without further work.

**Recommended follow-up:** add to `docs/backlog/post-cleanup-followups.md`
Priorität 3 as "F1.5 — categories slug-format reconciliation". Diagnosis
SQL to confirm direction:
`SELECT slug FROM articles WHERE collection = 'categories' AND project_id = '<toolwiki>' LIMIT 5;`

### 4. F2 — Spec's premise was a misdiagnosis

Spec §1 F2 claimed: "Pro Re-Import-Trigger werden 11 pipeline_runs geloggt.
Nur 1 davon (93s) hat substantiell gearbeitet, 10 sind No-Op-Runs (0-16s)".
Code-read found this is incorrect:

- The 11 rows are 1 parent + 10 child substeps (verified at
  [runner.ts:438-449](../../../packages/pipelines/src/engine/runner.ts:438)).
- The "0-16s durations" were measured against an incremental import where
  most steps had little work; full imports show substantial step durations.
- The "BullMQ-Dedup loggt deduplicated Jobs trotzdem als pipeline_runs"
  hypothesis is wrong — deterministic jobId `repo-import-${run.id}` is
  already in place at [trigger.ts:41](../../../packages/adapters/astro-sync/src/import/trigger.ts:41).

**Deviation:** F2 closed as Decision D (Status-Quo + Doku) per spec §3.2
F2.2. F2.3 (Implementation) + F2.4 (Smoke-Tests) + F2.5 (Manual-Verify
"1 statt 11") are not applicable. See
[`docs/discovery/f2-pipeline-observability-codeRead.md`](../../discovery/f2-pipeline-observability-codeRead.md)
for the full code-read.

### 5. F3 — Test article status enum lookup

Spec §3.3 F3.3 used `draft` as the wrong-status test fixture value, but the
DB enum `article_status` has no `draft` value (canonical wrong-status proxy
is `proposed`, the initial state). Pre-existing convention — same enum is
used across all article pipelines. Used `proposed` in the smoke test
instead. Functionally identical.

## Vor / Nach Metrics

### F1

| Measurement | Vorher | Nachher |
| ----------- | ------ | ------- |
| Forecast report includes `categories` section | ❌ (silently dropped due to `byLocale: {}` short-circuit) | ✅ |
| Categories slugs matched against DB by `locale='de'` | ❌ (only `locale IS NULL` was matched) | ✅ |
| Forecast accuracy for `categories` (Toolwiki, 31 repo files) | Approximate / hidden | Bounded by separate slug-format bug (Discovered §3) |
| Smoke-test coverage | 0 | 4 |

### F2

| Measurement | Vorher | Nachher |
| ----------- | ------ | ------- |
| Rows per `astro:repo-import` trigger | 11 (10-step pipeline) | 11 (unchanged — by-design) |
| Pattern documented | ❌ | ✅ (Discovery doc) |
| Spec-author's misdiagnosis recorded | ❌ | ✅ (Discovered §4) |

### F3

| Measurement | Vorher | Nachher |
| ----------- | ------ | ------- |
| `POST /extend-schema` on imported article | enqueues, writes `schema_json_ld` | 422 + `skipped: 'imported-article'` |
| `enqueueSchemaExtension` on imported article | enqueues, flips status to `schema_extending` | `{ skipped: 'imported-article' }`, status unchanged |
| `schemaJsonLd` doc-comment accuracy | Documents "deferred Trigger-Filter" | Documents two-layer active defense |
| Smoke-test coverage | 0 (trigger had no direct tests) | 4 |
