# Astro Markdown Sync Adapter

Pushes a `final_review` article from the DB to its project's Astro repository as an `.mdx` file
plus a hero image asset. Commits directly to main via the GitHub App API.

## Credential Loading (Spec 32)

GitHub App credentials are resolved from the global vault first:
- `github_app.app_id` → falls back to `GITHUB_APP_ID` env var
- `github_app.private_key_content` (inline PEM, self-hosted mode) — checked first
- `github_app.private_key_path` (file path, lokal mode) → falls back to `GITHUB_APP_PRIVATE_KEY_PATH` env var

If `private_key_content` is set in vault (self-hosted), the key is used directly (no file read).
Otherwise the adapter reads the PEM from the path. Set credentials via installer or env vars.

## Hard Rules

- This adapter is the ONLY writer to Astro repos for blog content. Manual edits to generated
  `.mdx` files are silently overwritten on the next sync.
- Each sync is one atomic GitHub commit (.mdx + image + any future siblings).
- Always commits directly to main. PR-mode is reserved for Spec 21.5.
- Schema parsing is best-effort. If the Astro repo's content config is unparseable,
  the adapter emits permissive frontmatter (everything we know) and warns about unpopulated
  required fields. Marcel must either fix the regex parser or use astroFrontmatterDefaults.
- `RenderMdxStep` routes to the Astro content folder via the `COLLECTION_FOLDER` map
  (Pattern 107, Spec 61.1). `articles.collection` (text) still reads `"blog"` for all current
  articles; `articles.collection_type` (enum) is what drives MDX folder routing.

## Required Environment

- `GITHUB_APP_ID` — App ID from GitHub App settings
- `GITHUB_APP_PRIVATE_KEY_PATH` — path to .pem file

See `SETUP-GITHUB-APP.md` in this package for one-time setup steps.

## Required Per-Project Configuration

Each project that wants to sync needs `projects.astro_repo` (set via Drizzle Studio):
```json
{
  "owner": "marcel-bauer",
  "name": "ki-wissensraum-astro",
  "installationId": 12345678,
  "defaultBranch": "main",
  "contentRoot": "src/content",
  "assetsRoot": "src/assets"
}
```

The installation ID comes from `bun --filter @marketing-auto/adapter-astro-sync list-installations`.

## Collection Schema Extraction (Spec 50)

On every Astro import run, `ExtractCollectionSchemasStep` (first step in `AstroImportPipeline`) fetches `src/content/config.ts` from GitHub, calls `parseAllCollectionSchemas()`, and persists the result to `projects.astroCollectionSchemas` (JSONB). Downstream pipeline steps (`TopicIntakeStep`, `OutlineStep`, `DraftStep`) read this and inject the field descriptors into the LLM system prompt so every generated article satisfies the Astro Zod schema at publish time.

`parseAllCollectionSchemas()` uses bracket-balanced extraction to parse the full `z.object({...})` body for each `defineCollection`. Field classifier produces `FrontmatterFieldDescriptor` objects with:
- `type`: `"string" | "string_array" | "object_array" | "number" | "boolean" | "date" | "unknown"`
- `enumValues?: string[]` — extracted from `z.enum([...])`
- `objectShape?: string` — inner field names for `object_array` (e.g. `"{ question, answer }"`)

**DOMAIN_EXTRAS protocol**: `DraftStep` instructs the LLM to output a structured HTML comment at the very end of the draft body:
```
<!-- DOMAIN_EXTRAS: {"category":"Guides & Tutorials","tags":["ki","chatbot"]} -->
```
The step parses this with a regex, strips it from `bodyMd`, and saves to `articles.domainExtras`. `buildFrontmatter()` in `apps/api/src/routes/articles.ts` merges these extras (highest priority) with schema defaults and static columns.

**Type-cast pattern for adapter vs DB types**: `ExtractCollectionSchemasStep` returns a value typed as `FrontmatterField[]` (adapter-local) but must persist as `AstroCollectionSchemas` (DB type). Use `as unknown as import("@marketing-auto/db").AstroCollectionSchemas` with a justification comment explaining the structural identity.

**Astro silent-exclusion trap**: Astro silently excludes content entries from `getStaticPaths()` when the collection's Zod schema fails validation (missing required fields like `date`, `category`, `excerpt`). The result is a 404 with no console error. Since Spec multi-domain-evolution S1.2, `RenderMdxStep` runs `validateFrontmatterAgainstSchema()` from [`src/lib/validate-frontmatter.ts`](src/lib/validate-frontmatter.ts) after `buildFrontmatter` + `transformImageFields` and throws `AstroSyncValidationError` (from [`src/errors.ts`](src/errors.ts)) on `missing_required` / `type_mismatch` / `enum_mismatch` — closing the silent-skip gap before the article ever reaches GitHub. `unpopulatedRequired` in the step output is preserved for back-compat but is always `[]` on success.

**Config file path — Astro v4 vs v5**: Astro v4 puts `config.ts` inside `contentRoot` (e.g. `src/content/config.ts`). Astro v5 puts it one level up as `src/content.config.ts`. `ExtractCollectionSchemasStep` tries both patterns plus repo-root fallbacks — no code change needed when switching Astro versions.

## Common Mistakes

- DO NOT commit when `articles.status !== "final_review"` — adapter throws
- DO NOT manually edit a generated `.mdx`. The auto-generated header is your warning sign
- DO NOT pass binary content as text. Always set `contentType: "base64"` for images
- DO NOT cache the Octokit instance across processes. Installation tokens expire after 1h
- DO NOT access `data.owner.login` directly on `GET /app` responses — `owner` is a
  `User | Organization` union and `Organization` has no `login`. Use `"login" in owner` narrowing
- DO NOT assume `data` from `GET /app` is non-null — Octokit types it as nullable; null-coalesce
- DO NOT skip the auto-generated header in mdxContent — it's the only signal Marcel has
  that the file was machine-written
- DO NOT use the regex schema parser as if it were authoritative. It's a heuristic.
  Always check `unpopulatedRequired` field in step output
- DO NOT use a non-greedy regex to extract the `z.object({...})` schema body — it stops
  at the first `})` inside any nested field (e.g. `z.object({})`). Use bracket counting instead
  (see `bracketBalanced()` in `resolve-schema.ts`)
- DO NOT check `z.string()` before `z.array(z.string())` in the field classifier — the array
  pattern also contains `z.string()`, so more-specific checks must come first
- DO NOT assign `outputSchema = SomeSchema` in a step class when the schema has `.default()`
  fields — Zod's `_input` variance (`string | undefined`) conflicts with `BaseStep`'s
  `ZodType<TOutput>` generic. Cast with `as z.ZodType<OutputType>` (same pattern as pipelines)
- DO NOT sync to an Astro repo that has no commits yet — an empty repo has no `main` branch,
  so every GitHub API path lookup returns 404. The adapter will fail at `resolve-schema` with
  "Could not find Astro content config". Bootstrap the repo first (create at least one commit
  with a `src/content/config.ts`). The bootstrap script pattern: blobs → tree → commit →
  `POST /git/refs` with no `parents` array.
- DO NOT access `.content` directly after narrowing `GET /repos/{owner}/{repo}/contents/{path}`
  with `!Array.isArray()` — the union type still includes symlink (which has no `.content`).
  Cast to `{ type: string; content?: string; size: number }` before reading the field.
- DO NOT add a new stage to `AstroSyncError` without checking whether it should be persisted to
  `astro_sync_runs.error_stage`. The DB column only accepts: `load | schema | image | render | commit | db_update | stale_read`.
  Stages `auth` and `config` are error categories for the load phase and intentionally excluded from
  the DB column (they indicate config problems, not pipeline-stage failures). See `afterError()` in
  `pipeline.ts` for the filter list.
- DO NOT use `z.string().optional().default("blog")` (or any `.default()`) on a field inside a
  nested `z.object({...})` in a step's `inputSchema` when the upstream step guarantees the value is
  always present — Zod `.default()` makes `_input` become `string | undefined` while `_output` stays
  `string`, and `BaseStep<TInput, TOutput>` requires `inputSchema: ZodType<TInput>`, producing TS2416.
  Fix: use `z.string()` (non-optional, no default) when the field is always provided by the upstream
  step (e.g. a NOT NULL DB column read by `LoadArticleStep`). If the field is truly optional, use
  `z.string().optional()` and handle `undefined` in `execute()`. See `render-mdx.ts`
  `collectionType` field (Spec 61.1) for the canonical pattern.
- DO NOT use `targetWhere` that only partially matches a partial index predicate in Drizzle's
  `onConflictDoUpdate` — PostgreSQL requires the `targetWhere` clause to match the index predicate
  EXACTLY (every condition). The `topic_briefs_unique_open_per_gap` index has TWO conditions:
  `WHERE "gap_id" IS NOT NULL AND "approval_status" IN (...)`. If `targetWhere` only has the
  `approval_status IN (...)` part, Postgres throws "there is no unique or exclusion constraint
  matching the ON CONFLICT specification" at runtime. Always reproduce the full index WHERE clause.

## `articles.astro_frontmatter` is a forensic copy (Spec Bucket-D / BD1)

`UpdateDbStatusStep` in `src/steps/update-db-status.ts` (part of the
generation-side `ArticleSyncPipeline`) writes the rendered Astro frontmatter
back into `articles.astro_frontmatter` after a successful commit. This is a
**forensic / debug** column — no production code reads it (only audit scripts
under `apps/api/src/scripts/discovery/`).

The import-side pipeline (`RepoImportPipeline.UpsertArticlesStep`) deliberately
does NOT populate this column, so every `source='imported'` row stays NULL
forever. That's by design. Toolwiki (100% imported) has 0/318 populated rows
as of 2026-05-24; generated-workflow tenants will populate it once they ship.

DO NOT extend `UpsertArticlesStep` to write `astro_frontmatter` — that's the
generation-pipeline's role, and conflating the two would muddy the forensic
signal. If you need to inspect what an imported article's source frontmatter
looked like, read it from the Astro repo (the importer is upsert-only and
non-destructive against the repo's MDX).

## `articles.schema_json_ld` is a Soft-Guarded Footgun (Spec Bucket-D / BD2)

`RenderMdxStep` reads `articles.schema_json_ld` (lines 266-267) and merges it
into the rendered MDX frontmatter under `schema:` / `schemaJsonLd:` keys.
Whether those keys actually land in the committed MDX depends on the project's
Astro Zod schema:

- If the collection's `astroCollectionSchemas` JSON has NO `schema` or
  `schemaJsonLd` field declaration → `collectionInfo.fields` filter at
  [render-mdx.ts:286](src/steps/render-mdx.ts:286) silently drops both keys
  from the output. Dormant. ✅
- If the schema DOES declare either field → the column value (potentially
  written by `SchemaExtensionPipeline` for any article including imported
  ones) is written into the committed MDX. Live footgun. ❌

**Today (verified 2026-05-24)**: No Toolwiki collection declares either
field, so the footgun is dormant. Verify before adding a `schema:` field
to a Toolwiki collection that contains imported articles — Branch-B's
design expects rich types to be rendered from individual frontmatter
fields (`howTo:`, `faqs:`), NOT from pre-baked JSON-LD.

**If activation conditions trigger** (a future schema declares `schema:`
or `schemaJsonLd:`, or `RenderMdxStep` field-filter logic changes), add
the Trigger-Filter as a follow-up spec — Option A from Spec Bucket-D
§3.2 is the canonical mitigation but was deferred because the dormant
state needs no immediate fix. See
`docs/specs/bucket-d-fixes/spec.md` §10 Q2 + the column doc-comment in
`packages/db/src/schema/content.ts` for the full discussion.

**Reachability** (for context — both routes are source-agnostic):
- `POST /api/articles/:id/extend-schema` → fires `SchemaExtensionPipeline`,
  populates `schema_json_ld` in DB
- `POST /api/articles/:id/sync` → fires `ArticleSyncPipeline.RenderMdxStep`,
  reads the column

## `articles.astro_frontmatter` is a forensic copy (Spec Bucket-D / BD1)

`MirrorHeroImagesStep` sits between `ParseFrontmatterBatchStep` and
`UpsertArticlesStep` in `RepoImportPipeline`. It mirrors hero source files
from the Astro repo to R2, deduped by source-byte SHA-256.

- **Source-byte resolution**: Astro frontmatter `heroImage` / `image` refs
  with a leading `/` are resolved against the Astro repo's `public/` directory,
  fetched via the GitHub-App `contents` + `git/blobs` API pinned to
  `headCommitSha` from `ListContentFilesStep`. Refs without a leading slash
  (relative `../assets/...`, remote URLs, data URIs) are reported as `failed`
  in V1 — extend `repoPathForHeroRef` if a future tenant uses `src/assets/...`.
- **R2 upload**: routed through `@marketing-auto/adapter-image-webp`
  (`convertImageToWebp`) — Pattern 119. WebP-shaped bytes upload as-is;
  PNG/JPG/GIF/AVIF inputs are converted via sharp + the pre-conversion
  original stored under `/originals/`.
- **Dedup**: in-run `Map<sha256, HeroFields>` makes DE+EN siblings pay one
  upload. Cross-run, a `WHERE project_id = $1 AND hero_image_source_sha256 = $2`
  lookup against the existing `articles_hero_image_source_sha256_idx` partial
  index reuses prior R2 keys.
- **Default-hero fallback**: when an article has no `heroImage`/`image`
  frontmatter, the step falls back to `public/heroes/auto/default.webp` — a
  cross-repo contract documented in root CLAUDE.md and the Astro repo's
  CLAUDE.md. Missing default-hero produces a one-line `warn` per affected
  article and the entry lands in `failed`.
- **Refresh-whitelist**: `UpsertArticlesStep` writes all five hero columns
  through `CASE WHEN heroImageSourceSha256 IS DISTINCT FROM <new hash> THEN <new>
  ELSE <existing> END`. Unchanged files leave the columns untouched —
  preserves UI-edited `hero_image_alt_text`. Changed files atomically flip
  every column.
- **Skipped collections**: `COLLECTIONS_WITHOUT_HERO` (currently
  `{"tool-categories"}`) short-circuits before fetch. Extend the constant
  when adding a future collection with no hero by design.

The pure per-article helper `mirrorOneArticle(deps, input)` is exported from
the step module so the backfill CLI (`apps/api/src/scripts/backfill-imported-heroes.ts`)
can drive it offline with the same dependency-injection seam used in the
unit tests.

## Bare-Slug Collision in noLocaleSplit Collections (Spec 006 / F1.5)

`UpsertArticlesStep` writes rows with unique key `(project_id, source,
collection, locale, slug)` — `slug` is the bare frontmatter `slug:` field
(or the file basename if absent). For collections that nest subdirectories
under the collection root (today only `categories/{blog,knowledge,tool}/`),
two files in different subdirectories that declare the same bare slug
silently merge into a single DB row via UPSERT — the later-processed file
wins, the earlier one is overwritten. **`scope` is NOT in the unique key.**

Live example in Toolwiki: `categories/blog/ethics-law.md` and
`categories/knowledge/ethics-law.md` both declare `slug: "ethics-law"`;
post-import DB has 30 rows for 31 physical files. Practical impact today is
zero (identical labels), but it's a latent footgun.

The `scope` field IS preserved in `domain_extras->>'scope'` (jsonb), so the
data isn't entirely lost — but any consumer that queries by `articles.slug`
sees a single deterministic-but-arbitrary row.

**To fix when it bites**: either widen the unique key to include
`domain_extras->>'scope'` (partial functional index), or have the importer
normalize `slug` to `<scope>/<slug>` for nested files. Either change touches
the `articles.slug` cardinality assumption used throughout the platform —
not a small refactor.

**Symptom for diagnosis**: Re-Import-Forecast (`bun --filter @marketing-auto/api
forecast-re-import-state <slug>`) reports `repo files: N · DB active: N-K`
for a `noLocaleSplit` collection where K = the number of bare-slug collisions.
[`apps/api/src/scripts/discovery/generate-repo-inventory.ts`](../../../apps/api/src/scripts/discovery/generate-repo-inventory.ts)
emits both the bare slug AND a per-slug `scopes` map to surface the collision
in raw inventory inspection — the diff dedupes via `new Set` so the forecast
matches cleanly despite the row-count gap.

## Pillar-Name Canonicalization (Spec 002 Follow-up)

`SyncClustersFromFrontmatterStep` derives `content_pillars` rows from distinct
`articles.category` values. Without normalization, any MDX with
`categorySlug: "Vergleiche"` would create a `Vergleiche` pillar next to the
canonical `comparisons` — exactly the drift Spec 002 Bucket-C cleaned up.

The module-level `PILLAR_NAME_CANONICALIZATION` map at the top of
[src/import/steps/sync-clusters-from-frontmatter.ts](src/import/steps/sync-clusters-from-frontmatter.ts)
rewrites known DE display-label forms to EN-canonical slugs BEFORE pillar
INSERT and BEFORE cluster pillarId assignment. The pure helper
`canonicalizePillarName(name)` is exported so unit tests can pin the
mapping table without spinning up the full step.

**Current mappings (DE display-label → EN canonical slug):**
- `Vergleiche` → `comparisons`
- `Ethik & Recht` → `ethics-law`
- `Grundlagen` → `fundamentals`
- `Zukunft` → `future`
- `Guides & Tutorials` → `guides-tutorials`
- `Technik` → `technology`
- `Tool-Reviews` → `tool-reviews` (case-only)
- `Praxis` → `practice`
- `Praxis & Use Cases` → `practice-use-cases`

The denormalized `clusters.pillar` text field also stores the canonical
form so the FK pillarId AND the text mirror stay in sync.

**Extending the map** when new MDX drift surfaces: append entries to
`PILLAR_NAME_CANONICALIZATION`, add a unit-test case in
[test/sync-clusters.test.ts](test/sync-clusters.test.ts)
`canonicalizePillarName` describe block, restart the worker. No DB
migration needed — the map is checked at every import run, so historical
rows with the legacy name still need the dedicated cleanup script
([cleanup-bucket-c-drift.ts](../../../apps/api/src/scripts/cleanup-bucket-c-drift.ts))
to flip + delete them on a per-tenant basis.

## Importer-Pattern: Status-aware match via partial unique index (Spec 005 IR1)

`UpsertArticlesStep`'s `onConflictDoUpdate` target is the partial unique index
`articles_project_source_coll_locale_slug_active_unique` (migration 0103) with
predicate `WHERE status != 'superseded'`. Superseded rows are tombstones — they
can coexist with active rows at the same `(project, source, collection, locale, slug)`
without tripping the constraint. When a new MDX file's parsed slug coincides with
an existing superseded row's slug, the importer INSERTs a fresh active row instead
of resurrecting the tombstone. The cleanup decision stays as audit-trail.

The `targetWhere: sql\`status != 'superseded'\`` clause on `onConflictDoUpdate`
mirrors the index predicate EXACTLY (Memory D108 — partial-index gotcha; PostgreSQL
rejects partial-index conflict resolution if `targetWhere` doesn't reproduce the
predicate).

`FilterChangedFilesStep` also filters out superseded rows from its `existingByPath`
index. Without this, a stale superseded row whose `filePath` happens to match an
incoming file would short-circuit the gitSha-equality check and skip the file on
every Re-Import, blocking self-healing.

Reasoning: cleanup specs can mark rows superseded to remove them from the active
set (e.g. orphan-detection after a Branch refactor). The importer must not
resurrect such rows. The file-in-repo wins over historical-cleanup decisions; the
superseded row stays as a tombstone for audit/forensic purposes. See
[`docs/discovery/ir1-upsert-articles-code-read.md`](../../../docs/discovery/ir1-upsert-articles-code-read.md)
for the full Code-Read + option analysis + Anomaly-A reconstruction.

## Importer-Pattern: Mirror-Backfill self-healing step (Spec 005 IR2)

`MirrorBackfillHeroesStep` runs immediately after `UpsertArticlesStep` in
`RepoImportPipeline`. On every Re-Import it loads `source='imported'` rows where
`hero_image_r2_key IS NULL` (excluding `COLLECTIONS_WITHOUT_HERO`) and re-mirrors
them through the same `mirrorOneArticle` helper used by `MirrorHeroImagesStep` +
the `backfill-imported-heroes` CLI.

Architecture: additive, NOT a refactor. `MirrorHeroImagesStep` keeps its existing
in-memory `parsed → mirror → upsert` flow (the fast path). The backfill step is
the durability safety net that catches:

- New INSERTs where the first-pass Mirror failed (404, R2 outage, GitHub transient)
- Historical heroless rows from any prior import that failed silently

Idempotent: if all rows have heroes, the SELECT returns 0 candidates and the step
is a no-op. Re-running the pipeline against the same DB state produces no R2
uploads + no DB writes.

The shared `heroRefreshWhitelistUpdateSet(hero: HeroFields)` helper (exported
from `mirror-backfill-heroes.ts`) is used by BOTH steps for the hash-equality
refresh whitelist (only flip hero columns if `heroImageSourceSha256` actually
changed). Centralised so the two write sites can't drift on preservation
semantics — UI-edited `heroImageAltText` survives unchanged-content Re-Imports.

The ad-hoc `backfill-imported-heroes` CLI is kept for dry-run audits and
project-scoped one-off backfills outside a full Re-Import. Same posture as Spec
64.10's `cleanup-orphan-heroes`.

See [`docs/discovery/ir2-mirror-step-ordering-code-read.md`](../../../docs/discovery/ir2-mirror-step-ordering-code-read.md)
for the Code-Read + option analysis + Anomaly-B reconstruction.

## Gap Detection (Spec 54.3)

`DetectContentGapsStep` counts ALL project articles regardless of `source` (imported, generated,
manual). The `eq(articles.source, "imported")` filter was removed in Spec 54.3 (Tech Debt #1).
Generated and imported articles now equally count toward:
- Cluster size (`cluster_too_small` threshold of 3)
- Intent coverage (`missing_spoke_type` check)
- Translation pairing (`missing_translation` check)
- Hub presence (`missing_hub` check)

## Performance / Cost

Per article sync (KI-Wissensraum profile):
- ~5-6 GitHub API calls (1 ref read, 1 commit read, 2 blobs, 1 tree, 1 commit, 1 ref update)
- ~500KB binary upload (hero image)
- Time: ~10-30 seconds per article
- Cost: €0 (GitHub API is free; R2 download is free for us as customer)
