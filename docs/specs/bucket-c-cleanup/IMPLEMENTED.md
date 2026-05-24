# Bucket-C Cleanup — Implementation Record

Applied 2026-05-24 against Toolwiki tenant.
Spec: [specs/002-bucket-c-cleanup.md](../../../specs/002-bucket-c-cleanup.md)

## Phase 1: content_pillars consolidation

10 rows deleted, 1 cluster re-pointed. Toolwiki pillars: 29 → 19.

| Keep (canonical) | Drop | Cluster Re-points |
|---|---|---|
| `comparisons` | `Vergleiche` | 0 |
| `ethics-law` | `Ethik & Recht` | 0 |
| `fundamentals` | `Grundlagen` | 0 |
| `future` | `Zukunft` | 0 |
| `guides-tutorials` | `Guides & Tutorials` | 0 |
| `technology` | `Technik` | 0 |
| `tool-reviews` | `Tool-Reviews` | 0 |
| `practice` | `practice-use-cases` | 1 (`ki-business-2026` → `practice`) |
| `practice` | `Praxis` | 0 |
| `practice` | `Praxis & Use Cases` | 0 |

**Convention going forward:** EN-canonical, lowercase-slug-form. Public Astro
site unaffected (Astro reads per-locale display labels from its own
`categories/` collection, not from our DB `content_pillars`).

**Deliberately preserved (NOT in drop-list):**
- `ki-regulierte-branchen-2026`
- `ki-sicherheit-datenschutz-2026`
- `rag-context-engineering-2026`

These 3 pillars violate the lowercase-slug-form convention but carry custom
`intentTaxonomyOverride` JSONB needed by
[`resolve-intent-taxonomy.ts`](../../../packages/pipelines/src/config/resolve-intent-taxonomy.ts).
Deleting them would silently break production-pipeline intent classification.

## Phase 2: clusters consolidation — Option Y (MDX-side fix, not DB)

**Originally planned:** consolidate `code-assistenten-2026` (DE) →
`code-assistants-2026` (EN), re-reference 8 articles, delete 1 cluster row.

**Discovery during BC2.2 surfaced 2 blockers:**

1. `articles.cluster_key` is a mirror of the Astro MDX `clusterKey`
   frontmatter field, NOT in the refresh-whitelist. Any DB-side UPDATE
   survives only until the next Re-Import; the importer overwrites with the
   MDX value, undoing the cleanup.
2. The Astro public frontend
   ([BlogPost.astro:137-199](../../../../ki-wissensraum-neu/src/layouts/BlogPost.astro))
   reads `clusterKey` directly from MDX for related-articles widget, tool
   filtering, and same-cluster +1000 scoring. DB-side cleanup does not fix
   the actual public-site grouping — that lives in MDX.

**Resolution: Option Y (per-locale-canonical, MDX-side fix):**

DE and EN articles keep separate clusters by design. Fix landed in the Astro
repo, not in our DB:

- `tools/en/cursor.mdx` — `clusterKey: "code-assistenten-2026"` → `"code-assistants-2026"`
- `tools/en/github-copilot.mdx` — `clusterKey: "code-assistenten-2026"` → `"code-assistants-2026"`

After Toolwiki Re-Import (Marcel-action), the DB will naturally have:
- 4 DE tools articles under `code-assistenten-2026` (correct per-locale)
- 4 EN tools articles under `code-assistants-2026` (correct per-locale)
- 2 orphan blog articles (`blog/de/code-assistenten`, `blog/en/ai-code-assistants`)
  drop out via Spec 001 `status='superseded'` flip.

`CLUSTER_CONSOLIDATIONS_BY_PROJECT.toolwiki = []` in
[`cleanup-bucket-c-drift.ts`](../../../apps/api/src/scripts/cleanup-bucket-c-drift.ts).

## Verification

- **Pre-cleanup snapshot:** `apps/api/src/scripts/discovery/bucket-c-baseline-toolwiki-2026-05-24T16-58-04-352Z.json`
- **Post-cleanup snapshot:** `apps/api/src/scripts/discovery/bucket-c-baseline-toolwiki-2026-05-24T16-58-40-485Z.json`
- **Pillars: 29 → 19** ✅
- **Clusters: 46 → 46 (unchanged, Option Y)** ✅
- **Orphaned cluster_keys: 0 (no broken article-cluster references)** ✅
- **`ki-business-2026` cluster now points at `practice` (was `practice-use-cases`)** ✅
- **3 ki-wissen pillars preserved** ✅
- **Idempotence: second `--apply` = 0 mutations** ✅

## Smoke tests

10/10 cases in
[`apps/api/test/scripts/cleanup-bucket-c-drift.smoke.test.ts`](../../../apps/api/test/scripts/cleanup-bucket-c-drift.smoke.test.ts).
Uses in-memory `DatabasePort` DI fakes — no Postgres roundtrip. The real-DB
verification was the Toolwiki apply + pre/post snapshot diff above.

## Post-Re-Import verification (Toolwiki, 2026-05-24)

Marcel triggered Toolwiki Re-Import after the Astro MDX clusterKey commit
(`0332b020 fix(docs): correct clusterKey typo in MDX files`). Third snapshot
captured: `bucket-c-baseline-toolwiki-2026-05-24T17-16-59-046Z.json`.

| Metric | Pre-cleanup | Post-cleanup | Post-Re-Import |
|---|---|---|---|
| `content_pillars` total | 29 | 19 | **20** |
| `clusters` total | 46 | 46 | **46** |
| Orphaned cluster_keys | 0 | 0 | **0** |
| EN articles on `code-assistants-2026` | 2 | 2 | **4** ✅ |
| DE articles on `code-assistenten-2026` (tools) | 4 | 4 | **4** ✅ |
| EN articles still on `code-assistenten-2026` | 4 | 4 | **1 (orphan)** |

### Findings

**Option Y MDX-side fix worked ✅** — 4 EN tools articles grouped under
`code-assistants-2026`, 4 DE tools articles under `code-assistenten-2026`.
Astro public related-articles widget now groups cleanly per locale.

**1 stale EN article on `code-assistenten-2026`** — `blog/en/ai-code-assistants`
with `status='superseded'`. Spec 001 orphan (MDX file already deleted from
Astro repo). Dormant — `superseded`-filter blends it out of every active query.
No action needed.

**`practice-use-cases` pillar re-created by Re-Import** —
`SyncClustersFromFrontmatterStep` saw 16 blog articles with `categorySlug:
"practice-use-cases"` and re-INSERTed the pillar. `ki-business-2026` cluster
correctly re-pointed from `practice` (where Bucket-C cleanup put it) back
to `practice-use-cases` (its actual category).

**Root cause:** the original consolidation conflated TWO scope-canonical
category slugs:
- `categories/knowledge/practice.md` — scope=knowledge, slug=`practice`,
  label=`Praxis` — used by 4 ki-wissen articles
- `categories/blog/practice-use-cases.md` — scope=blog, slug=`practice-use-cases`
  — used by 16 blog articles

These are NOT bilingual duplicates; they're a two-scope taxonomy that shares
vocabulary. The Bucket-C audit grouped them as drift because the DB
`content_pillars.name` column flattens both scopes into one namespace. The
Re-Import correctly self-healed.

**Net cleanup gain post-Re-Import: 9 pillars** dauerhaft entfernt (7 EN/DE-pair
display-name drift + `Praxis` + `Praxis & Use Cases` display-label form).
`practice-use-cases` came back because it's a real category slug.
ki-wissen `practice` was always correct and remains. 3 ki-wissen pillars
with `intentTaxonomyOverride` preserved as planned.

### Lesson for future Bucket-C-style cleanups

Before consolidating any pillar whose name looks like a category slug, check
the Astro-side `categories/<scope>/<name>.md` files for EACH scope (`blog`,
`knowledge`, `tool`, `usecase`). If `categories/X/foo.md` AND
`categories/Y/foo-bar.md` both exist as separate scope-canonical slugs, they
are NOT duplicates — they are two-scope taxonomy with shared vocabulary.
Consolidation will be undone by `SyncClustersFromFrontmatterStep` on the
next Re-Import.

## Follow-up

Documented in
[`docs/backlog/post-cleanup-followups.md`](../../../docs/backlog/post-cleanup-followups.md)
Bucket-C section:

- **C4 (`content_categories.parent_slug` hierarchy)** — still open, separate spec
  needed if cross-tenant hierarchy queries become a use case.
- **`Uncategorized`-cluster reassignment** — 20 of 46 Toolwiki clusters sit
  under the `Uncategorized` pillar fallback. Future bulk-reassign spec.
- **Importer pillar-normalization (Bucket-D candidate)** — Spec 002 §9 R6 risk
  realized: `SyncClustersFromFrontmatterStep` auto-creates pillars from any
  `articles.category` value. Future fix: normalize pillar names against a
  project-level whitelist before INSERT, or replace pillar-from-category
  auto-creation with explicit pillar definitions.
- **Marcel-action: Toolwiki Re-Import** — ✅ DONE 2026-05-24. State verified
  in the snapshot diff above.
