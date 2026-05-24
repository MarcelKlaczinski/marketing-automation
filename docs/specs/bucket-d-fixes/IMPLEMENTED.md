# Spec Bucket-D — Implementation Log

_Spec: [`spec.md`](spec.md) (+ BD3 patch [`spec-patch-bd3-2026-05-24.md`](spec-patch-bd3-2026-05-24.md))_
_Branch: `feature/bucket-d-fixes`_
_Implemented: 2026-05-24_

## TL;DR

Three Bucket-D footguns from
[`docs/discovery/post-refactor-state-audit.md`](../../discovery/post-refactor-state-audit.md)
§6.1 were investigated, classified, and **all three closed via documentation
+ discovery scripts — no migrations, no code-level filters, no DB writes**.

| | Outcome | Why |
|---|---|---|
| D1 (`astro_frontmatter`) | By-design dormant + documented | Forensic column written by generation-sync; no production reader; future generated-workflow tenants will populate it. DROP would be throwaway. |
| D2 (`schema_json_ld` footgun) | Soft-Guard + documented | Reachable via HTTP routes but dormant because no Toolwiki collection declares the field in its Astro Zod schema; Trigger-Filter deferred until activation conditions trigger. |
| D4 (`content_pillars`) | Documented as obsolete-by-refactor | Cluster-Toolification approved (deferred implementation) replaces the table; BD3 patch explicitly scoped fix-work out. |

No migration was authored. The reserved `0103` migration slot stays free for the next consumer.

## Changes by Sprint

### BD1 — `astro_frontmatter` (D1)

**Files touched:**
- [`apps/api/src/scripts/discovery/audit-astro-frontmatter-usage.ts`](../../../apps/api/src/scripts/discovery/audit-astro-frontmatter-usage.ts) — new read-only audit script with optional `--project=<slug>` + `--json` snapshot
- [`apps/api/package.json`](../../../apps/api/package.json) — registered the script as `audit-astro-frontmatter-usage`
- [`packages/db/src/schema/content.ts`](../../../packages/db/src/schema/content.ts) — added doc-comment on `astroFrontmatter` explaining the forensic-copy role
- [`packages/adapters/astro-sync/CLAUDE.md`](../../../packages/adapters/astro-sync/CLAUDE.md) — new section "`articles.astro_frontmatter` is a forensic copy"

**Discovery evidence (Toolwiki, 2026-05-24):**
```
total=318  populated-non-empty=0  populated-empty={}=0  NULL=318
by source: imported=0/318  generated=0/0
```

0/318 populated rows in Toolwiki. Cross-tenant: 0 populated across all test-fixture + production projects.

**Categorization (full grep):**
| Category | Sites |
|---|---|
| Schema definition | 1 ([content.ts:149](../../../packages/db/src/schema/content.ts)) + DDL (`0004_astro_sync_schema.sql`) |
| Production writer | 1 ([update-db-status.ts:42](../../../packages/adapters/astro-sync/src/steps/update-db-status.ts) — generation-sync only) |
| Production reader | 0 (only audit scripts read it) |
| Mock-factory `null` | 1 ([admin.ts:87](../../../apps/api/src/routes/admin.ts) — in-memory `Article` shape for template previews, no DB write) |
| Tests | 1 ([integration.test.ts:110,121](../../../packages/adapters/astro-sync/test/integration.test.ts)) |

Marcel-decision: **By-design dormant** (kept column, documented). DROP rejected because (a) writer is wired for a real production flow that just hasn't fired yet against Toolwiki, (b) future generated-workflow tenants (Bellemann, Balkonkraftwerk) would re-introduce the column.

### BD2 — `schema_json_ld` footgun (D2)

**Files touched:**
- [`packages/db/src/schema/content.ts`](../../../packages/db/src/schema/content.ts) — extended doc-comment on `schemaJsonLd` to cover the footgun, activation conditions, and the deferral rationale
- [`packages/adapters/astro-sync/CLAUDE.md`](../../../packages/adapters/astro-sync/CLAUDE.md) — new section "`articles.schema_json_ld` is a Soft-Guarded Footgun"

**Trigger-path findings:**
- `POST /api/articles/:id/extend-schema` ([articles.ts:1729-1754](../../../apps/api/src/routes/articles.ts)) is source-agnostic
- `POST /api/articles/:id/sync` ([articles.ts:1612-1630](../../../apps/api/src/routes/articles.ts)) is source-agnostic
- `enqueueSchemaExtension` ([trigger.ts:5-38](../../../packages/pipelines/src/schema-extension/trigger.ts)) gates on `status ∈ {final_review, schema_extending}` but NOT on `source`
- Four `afterComplete` hook callers (article / translation / refresh / blog pipelines) all fire on generated articles in normal use; an imported article would only reach those paths via explicit Marcel-click to `/extend-schema` after an import

**Footgun activation gate:**
- `RenderMdxStep` at [render-mdx.ts:266-267 + 285-290](../../../packages/adapters/astro-sync/src/steps/render-mdx.ts) reads `articles.schema_json_ld` and merges it into the rendered MDX but filters output keys against `input.collectionInfo.fields`
- **Direct DB probe (2026-05-24)**: no Toolwiki collection declares `schema` / `schemaJsonLd` as a field in `projects.astro_collection_schemas` → keys silently dropped

Marcel-decision: **Soft-Guard via documentation** (no Trigger-Filter). Activation requires either a future Astro schema adding `schema:` to a relevant collection OR a change to `RenderMdxStep`'s field-filter logic; both conditions are visible/reviewable. Trigger-Filter (spec Option A) is the canonical mitigation if activation triggers — kept as a known follow-up.

### BD3 — `content_pillars` (D4)

Per the BD3 patch (Cluster-Toolification approved 2026-05-24, deferred): document only.

**Files touched:**
- [`apps/api/src/scripts/discovery/audit-content-pillars-sources.ts`](../../../apps/api/src/scripts/discovery/audit-content-pillars-sources.ts) — new read-only audit script (required argument: `<project-slug>`)
- [`apps/api/package.json`](../../../apps/api/package.json) — registered the script as `audit-content-pillars-sources`
- [`apps/api/src/scripts/discovery/content-pillars-state-toolwiki-2026-05-24T16-28-00-603Z.json`](../../../apps/api/src/scripts/discovery/content-pillars-state-toolwiki-2026-05-24T16-28-00-603Z.json) — baseline JSON snapshot
- [`docs/discovery/bd3-content-pillars-baseline.md`](../../discovery/bd3-content-pillars-baseline.md) — full code-read + drift inventory (BD3.1 + BD3.2 outputs)
- [`packages/db/src/schema/identity.ts`](../../../packages/db/src/schema/identity.ts) — added doc-comment on `contentPillars` flagging "legacy table, scheduled for refactor"
- [`docs/backlog/post-cleanup-followups.md`](../../backlog/post-cleanup-followups.md) — replaced the D1+D4 TODO bullets with status updates; added a Cluster-Toolification-deferred D4 entry

**Key findings (Toolwiki, 2026-05-24):**
- The audit hypothesis was wrong — `SyncClustersFromFrontmatterStep` DOES write `content_pillars`, sourcing from `articles.category` (not from a dedicated `pillar:` field).
- The "12 missing ki-wissen pillars" the audit flagged are cluster_keys, not categories, so they were never expected to materialize as pillars.
- Real drift in the table: 7 sister-concept pairs (DE/EN variants e.g. `Grundlagen`/`fundamentals`) + 3 wrong-table cluster slugs from `cluster:full-plan`.
- Cluster-Toolification refactor would clean all of this up.

## Acceptance ✓

Spec §5 checklist:

1. ✓ D1 investigated: 4 outcomes considered, by-design-dormant chosen, documented (no migration).
2. ✓ D2 investigated: trigger-path analysis completed, soft-guard chosen, documented (no filter, no test).
3. ✓ D4 investigated: code-read + DB snapshot completed, documentation-only per BD3 patch (no fix).
4. ✓ Two new discovery scripts under `apps/api/src/scripts/discovery/`:
   - `audit-astro-frontmatter-usage.ts`
   - `audit-content-pillars-sources.ts`
5. — (No migration authored — slot `0103` remains free.)
6. — (No code filter implemented.)
7. ✓ IMPLEMENTED.md + backlog update.
8. ✓ D4 output ready as input for Toolwiki Cluster-Discovery (`docs/discovery/bd3-content-pillars-baseline.md`).

## Verify (BD4.3)

- `bun --filter @marketing-auto/db typecheck` — 0 errors
- `bun --filter @marketing-auto/api typecheck` — 0 errors
- `bun --filter @marketing-auto/adapter-astro-sync typecheck` — 0 errors
- `bun --filter @marketing-auto/db test` — 69 pass / 0 fail
- `bun --filter @marketing-auto/adapter-astro-sync test` — 90 pass / 0 fail

DB-state snapshot diff vs pre-BD: a fresh `capture-cleanup-baseline toolwiki` was taken at 16:31 UTC, compared against the most recent prior baseline (`baseline-toolwiki-2026-05-24T15-05-04-211Z.json`). Observed differences: counts 5→4, 5→4, 24→25 (net −1 article) and a locale-field ordering swap (cosmetic, from PostgreSQL `json_agg` ordering). Bucket-D performs **no DB writes**, so these are background-environment artifacts (cron-fired re-import, spec-001 cleanup churn, or parallel work). The capture script is safe to re-run any time.

## Spec deviations

1. **No migration `0103`**. Spec §3.1 / §7 D-2 anticipated a `DROP COLUMN astro_frontmatter` migration if D1 was classified as a dead column. Outcome was "by-design dormant", so no DDL.
2. **No Trigger-Filter for D2**. Spec §3.2 BD2.4 / §7 D-3 anticipated Option A trigger-filter if the footgun was a "real bug". Live state classified as middle row of the BD2.3 table ("dormant by virtue of Astro-schema-field-absence"), so soft-guard via documentation was chosen instead.
3. **No code change at all for D4**. Per BD3 patch.
4. **Discovery scripts surfaced one schema-fix bonus**: my initial `audit-astro-frontmatter-usage.ts` used non-existent enum values (`'manual'`, `'imported_retrieved'`) — the real `article_source` enum is just `('generated', 'imported')`. Caught at first run, fixed in the same change.
5. **Path-resolution fix in scripts**: `bun --filter` runs from the package directory, so `resolve("apps/api/...")` produces `apps/api/apps/api/...`. Both new scripts use `resolve(import.meta.dir, "<name>.json")` to colocate the snapshot with the script (mirrors `capture-bucket-c-baseline.ts`).
6. **`schemaJsonLd` doc-comment was almost duplicated**. My first edit attached the BD2 soft-guard comment in the wrong place (next to `astroAssetPaths`) and re-declared the column. Caught immediately via `grep -c`, removed the duplicate, attached to the original declaration at [content.ts:112](../../../packages/db/src/schema/content.ts).
