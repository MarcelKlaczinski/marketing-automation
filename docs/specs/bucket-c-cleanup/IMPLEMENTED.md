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

## Follow-up

Documented in
[`docs/backlog/post-cleanup-followups.md`](../../../docs/backlog/post-cleanup-followups.md)
Bucket-C section:

- **C4 (`content_categories.parent_slug` hierarchy)** — still open, separate spec
  needed if cross-tenant hierarchy queries become a use case.
- **`Uncategorized`-cluster reassignment** — 20 of 46 Toolwiki clusters sit
  under the `Uncategorized` pillar fallback. Future bulk-reassign spec.
- **Marcel-action: Toolwiki Re-Import** — after MDX clusterKey fix above,
  `POST /api/projects/toolwiki/astro-import` to sync the cluster naming
  into DB. Verify with a third `capture-bucket-c-baseline` snapshot.
