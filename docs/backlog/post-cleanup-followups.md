# Post-Cleanup Folge-Specs

Created by Spec 001 (DB-Cleanup Post-Refactor) §5.3 on 2026-05-24.

Items deliberately scoped out of Spec 001 to keep the cleanup tight. None are
blocking; each is a discrete follow-up that can be picked up independently.

## Priorität 1

### Spec 004 Mini-Cleanup-Followups — ✅ COMPLETED 2026-05-24

Resolved by [`specs/004-mini-cleanup.md`](../../specs/004-mini-cleanup.md) +
[`docs/specs/mini-cleanup-followups/IMPLEMENTED.md`](../specs/mini-cleanup-followups/IMPLEMENTED.md):

- **F1 — `forecast-re-import-state.ts` `noLocaleSplit`-Bug.** ✅ COMPLETED.
  Locale-column matching fixed for noLocaleSplit collections (`categories`),
  plus a second latent bug (empty `byLocale: {}` truthy-check short-circuiting
  into the per-locale branch with zero iterations) discovered and fixed in
  the same change. 4 smoke tests grün. Pure helper `computeForecastDiff`
  extracted from the script for testability. **F1.5 follow-up resolved
  separately — see below.**

- **F1.5 — `categories` Slug-Format Reconciliation.** ✅ COMPLETED 2026-05-24
  via [`specs/006-follow-up-robustness.md`](../../specs/006-follow-up-robustness.md)
  + [`docs/specs/f15-categories-slug-format/IMPLEMENTED.md`](../specs/f15-categories-slug-format/IMPLEMENTED.md).
  Three-way analysis (Astro frontmatter / Importer / Inventory generator)
  confirmed Option A: DB canonical (bare slugs). Re-created the missing
  `generate-repo-inventory.ts` script — deleted in commit `32b0c54` as
  "obsolete" but still the only producer of the committed `repo-inventory.json`
  — with bare-slug derivation (`basename(filePath, '.md')`) plus optional
  per-slug `scopes` map for future disambiguation surfaces. Forecast against
  Toolwiki now reports `categories: 0 inserts / 30 updates / 0 dbOnly` (was
  `31 inserts / 30 dbOnly`). 5 smoke tests grün. **Discovered & not fixed:**
  Toolwiki's `categories` collection has a real bare-slug collision
  (`blog/ethics-law` + `knowledge/ethics-law` → single DB row, silent UPSERT
  overwrite). Practical impact zero today (identical labels), tracked
  separately in §Slug-Rename-Detection / Importer-Robustness below.

- **F2 — Pipeline-Observability bei `astro:repo-import`.** ✅ CLOSED as
  Decision **D** (Status-Quo + Doku). Code-read showed the 11 rows per
  trigger are NOT BullMQ-dedup artefacts; they're the runner's standard
  per-step substep audit pattern (1 parent + N children for any
  N-step pipeline — verified `article:blog` produces 14 rows for its 13
  steps). Substeps back step-pause FK, rerun supersession, SSE events,
  and idempotency-cache attribution — all by-design. See
  [`docs/discovery/f2-pipeline-observability-codeRead.md`](../discovery/f2-pipeline-observability-codeRead.md)
  for full code-read + decision matrix.

- **F3 — `schema_json_ld` Soft-Guard.** ✅ COMPLETED with defense-in-depth
  at both layers (spec asked for trigger-only, but the HTTP route uses a
  parallel wrapper `enqueueSchemaExtensionPipeline` that the trigger-layer
  gate wouldn't reach). (1) `enqueueSchemaExtension` widens return type to
  `{ jobId } | { skipped: 'imported-article' }`; (2) `POST /api/articles/:id/extend-schema`
  returns 422 with skip reason for imported rows. 4 smoke tests grün.
  `schemaJsonLd` doc-comment in `packages/db/src/schema/content.ts` updated
  to reflect the new active defense. `POST /api/articles/:id/sync` stays
  source-agnostic intentionally (future retrofit use-case + Branch-B-clean
  MDX as long as no collection declares `schema:` field).

### Bucket-D Bug-Fixes (from `docs/discovery/post-refactor-state-audit.md` §6.1)

Resolved by Spec Bucket-D (`docs/specs/bucket-d-fixes/spec.md`) on 2026-05-24:

- **D1 — `articles.astro_frontmatter` column status.** Investigated, classified
  as **by-design dormant** (forensic copy written by
  `ArticleSyncPipeline.UpdateDbStatusStep` for generation-sync paths;
  intentionally NULL for `source='imported'` rows; 0/318 populated in Toolwiki
  because Toolwiki is import-only). Kept the column, added doc-comment in
  [`packages/db/src/schema/content.ts`](../../packages/db/src/schema/content.ts)
  + CLAUDE.md section in
  [`packages/adapters/astro-sync/CLAUDE.md`](../../packages/adapters/astro-sync/CLAUDE.md).
  Discovery script:
  [`audit-astro-frontmatter-usage.ts`](../../apps/api/src/scripts/discovery/audit-astro-frontmatter-usage.ts).
  Re-evaluate only if a generated-workflow tenant ships and the column is still
  unused in production (today: writer exists, no production reader).

- **D2 — `articles.schema_json_ld` footgun on imported articles.** Investigated.
  Trigger paths reachable, but the footgun is **dormant** because no Toolwiki
  Astro collection currently declares `schema:` or `schemaJsonLd:` as a
  frontmatter field, so `RenderMdxStep`'s field-filter silently drops the
  payload from emitted MDX. Documented as a soft-guard in
  [`packages/db/src/schema/content.ts`](../../packages/db/src/schema/content.ts)
  + [`packages/adapters/astro-sync/CLAUDE.md`](../../packages/adapters/astro-sync/CLAUDE.md).
  Trigger-Filter (Option A from spec) deferred. Re-open if a future Astro
  schema adds `schema:` / `schemaJsonLd:` to a collection that contains
  imported articles, or if `RenderMdxStep` field-filter logic changes.

## D4 — content_pillars-Sync (obsoleted by Cluster-Toolification)

Status: **NOT FIXED, intentionally.**

D4 originally proposed extending `SyncClustersFromFrontmatterStep` to seed
`content_pillars` from frontmatter. Investigation in BD3 confirmed:
- The importer DOES seed `content_pillars` from `articles.category` (the
  audit hypothesis was wrong about "no writer").
- The 12 "missing ki-wissen pillars" the audit flagged are actually
  cluster_keys, not categories — they live in `clusters`, not pillars.
- The drift in `content_pillars` is Schwesterkonzept-Drift (DE/EN sister
  rows) + 3 wrong-table cluster slugs.

Decision 2026-05-24: do NOT fix because Cluster-Toolification (Toolwiki spec,
approved Option A) replaces the entire table at implementation.

Captured for the future refactor:
- [`docs/discovery/bd3-content-pillars-baseline.md`](../discovery/bd3-content-pillars-baseline.md)
  — code-read + drift inventory
- [`apps/api/src/scripts/discovery/audit-content-pillars-sources.ts`](../../apps/api/src/scripts/discovery/audit-content-pillars-sources.ts)
  — read-only audit script, re-runnable
- Schema doc-comment on
  [`contentPillars`](../../packages/db/src/schema/identity.ts) flagging
  scheduled-for-refactor status

Triggers for re-evaluating D4 in isolation (if Cluster-Toolification stays
deferred indefinitely):
- New feature critically depends on accurate `content_pillars` (Plan-Generation
  or UI). Today: rare.
- `content_pillars` drift becomes blocker for cold-start or import pipelines.
  Today: not observed.

In both cases: re-open D4 as small spec, but be aware that any extension will
need to be unwound when Cluster-Toolification triggers.

### Bucket-C Cleanup (pre-existing drift, NOT caused by Branch-A or Branch-B)

- **C1 — `content_pillars` Schwester-Drift.** ✅ **COMPLETED 2026-05-24** via
  [Spec 002 Bucket-C-Cleanup](../../specs/002-bucket-c-cleanup.md). Conservative
  cleanup (Option B): 10 pillar rows deleted via
  [cleanup-bucket-c-drift.ts](../../apps/api/src/scripts/cleanup-bucket-c-drift.ts)
  (7 EN/DE pairs + 4-fold Praxis-drift). 1 cluster re-pointed from
  `practice-use-cases` → `practice`. 3 ki-wissen pillars with
  `intentTaxonomyOverride` deliberately kept. Toolwiki 29 → 19 pillars.
  Forward convention: EN-canonical lowercase-slug-form
  (documented in [`packages/db/src/schema/identity.ts`](../../packages/db/src/schema/identity.ts)).
  Astro public site unaffected (Astro reads category labels from its own
  `categories/` collection with per-locale `translations.de.label`).

- **C2 — `clusters` doppel-language slugs.** ✅ **COMPLETED 2026-05-24** via
  Spec 002 Option Y (per-locale-canonical, intentional split). DB-side
  consolidation was rejected after discovery: `articles.cluster_key` is a
  mirror of the Astro MDX `clusterKey` frontmatter (NOT in refresh-whitelist),
  any DB-side UPDATE would be undone by the next Re-Import. Astro public
  frontend reads MDX directly for related-articles grouping. Fix landed in
  the Astro repo instead: 2 MDX files edited (`tools/en/cursor.mdx` +
  `tools/en/github-copilot.mdx` → `clusterKey: "code-assistants-2026"`). After
  Toolwiki Re-Import, the DB will naturally have 4 DE articles under
  `code-assistenten-2026` + 4 EN articles under `code-assistants-2026` —
  two clusters by design (per-locale grouping matches Astro related-articles
  widget semantics). The 2 orphan blog articles
  (`blog/de/code-assistenten`, `blog/en/ai-code-assistants`) drop out via
  Spec 001 `status='superseded'` flip.

- **C4 — `content_categories.parent_slug` hierarchy migration.** Still open.
  Today's schema is flat; multi-domain-evolution noted a need for parent-child
  relationships. Migration + Drizzle schema + a small backfill script.

#### Bucket-C Follow-up: Uncategorized cluster reassignment ✅ COMPLETED 2026-05-24

20 Toolwiki clusters reassigned from `Uncategorized` fallback onto semantic
pillars via [reassign-uncategorized-clusters.ts](../../apps/api/src/scripts/reassign-uncategorized-clusters.ts):

- 8 `*-comparisons-2026` + tool-aggregator clusters → existing `comparisons` pillar
- 12 `usecase-*` clusters → new `usecases` pillar (created for the flat
  `usecases` Astro collection that has no `usecase` category scope)

Toolwiki state: 20 → 21 pillars, `Uncategorized` now empty (true exception
bucket). Script pattern: DI ports + dry-run-default + `--project` required +
idempotent (`!= targetPillarId` predicate). 7/7 smoke tests.

#### Bucket-C Follow-up: Importer pillar-normalization ✅ COMPLETED 2026-05-24

`SyncClustersFromFrontmatterStep` extended with `PILLAR_NAME_CANONICALIZATION`
map (DE-display-label → EN-canonical-slug) applied before pillar INSERT +
cluster pillarId assignment. Pure-helper export `canonicalizePillarName()` for
unit-test coverage. Future MDX that drifts back to legacy display-label forms
(`categorySlug: "Vergleiche"`, etc.) will no longer recreate the removed
pillars — the importer rewrites to canonical before lookup. The denormalized
`clusters.pillar` text field also stays canonical. 8/8 tests including 2
DB-integration scenarios. **Worker-restart required** on deploy.

## Priorität 2 (architectural improvements to the importer)

### Orphan-Detection im Importer

Today's flow: a file disappears from the Astro repo → DB row stays with
`status='published'`. A one-off cleanup script (Spec 001's
`cleanup-post-refactor-drift`) handles known orphans by hardcoded slug list.

The right pattern: a `DetectOrphanedArticlesStep` in
[packages/adapters/astro-sync/src/import](../../packages/adapters/astro-sync/src/import)
that compares the `filePath` of every imported-source row against the actual
files present in the Re-Import diff. Any row whose `filePath` no longer maps
to a current file gets auto-marked `status='superseded'`. Idempotent — re-runs
are no-ops once the row is supersedet.

Risks to spec: (a) false-positives from filePath rewrites (e.g. case-sensitivity
changes), (b) what to do with `source='generated'` rows whose corresponding
generated file in Astro was manually deleted — probably leave untouched, only
touch `source='imported'`.

### Slug-Rename-Detection im Importer

✅ **CLOSED 2026-05-24 via Spec 005 IR1** (Option D — partial unique index).
Migration 0103 replaces the hard unique `(project, source, collection, locale, slug)`
with a partial unique `WHERE status != 'superseded'`. `UpsertArticlesStep.onConflictDoUpdate`
mirrors the predicate via `targetWhere: sql\`status != 'superseded'\``.
`FilterChangedFilesStep` also filters superseded rows from its `existingByPath`
index so a stale superseded row's filePath doesn't short-circuit gitSha-equality
and skip the new file. Superseded rows are tombstones; the importer is free to
INSERT new active rows at the same slug. See
[`docs/discovery/ir1-upsert-articles-code-read.md`](../discovery/ir1-upsert-articles-code-read.md)
for the full Code-Read incl. defense-in-depth check + option analysis.

Pattern findings (kept for reference): the originally-feared "cornerstoneKeyword
heuristic" doesn't exist in the code — matching is purely on the unique constraint.
The actual mechanism that hit Anomaly-A was the hard unique constraint matching
superseded rows during `onConflictDoUpdate`, not a separate rename-detection
pipeline. A future "Slug-Rename-Detection + auto-supersede-link" feature could
still be valuable for canonical-URL stability + redirect generation, but it's
no longer blocking — superseded rows now co-exist cleanly with active rows.

### Mirror-Step-Ordering im Importer

✅ **CLOSED 2026-05-24 via Spec 005 IR2** (Option B — additive backfill step).
New `MirrorBackfillHeroesStep` runs AFTER `UpsertArticlesStep` in the
RepoImportPipeline. It picks up `source='imported'` rows where
`hero_image_r2_key IS NULL` (excluding `COLLECTIONS_WITHOUT_HERO`) and re-mirrors
through the same `mirrorOneArticle` helper used by `MirrorHeroImagesStep` and
the `backfill-imported-heroes` CLI. Heroless rows from prior failed mirrors
self-heal on every Re-Import, regardless of MDX gitSha state.

The original "Mirror reads DB" framing was wrong (see
[`docs/discovery/ir2-mirror-step-ordering-code-read.md`](../discovery/ir2-mirror-step-ordering-code-read.md)
§1-2 for the Code-Read): `MirrorHeroImagesStep` always operated on in-memory
parsed entries, not DB rows. The actual Anomaly-B was caused by a
default-hero-path bug (fixed separately on 2026-05-24 15:57Z). The new step
closes the underlying durability gap: any Mirror failure (404, R2 outage,
GitHub transient) on a NEW INSERT no longer requires manual recovery.

Shared `heroRefreshWhitelistUpdateSet()` helper extracted to keep both
`UpsertArticlesStep` (inline UPDATE) and `MirrorBackfillHeroesStep` (standalone
UPDATE) using identical hash-equality preservation semantics — UI-edited
`heroImageAltText` still survives unchanged-content Re-Imports.

`backfill-imported-heroes --dry-run` CLI is kept for ad-hoc audits (same posture
as Spec 64.10's `cleanup-orphan-heroes`).

## Priorität 3 (smaller items)

- **`projects.allowed_collections` / `default_locale`** — task-brief fields
  referenced in Spec 001 §10 but not in the DB schema. Either add columns +
  migration, or correct the task brief. Today's behaviour: collection
  filtering is derived from per-collection schema discovery
  (`ExtractCollectionSchemasStep`), so `allowed_collections` may be redundant.
  Audit before migrating.

- **Refresh-Whitelist documentation.** Spec multi-domain-evolution S1.1
  introduced the concept but the per-collection whitelist is implicit in
  [packages/adapters/astro-sync/src/import/steps/upsert-articles.ts](../../packages/adapters/astro-sync/src/import/steps/upsert-articles.ts).
  Extract to a typed `REFRESH_WHITELIST_BY_COLLECTION` constant so future
  cleanup specs can reason about it without code-spelunking. Caught Spec 001
  D3 (stale `category`/`published_at`/`tags` were Refresh-Whitelist-protected,
  forcing the cleanup-NULL approach).

## Spec 65.2 — Brand-Asset Pipeline Follow-Ups

Bewusst aus 65.2 V1 herausgehalten — sechs Items, gestaffelt nach Priorität.
Logged 2026-05-25 nach erstem Toolwiki-Backfill (54 Rows / 0 errors / 24 ohne
Logo-Treffer in der Chain).

### Priorität 2 (sobald 65.7/65.8 Templates landen)

- **Schema-Refactor: `tool_brand_assets.toolId` per-locale → per-tool-concept.**
  V1 ist `toolId` FK auf `articles.id` (per-locale). Bilinguale Tools (Toolwiki
  seit Spec 59.2) erzeugen damit zwei logische Asset-Slots pro Tool — V1 löst
  das via Locale-Filter (`projects.targetLocales[0]`) im List- und Backfill-
  Endpoint, aber EN-Renders finden via `articles.id`-Lookup keine Row. Sauberer:
  PK-Wechsel auf `(project_id, slug)` ODER eine separate `tool_concepts`-Tabelle
  mit `articles.tool_concept_id` FK. Migration ist nicht trivial (108 Rows
  müssen re-verknüpft werden) — ergibt nur Sinn wenn die Templates Brand-Assets
  cross-locale konsumieren wollen.

- **Sibling-Traversal beim Template-Render** (V1-Workaround zum Schema-Refactor).
  Solange `toolId` per-locale bleibt: Template-Adapter sollte beim Lookup für
  EN-Artikel auf den DE-Sibling via `translationKey` fallen-back-en. Kein DB-
  Eingriff nötig, nur Code-Pfad im Render-Adapter. Diese Lösung reicht
  vermutlich für 65.7/65.8 — der Schema-Refactor oben wird dann eventuell nicht
  mehr nötig.

- **Engine reads-from-DB (Option C der 65.2 Discovery §3.2).** Aktuell liest die
  Engine `resolveToolIcon` aus `project_brand_assets` (52b-Tabelle), nicht aus
  `tool_brand_assets` (65.2-Tabelle). Marcel-Edits in der 65.2-UI wirken sich
  daher noch NICHT auf Production-Renders aus. Ziel: Engine liest erst aus
  `tool_brand_assets`, fällt zur Chain zurück, Redis-Pub/Sub
  `brand-assets:changed` invalidiert In-Memory-Cache bei UI-PATCH. Vorher
  müssen 65.7/65.8 die Tabelle aktiv konsumieren (sonst nur Cache-Aufwand
  ohne Nutzen).

### Priorität 3 (Coverage-Verbesserungen, optional)

- **Iconify `devicon`-Namespace ergänzen.** ~150 Dev-Tool-Icons, MIT-lizenziert,
  passt in die bestehende Iconify-Adapter-Schicht. Würde Coverage in Tools wie
  `synthesia`, `murf`, `jasper`, `writesonic` (aktuell deterministic-avatar in
  Toolwiki) potenziell verbessern — Backfill-Bilanz 2026-05-25 zeigte
  24/54 (44%) Avatar-Fallbacks. Alternative zu YeThura-Repo (siehe Coverage-
  Analyse 2026-05-25: 75% direkte Überlappung mit lobe-icons + simple-icons,
  KEIN LICENSE-File im YeThura-Repo → nicht adoptierbar).

- **Iconify `mdi` (Material Design Icons) als Last-Resort.** ~7000 generische
  Icons, Apache 2.0. Schlechter als Brand-Logos für Marketing-Output, aber
  besser als reiner Initials-Avatar wenn z.B. `tana` oder `tome` als
  generisches "Note-Taking-App"-Symbol angedeutet werden soll. Kann auch
  per-Tool-Override via UI angeklickt werden statt automatisch.

- **Dark-Variant des Logos** (`tool_brand_assets.logo_dark_url`). 65.1 Schema
  hat das Feld schon, 65.2 V1 nutzt es nicht — alle Logos kommen single-variant.
  Lobe-icons liefert separate dark/light Files; simple-icons hat im `icon.svg`
  oft `fill="currentColor"` was dunkel-rendert (siehe Screenshot 2026-05-25).
  Wenn 65.7/65.8 Light- UND Dark-Mode-Templates haben, lohnt sich der Aufwand.
