# BD3 Baseline — `content_pillars` source-of-truth audit

_Spec Bucket-D / BD3 (2026-05-24). Code-read + DB-state snapshot for the post-refactor `content_pillars` table. Captured for the future Cluster-Toolification implementation per the BD3 patch (no fix in this branch)._

## TL;DR

- `content_pillars` IS populated, contrary to the audit hypothesis. Two production writers exist.
- The actual drift in the table is **Schwesterkonzept-Drift**: German + English variants of the same concept coexist as separate rows (e.g. `Grundlagen` orphan + `fundamentals` active). Plus 3 cluster-shaped slugs landed in the pillars table by accident.
- The 12 "new ki-wissen pillars" mentioned in the post-refactor audit (`neuronale-netze`, `backpropagation`, `eu-ai-act`, …) are CLUSTER keys, not categories. They were never expected to materialize as pillars — the audit hypothesis confused two different concepts.
- Cluster-Toolification (Toolwiki repo, approved 2026-05-24, deferred implementation) replaces `content_pillars` entirely. BD3 documents the state and stops.

## BD3.1 — Code-read

### Writer 1: `SyncClustersFromFrontmatterStep` (importer)

[`packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts`](../../packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts) runs during every Astro import.

Inputs:
- `articles.category` (string, set by `UpsertArticlesStep` from Astro frontmatter `category:` field)
- `articles.cluster_key` (string, set the same way from `clusterKey:` frontmatter)
- `articles.source = 'imported'` filter scopes to imported articles only

Pillar materialization logic (lines 70–126):
1. Group all imported articles by distinct `(clusterKey, category)` pairs
2. For each distinct `category` value → INSERT `content_pillars` row with `name = category` and `description = "Auto-imported from Astro repo frontmatter"`
3. Plus an "Uncategorized" fallback pillar (always inserted if absent)

Cluster materialization logic (lines 135–225):
- Each distinct `clusterKey` → row in `clusters` table
- Cluster's `pillarId` resolved by looking up the member's `category` in `content_pillars`
- Cluster's `pillar` (legacy string field on `clusters`) = `category`

So the importer creates pillars from `articles.category`, NOT from `articles.cluster_key` and NOT from a dedicated `pillar:` frontmatter field. The audit's hypothesis ("no pillar:-field handler") was technically correct but missed that `category:` is the de-facto pillar source.

### Writer 2: `cluster:full-plan` (cluster-creator)

[`packages/pipelines/src/cluster/full-plan/run-from-brief.ts`](../../packages/pipelines/src/cluster/full-plan/run-from-brief.ts) (lines 109–170) INSERTs a `content_pillars` row when the user creates a new cluster via the Cluster-Creator UI and chooses a pillar name not present in the table.

This is the source of the 3 cluster-shaped rows that landed in `content_pillars`:
- `ki-regulierte-branchen-2026` (position 00, no articles, description "Cluster zu KI-Anwendungen in stark regulierten Branchen wie…")
- `ki-sicherheit-datenschutz-2026` (position 00, no articles)
- `rag-context-engineering-2026` (position 00, no articles)

Those look like cluster slugs that were typed into the pillar-name field of the Cluster-Creator UI by mistake (or by an LLM proposal that wasn't sanitized). They have descriptions that read "Cluster zu …" / "Cluster rund um …" — confirming the conflation.

### Reader sites

Three production readers of `content_pillars`:
- `packages/pipelines/src/config/resolve-intent-taxonomy.ts` — reads `intent_taxonomy_override` for per-pillar intent customization (Spec 54.2)
- Cluster + planner step contexts indirectly via `clusters.pillarId` (FK)
- Admin / Settings UI surface (lists pillars for the project, drives the Cluster-Creator dropdown)

So the table IS read at runtime, but the drift in the table doesn't actively break anything — readers consume whatever is there (Schwesterkonzept-Drift entries are silently mis-grouped but not crash-causing).

## BD3.2 — DB state snapshot (Toolwiki, 2026-05-24)

Full JSON snapshot: [`apps/api/src/scripts/discovery/content-pillars-state-toolwiki-2026-05-24T16-28-00-603Z.json`](../../apps/api/src/scripts/discovery/content-pillars-state-toolwiki-2026-05-24T16-28-00-603Z.json).

### Counts

| | Count |
|---|---|
| Total pillars | 29 |
| Pillars with ≥1 article referencing them by `category` | 14 |
| Pillars with 0 article references (orphans + cluster-shaped + Uncategorized) | 15 |
| Pillars with article references by `cluster_key` | 0 (confirmed — pillars are not referenced by cluster_key) |

### Drift inventory

**Sister-concept pairs** (German + English variants — same concept, two pillar rows):

| German variant (orphan, 0 articles) | English variant (active) | Article count (en) |
|---|---|---|
| `Grundlagen` | `fundamentals` | 10 |
| `Guides & Tutorials` | `guides-tutorials` | 25 |
| `Praxis` + `Praxis & Use Cases` | `practice-use-cases` | 16 |
| `Technik` | `technology` | 12 |
| `Tool-Reviews` | `tool-reviews` | 8 |
| `Zukunft` | `future` | 2 |
| `Vergleiche` | — (no English variant) | 0 |

**Wrong-table cluster slugs** (cluster names that landed in `content_pillars` via `cluster:full-plan`):

| Slug | Articles |
|---|---|
| `ki-regulierte-branchen-2026` | 0 |
| `ki-sicherheit-datenschutz-2026` | 0 |
| `rag-context-engineering-2026` | 0 |

**Boilerplate**:

| Pillar | Articles | Note |
|---|---|---|
| `Uncategorized` | 0 (by-design fallback row) | Always created by the importer if missing |

**Active pillars** (have article references — these are the live source-of-truth today):

```
business-productivity (no row in pillars — categories aren't always promoted)
fundamentals (10)
guides-tutorials (25)
images-graphics (16)
marketing-seo (8)
practice (4)
practice-use-cases (16)
technology (12)
text-language (24)
tool-reviews (8)
video-animation (18)
audio-music   (not in pillars but used as category — 12 articles)
ethics-law    (not in pillars but used as category — 12 articles)
coding-development (not in pillars but used as category — 8 articles)
comparisons   (not in pillars but used as category — 5 articles)
future (2)
```

> **Note:** several categories used by imported articles (`business-productivity`, `audio-music`, `ethics-law`, `coding-development`, `comparisons`) don't have a matching `content_pillars` row. Either they were never imported through the current `SyncClustersFromFrontmatterStep` code path (the import that introduced them ran a pre-Spec-49a version of the importer), or those imports happened before the importer was bug-fixed. Cluster-Toolification renders this distinction moot.

### Categorization coverage on imported articles

Out of 318 imported articles in Toolwiki:
- 116 (37%) have `category = NULL` — never get a pillar via the importer
- 64 (20%) have `cluster_key = NULL` — orphan articles outside the cluster graph

So the `content_pillars` table currently represents ~63% of imported articles' editorial taxonomy. The other 37% are uncategorized at the column level.

### The "12 missing ki-wissen pillars" — clarification

The post-refactor audit flagged:
> 12 neue ki-wissen-Pillars erscheinen NICHT in `content_pillars`-Tabelle: `neuronale-netze`, `backpropagation`, `eu-ai-act`, etc.

The audit's enumerated slugs are CLUSTER keys (`articles.cluster_key`), NOT category values. They were never expected to materialize as pillars under the current schema. Branch-B introduced them as a new clustering layer for the ki-wissen collection, and they live in `clusters` (or were intended to). The audit hypothesis conflated:
- `content_pillars.name = articles.category` (this is the actual pillar↔article link, works as designed)
- `clusters.name = articles.cluster_key` (this is the cluster↔article link, separate concern)

This is one of the artifacts Cluster-Toolification will simplify by unifying the two concepts under a single hierarchical `clusters` + `cluster_memberships` model. See the Toolwiki spec for details.

## BD3.3 — Decision

Per the BD3 patch (2026-05-24): **document the state, do not fix.** The drift inventory above is input material for Cluster-Toolification implementation, which obsoletes this table.

If Cluster-Toolification stays deferred indefinitely AND `content_pillars` drift becomes a blocker for a downstream feature (Plan-Generation, UI), re-open D4 as a small spec. Triggers documented in [`docs/backlog/post-cleanup-followups.md`](../backlog/post-cleanup-followups.md).

## References

- Spec: [`docs/specs/bucket-d-fixes/spec.md`](../specs/bucket-d-fixes/spec.md)
- BD3 patch: [`docs/specs/bucket-d-fixes/spec-patch-bd3-2026-05-24.md`](../specs/bucket-d-fixes/spec-patch-bd3-2026-05-24.md)
- Post-refactor audit: [`docs/discovery/post-refactor-state-audit.md`](post-refactor-state-audit.md) §6.1 D4
- Importer step: [`packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts`](../../packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts)
- Cluster-creator pillar write: [`packages/pipelines/src/cluster/full-plan/run-from-brief.ts:158`](../../packages/pipelines/src/cluster/full-plan/run-from-brief.ts:158)
- Snapshot: [`apps/api/src/scripts/discovery/content-pillars-state-toolwiki-2026-05-24T16-28-00-603Z.json`](../../apps/api/src/scripts/discovery/content-pillars-state-toolwiki-2026-05-24T16-28-00-603Z.json)
- Toolwiki Cluster-Toolification spec (separate repo): `docs/backlog/cluster-toolification.md`
