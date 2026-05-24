# Post-Cleanup Folge-Specs

Created by Spec 001 (DB-Cleanup Post-Refactor) §5.3 on 2026-05-24.

Items deliberately scoped out of Spec 001 to keep the cleanup tight. None are
blocking; each is a discrete follow-up that can be picked up independently.

## Priorität 1

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

- **C1 — `content_pillars` Schwester-Drift (20 rows with doppel-naming).**
  Audit identified pillars duplicated under DE/EN variants of the same
  semantic concept. Spec a merge strategy (canonical row + alias, or hard
  consolidation) and a one-off cleanup script with capture-before/after
  pattern (mirror Spec 001).

- **C2 — `clusters` doppel-language slugs.** Pairs like `code-assistants-2026`
  + `code-assistenten-2026` are the same cluster in different locales but
  modeled as separate rows. Decide: do clusters need locale-scoping (add
  `locale` column + uniqueness key changes) or per-cluster slug
  consolidation? Affects Hub-Spoke routing and planner cluster Belegung.

- **C4 — `content_categories.parent_slug` hierarchy migration.** Today's
  schema is flat; multi-domain-evolution noted a need for parent-child
  relationships. Migration + Drizzle schema + a small backfill script.

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

Today: file rename = new row created + old row keeps stale filePath. The
importer doesn't realize the two are linked.

Pattern: when an import diff sees a new file AND an existing row with the
same `cornerstoneKeyword` + `locale` + `collection` but different `slug`,
flag as a rename candidate. Either auto-supersede the old row (write
`supersededBy` link), or surface to Marcel for manual confirm. Affects
canonical-URL stability + redirect generation in the Astro build.

**Related Anomaly A footgun (2026-05-24, see
[`docs/specs/fix-slug-rename-supersede-conflict/spec.md`](../specs/fix-slug-rename-supersede-conflict/spec.md)):**
`UpsertArticlesStep` matches new/renamed files against existing rows by
`cornerstoneKeyword` + filePath-proximity, but the match does NOT filter by
status. So superseded rows get re-purposed as match targets — the
`filePath` gets updated in-place on the superseded row, leaving 0 active
rows for the new slug. Recommended fix as part of this same Folge-Spec:
add `AND status != 'superseded'` to the match-query WHERE clause. If no
match: insert as new row. The Slug-Rename-Detection pattern above subsumes
this fix when the matcher learns to recognize the rename and either
auto-supersedes the OLD row (keeping it superseded) + inserts a NEW one,
or links them via `supersededBy`.

### Mirror-Step-Ordering im Importer

Today's flow: `MirrorHeroImagesStep` iterates over DB-Rows BEFORE
`UpsertArticlesStep` inserts new rows. Newly-inserted rows therefore don't
get heroes in the SAME run — they need either a second Re-Import or a
separate `backfill-imported-heroes --apply` run to pick up the heroes.

Discovered during the C4 Re-Import for Anomaly A (see
[`docs/discovery/post-cleanup-final-verification.md`](../discovery/post-cleanup-final-verification.md)
"Anomaly B" 15:34Z update): Marcel triggered two Re-Imports in succession,
the second one fired the Mirror-Step against the rows the first Re-Import
had inserted. Functional but operationally awkward (two clicks instead of
one).

**Empfohlene Lösung:** Either (a) move `MirrorHeroImagesStep` AFTER
`UpsertArticlesStep` in `RepoImportPipeline`, OR (b) change the step to
read parsed-file state from pipeline-input rather than DB rows (so newly-
parsed-but-not-yet-upserted files are also covered in-run). Option (b) is
the cleaner long-term design — couples the mirror to the canonical source
(the parsed files) instead of the derivative DB state.

### Aufwand-Schätzung

~1-2 Tage für Slug-Rename-Handling + Mirror-Step-Ordering kombiniert in
einer Folge-Spec. Nicht blocking für Bucket-D / Bucket-C / Theme 65.

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
