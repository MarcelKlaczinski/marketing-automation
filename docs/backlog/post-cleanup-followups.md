# Post-Cleanup Folge-Specs

Created by Spec 001 (DB-Cleanup Post-Refactor) §5.3 on 2026-05-24.

Items deliberately scoped out of Spec 001 to keep the cleanup tight. None are
blocking; each is a discrete follow-up that can be picked up independently.

## Priorität 1

### Bucket-D Bug-Fixes (from `docs/discovery/post-refactor-state-audit.md` §6.1)

- **D1 — `articles.astro_frontmatter` column status.** Phase-1 audit flagged
  it as a candidate dead column, but no Phase-0 grep was run to confirm. Run
  the EXTENDED-grep checklist (root CLAUDE.md "schema leiche" rule:
  `(data as any).astroFrontmatter`, `frontmatter["astro_frontmatter"]`,
  `extras["astroFrontmatter"]`, plus the bare identifier) across
  `packages/adapters/astro-sync/src/`, `packages/pipelines/src/article/`, and
  the external Astro repo. Either confirm dead → migration `DROP COLUMN`, or
  document the live consumer.

- **D4 — `content_pillars` Frontmatter-Sync gap.** Audit noted that pillars
  may not be seeded from frontmatter today. Verify
  `SyncClustersFromFrontmatterStep` reads the pillar field and writes
  `content_pillars` rows; if it doesn't, spec the sync (similar shape to the
  existing cluster sync).

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
