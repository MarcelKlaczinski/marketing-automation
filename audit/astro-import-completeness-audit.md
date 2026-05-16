# Astro→DB Import Completeness Audit

**Date:** 2026-05-16
**Phase:** Pre-Spec-54.8
**Scope:** Marketing-Automation Platform repo only (Toolwiki MDX covered by `audit/toolwiki-content-audit.md`)
**Status:** Read-only inspection — no code changes, no DB writes

---

## Section 1: Import Mechanism

**Code location:**
- Pipeline entry: `packages/adapters/astro-sync/src/import/pipeline.ts` (`RepoImportPipeline`)
- Parse logic: `packages/adapters/astro-sync/src/import/parse-frontmatter.ts` (`parseMdxContent`)
- DB upsert: `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts` (`UpsertArticlesStep`)
- Batch fetch: `packages/adapters/astro-sync/src/import/steps/parse-frontmatter-batch.ts`
- Trigger: `packages/adapters/astro-sync/src/import/trigger.ts` (`enqueueRepoImport`)

**Trigger:** Manual API call + GitHub webhook. Function `enqueueRepoImport({ projectId, triggerSource, forceAll? })` creates an `astro_import_runs` row and enqueues a BullMQ job. Supported `triggerSource` values: `"manual"`, `"webhook"`, `"scheduled"`.

**Parse mechanism:** `gray-matter` parses MDX YAML frontmatter into a raw JS object. A Zod schema (`FrontmatterSchema`) with `.passthrough()` extracts typed fields. The passthrough captures any remaining frontmatter fields into a separate `extras` object.

**Field mapping strategy:**
- **Typed columns**: 13 frontmatter fields are parsed into dedicated DB columns: `title`, `description→metaDescription`, `slug`, `locale`, `translationKey`, `publishedAt`, `updatedAt→frontmatterUpdatedAt`, `author`, `category`, `subcategory`, `tags`, `noindex`, `clusterKey`, `clusterRole`, `intentType`.
- **JSONB catch-all (`frontmatter_extras`)**: Every frontmatter field NOT in the 13 typed fields goes into `p.extras`, which is stored in `articles.frontmatterExtras`. This includes all collection-specific fields (rating, pricing, pros, cons, faq, heroImage, seoTitle, etc.).
- **Body metadata (`import_metadata`)**: Computed from the article body — wordCount, readingTimeMinutes, headings array, hasAffiliateLinks, imageCount, internalLinks. Stored in `articles.importMetadata`.
- **Collection detection**: `extractCollection(filePath, contentRoot)` splits the path and takes the first path segment after `contentRoot` (e.g. `src/content/tools/de/foo.mdx` → `tools`).
- **Status**: All imported articles get `status = "published"` regardless of content.

**Pipeline step sequence:**
1. `ExtractCollectionSchemasStep` — reads `src/content.config.ts` (or `src/content/config.ts`) from GitHub; persists field descriptors to `projects.astroCollectionSchemas`
2. `ListContentFilesStep` — fetches file tree from GitHub API
3. `FilterChangedFilesStep` — compares git SHAs against DB; returns only changed/new files (unless `forceAll=true`)
4. `ParseFrontmatterBatchStep` — fetches blob content in batches of 10, calls `parseMdxContent`
5. `UpsertArticlesStep` — INSERT … ON CONFLICT DO UPDATE using `(projectId, source, collection, locale, slug)` unique index
6. `LinkTranslationPairsStep` — links DE/EN article pairs by `translationKey`
7. `SyncClustersFromFrontmatterStep` — auto-populates clusters from `clusterKey` frontmatter
8. `DetectContentGapsStep` — zero-cost gap detection after each import
9. `UpdateImportRunStep` — marks the import run complete with stats

**Code excerpt — core mapping in `UpsertArticlesStep.execute()`:**
```typescript
await db.insert(articles).values({
  projectId: input.projectId,
  source: "imported",
  collection,                   // derived from file path, not frontmatter
  locale,                       // typed.locale ?? path-extracted locale
  slug,                         // typed.slug ?? filename-based slug
  cornerstoneKeyword: null,     // ALWAYS null for imported articles
  title: (typed.title as string | null) ?? null,
  metaDescription: (typed.description as string | null) ?? null,
  translationKey: (typed.translationKey as string | null) ?? null,
  filePath: p.filePath as string,
  gitSha: p.gitSha as string,
  publishedAt: (typed.publishedAt as Date | null) ?? null,
  frontmatterUpdatedAt: (typed.updatedAt as Date | null) ?? null,
  author: (typed.author as string | null) ?? null,
  category: (typed.category as string | null) ?? null,
  subcategory: (typed.subcategory as string | null) ?? null,
  tags: (typed.tags as string[] | null) ?? [],
  noindex: (typed.noindex as boolean | null) ?? false,
  clusterKey: (typed.clusterKey as string | null) ?? null,
  clusterRole: (typed.clusterRole as "hub" | "spoke" | null) ?? null,
  intentType: (typed.intentType as string | null) ?? null,
  bodyMd: p.body as string,
  frontmatterExtras: p.extras as Record<string, unknown>,  // all remaining fields
  importMetadata: p.metadata as Record<string, unknown>,
  importedAt: now,
  lastImportedAt: now,
  status: "published",
})
```

**Key observations:**
- The `TYPED_FIELDS` set in `parse-frontmatter.ts` has exactly 13 members; everything else falls into `extras`. This is the primary design choice that shapes all gaps below.
- `cornerstoneKeyword` is hardcoded to `null` for all imported articles — it is never sourced from the tools collection's `clusterKey` or blog's SEO keyword fields.
- `description` maps to `metaDescription` (the DB column), not to a separate `description` column. The `articles` table has no standalone `description` column.
- `updatedAt` (frontmatter field) maps to `frontmatterUpdatedAt` (DB column). `publishedAt` maps to `publishedAt` but is only present in blog-style collections that actually set it — the tools `updatedAt` is correctly mapped.
- Collection detection is path-based, not frontmatter-based. This is robust but means a file moved to the wrong directory would be mis-classified.
- `slug` falls back to the filename (without `.mdx`) when not set in frontmatter. All collections examined have explicit `slug` fields in frontmatter or use the filename convention correctly.

---

## Section 2.1: Collection — `blog`

**Expected MDX files:** 60 (30 DE + 30 EN)
**Imported in DB:** 60 (30 DE + 30 EN)
**Coverage:** 100% — all files imported

**Field coverage table:**

| Frontmatter field | Frequency in MDX | Imported? | DB target | Locale-preserved? | Notes |
|---|---|---|---|---|---|
| `title` | 60/60 | ✅ | `articles.title` | ✅ | Dedicated column |
| `date` | 60/60 | ⚠️ partial | `frontmatter_extras.date` | ✅ | Not mapped to `publishedAt`; goes to extras |
| `updated` | 56/60 | ⚠️ partial | `frontmatter_extras.updated` | ✅ | Different field name from `updatedAt`; not picked up by typed mapper which expects `updatedAt` |
| `updatedReason` | 56/60 | ⚠️ partial | `frontmatter_extras.updatedReason` | ✅ | Extras only |
| `excerpt` | 60/60 | ⚠️ partial | `frontmatter_extras.excerpt` | ✅ | Extras only; DB has `metaDescription` from `description` field |
| `category` | 60/60 | ✅ | `articles.category` | ✅ | Dedicated column |
| `tags` | 60/60 | ✅ | `articles.tags` | ✅ | Dedicated column (text[]) |
| `author` | 60/60 | ✅ | `articles.author` | ✅ | Dedicated column |
| `locale` | 60/60 | ✅ | `articles.locale` | ✅ | Dedicated column |
| `translationKey` | 56/60 | ✅ | `articles.translationKey` | ✅ | 4 JSON-style files DO have keys — all 60 rows have translationKey set in DB |
| `slug` | 60/60 | ✅ | `articles.slug` | ✅ | Via typed.slug or filename |
| `heroImage` | 60/60 | ⚠️ partial | `frontmatter_extras.heroImage` | ✅ | Extras only; no `heroImagePublicUrl` set |
| `heroImageAlt` | 60/60 | ⚠️ partial | `frontmatter_extras.heroImageAlt` | ✅ | Extras only |
| `seoTitle` | 60/60 | ⚠️ partial | `frontmatter_extras.seoTitle` | ✅ | Extras only |
| `seoDescription` | 60/60 | ⚠️ partial | `frontmatter_extras.seoDescription` | ✅ | Extras only |
| `featured` | 60/60 | ⚠️ partial | `frontmatter_extras.featured` | ✅ | Extras only |
| `intentType` | 56/60 | ✅ | `articles.intent_type` | ✅ | Dedicated column; 60/60 rows have value (4 missing in MDX get `null`) |
| `clusterKey` | 60/60 | ✅ | `articles.cluster_key` | ✅ | Dedicated column |
| `clusterRole` | 60/60 | ✅ | `articles.cluster_role` | ✅ | Dedicated column |
| `clusterOrder` | 50/60 | ⚠️ partial | `frontmatter_extras.clusterOrder` | ✅ | Extras only |
| `parentSlug` | 40/60 | ⚠️ partial | `frontmatter_extras.parentSlug` | ✅ | Extras only |
| `primaryTool` | 48/60 | ⚠️ partial | `frontmatter_extras.primaryTool` | ✅ | Extras only; 49/60 rows have this in extras |
| `speakable` | 60/60 | ⚠️ partial | `frontmatter_extras.speakable` | ✅ | Extras only |
| `readingTime` | 60/60 | ⚠️ partial | `frontmatter_extras.readingTime` | ✅ | Extras only |
| `faq` | 60/60 | ⚠️ partial | `frontmatter_extras.faq` | ✅ | Extras only (array of {question,answer}) |
| `showTopicLinks` | 60/60 | ⚠️ partial | `frontmatter_extras.showTopicLinks` | ✅ | Extras only; 56/60 rows have it |
| `bottomLinksVariant` | 60/60 | ⚠️ partial | `frontmatter_extras.bottomLinksVariant` | ✅ | Extras only |
| `toolSlugs` | 8/60 | ⚠️ partial | `frontmatter_extras.toolSlugs` | ✅ | Extras only; 9/60 rows in DB |
| `winner` | 6/60 | ⚠️ partial | `frontmatter_extras.winner` | ✅ | Extras only |
| `verdict` | 6/60 | ⚠️ partial | `frontmatter_extras.verdict` | ✅ | Extras only |
| `useCaseVerdicts` | 6/60 | ⚠️ partial | `frontmatter_extras.useCaseVerdicts` | ✅ | Extras only |
| `testMethodology` | 6/60 | ⚠️ partial | `frontmatter_extras.testMethodology` | ✅ | Extras only |
| `comparedAt` | 6/60 | ⚠️ partial | `frontmatter_extras.comparedAt` | ✅ | Extras only |
| `ads` | 4/60 | ⚠️ partial | `frontmatter_extras.ads` | ✅ | Extras only |
| `noindex` | 0/60 (default false) | ✅ | `articles.noindex` | ✅ | Default correctly applied |
| `cornerstoneKeyword`* | 4/60 (JSON-style only) | ⚠️ partial | `frontmatter_extras.cornerstoneKeyword` | ✅ | Non-schema field; preserved in extras |
| `wordCount`* | 4/60 (JSON-style only) | ⚠️ partial | `frontmatter_extras.wordCount` | ✅ | Non-schema field; preserved in extras |
| `draft`* | 4/60 (JSON-style only) | ⚠️ partial | `frontmatter_extras.draft` | ✅ | Non-schema field; preserved in extras |
| `schemaJsonLd`* | 3/60 (JSON-style only) | ⚠️ partial | `frontmatter_extras.schemaJsonLd` | ✅ | Non-schema field; in extras (3/4 files — en/ai-code-assistants.mdx does NOT have it) |

*Non-schema fields found only in the 4 JSON-style anomalous blog files.

**Critical note — `date` vs `publishedAt`:** Blog uses `date` for the publish date, but the typed mapper only looks for `publishedAt`. The `date` field goes to `frontmatter_extras.date` (string) rather than `articles.publishedAt` (timestamp). DB rows have `publishedAt = null` for all blog articles. This is a **silent gap** — queries filtering by `publishedAt` will not find blog articles.

**Critical note — `updated` vs `updatedAt`:** Blog uses the field name `updated` for its update timestamp; the `tools`, `comparisons`, `ki-wissen`, and `usecases` collections use `updatedAt`. The typed mapper maps `updatedAt` → `frontmatterUpdatedAt`. Blog's `updated` field goes to `frontmatter_extras.updated`. Result: `articles.frontmatterUpdatedAt` is `null` for all blog rows.

---

## Section 2.2: Collection — `tools`

**Expected MDX files:** 108 (54 DE + 54 EN)
**Imported in DB:** 108 (54 DE + 54 EN)
**Coverage:** 100% — all files imported

**Field coverage table:**

| Frontmatter field | Frequency in MDX | Imported? | DB target | Locale-preserved? | Notes |
|---|---|---|---|---|---|
| `title` | 108/108 | ✅ | `articles.title` | ✅ | Dedicated column |
| `description` | 108/108 | ✅ | `articles.meta_description` | ✅ | Dedicated column (renamed) |
| `category` | 108/108 | ✅ | `articles.category` | ✅ | Dedicated column |
| `subcategory` | 108/108 | ✅ | `articles.subcategory` | ✅ | Dedicated column |
| `locale` | 108/108 | ✅ | `articles.locale` | ✅ | Dedicated column |
| `translationKey` | 108/108 | ✅ | `articles.translation_key` | ✅ | Dedicated column |
| `clusterKey` | 108/108 | ✅ | `articles.cluster_key` | ✅ | Dedicated column |
| `clusterRole` | 108/108 | ✅ | `articles.cluster_role` | ✅ | Dedicated column |
| `tags` | 108/108 | ✅ | `articles.tags` | ✅ | Dedicated column (text[]) |
| `author` | 108/108 | ✅ | `articles.author` | ✅ | Dedicated column; value is `"toolwiki"` string |
| `updatedAt` | 108/108 | ✅ | `articles.frontmatter_updated_at` | ✅ | Dedicated column |
| `noindex` | 0/108 (default false) | ✅ | `articles.noindex` | ✅ | Default correctly applied |
| `intentType` | 0/108 (not set in tools) | ❌ | `articles.intent_type` is `null` | — | Tools collection does not set intentType; all 108 rows have `null` |
| `pricing` | 108/108 | ⚠️ partial | `frontmatter_extras.pricing` | ✅ | Extras only — 108/108 rows have it |
| `priceFrom` | 106/108 | ⚠️ partial | `frontmatter_extras.priceFrom` | ✅ | Extras only — 106/108 rows have it |
| `rating` | 108/108 | ⚠️ partial | `frontmatter_extras.rating` | ✅ | Extras only — 108/108 rows |
| `votes` | 108/108 | ⚠️ partial | `frontmatter_extras.votes` | ✅ | Extras only — 108/108 rows |
| `website` | 108/108 | ⚠️ partial | `frontmatter_extras.website` | ✅ | Extras only — 108/108 rows |
| `image` | 108/108 | ⚠️ partial | `frontmatter_extras.image` | ✅ | Extras only — tool logo `.webp` path |
| `heroImage` | 36/108 (EN only) | ⚠️ partial | `frontmatter_extras.heroImage` | ✅ | Extras only — 36/108 rows (0 DE, 36 EN) |
| `heroImageAlt` | 36/108 (EN only) | ⚠️ partial | `frontmatter_extras.heroImageAlt` | ✅ | Extras only — 36/108 rows |
| `features` | 108/108 | ⚠️ partial | `frontmatter_extras.features` | ✅ | Extras only — string array |
| `pros` | 108/108 | ⚠️ partial | `frontmatter_extras.pros` | ✅ | Extras only — string array |
| `cons` | 108/108 | ⚠️ partial | `frontmatter_extras.cons` | ✅ | Extras only — string array |
| `useCases` | 108/108 | ⚠️ partial | `frontmatter_extras.useCases` | ✅ | Extras only — string array |
| `integrations` | 108/108 | ⚠️ partial | `frontmatter_extras.integrations` | ✅ | Extras only — string array |
| `faq` | 108/108 | ⚠️ partial | `frontmatter_extras.faq` | ✅ | Extras only — array of {question,answer} |
| `seoTitle` | 108/108 | ⚠️ partial | `frontmatter_extras.seoTitle` | ✅ | Extras only — 108/108 rows |
| `seoDescription` | 108/108 | ⚠️ partial | `frontmatter_extras.seoDescription` | ✅ | Extras only — 108/108 rows |
| `affiliateSlug` | 106/108 | ⚠️ partial | `frontmatter_extras.affiliateSlug` | ✅ | Extras only — 106/108 rows (tome missing) |
| `relatedPillars` | 108/108 | ⚠️ partial | `frontmatter_extras.relatedPillars` | ✅ | Extras only — string array |
| `parentSlug` | 80/108 | ⚠️ partial | `frontmatter_extras.parentSlug` | ✅ | Extras only — 80/108 rows |
| `speakable` | 8/108 | ⚠️ partial | `frontmatter_extras.speakable` | ✅ | Extras only — exactly 8/108 rows (chatgpt, claude, deepl, gemini × 2 locales) |
| `source` | 108/108 | ⚠️ partial | `frontmatter_extras.source` | ✅ | Extras only — value `"manual"` or `manual`; NOT the DB `articles.source` enum |

**Important type-coercion note:** The tools `pricing` field has mixed quoted/unquoted YAML — both `"freemium"` and `freemium` in MDX. After gray-matter parsing, both resolve to the string `"freemium"`. The inconsistency is normalized by the YAML parser transparently. Same applies to `source` field.

**Critical note — `intentType` is `null` for all tools:** The tools collection does not set `intentType` in any of the 108 files. After import, `articles.intent_type = null` for all tool rows. This means the `frontmatterExtras`-based query in `DraftStep`'s tool spotlight eligibility check (`intentType in ['overview','features','review','pricing','use-cases']`) will never match imported tool articles directly. It matches generated articles where the pipeline sets intentType.

---

## Section 2.3: Collection — `comparisons`

**Expected MDX files:** 22 (11 DE + 11 EN)
**Imported in DB:** 22 (11 DE + 11 EN)
**Coverage:** 100%

**Field coverage table:**

| Frontmatter field | Frequency in MDX | Imported? | DB target | Locale-preserved? | Notes |
|---|---|---|---|---|---|
| `title` | 22/22 | ✅ | `articles.title` | ✅ | Dedicated column |
| `description` | 22/22 | ✅ | `articles.meta_description` | ✅ | Dedicated column |
| `locale` | 22/22 | ✅ | `articles.locale` | ✅ | Dedicated column |
| `translationKey` | 22/22 | ✅ | `articles.translation_key` | ✅ | Dedicated column |
| `clusterKey` | 22/22 | ✅ | `articles.cluster_key` | ✅ | Dedicated column |
| `clusterRole` | 22/22 | ✅ | `articles.cluster_role` | ✅ | All `"hub"` |
| `author` | 22/22 | ✅ | `articles.author` | ✅ | Dedicated column; slug format |
| `updatedAt` | 22/22 | ✅ | `articles.frontmatter_updated_at` | ✅ | Dedicated column |
| `noindex` | 0/22 (default false) | ✅ | `articles.noindex` | ✅ | Default applied |
| `toolSlugs` | 22/22 | ⚠️ partial | `frontmatter_extras.toolSlugs` | ✅ | Extras only — 22/22 rows |
| `winner` | 22/22 | ⚠️ partial | `frontmatter_extras.winner` | ✅ | Extras only — 22/22 rows |
| `verdict` | 22/22 | ⚠️ partial | `frontmatter_extras.verdict` | ✅ | Extras only — 22/22 rows |
| `useCaseVerdicts` | 22/22 | ⚠️ partial | `frontmatter_extras.useCaseVerdicts` | ✅ | Extras only — 22/22 rows |
| `testMethodology` | 22/22 | ⚠️ partial | `frontmatter_extras.testMethodology` | ✅ | Extras only — 22/22 rows |
| `comparedAt` | 22/22 | ⚠️ partial | `frontmatter_extras.comparedAt` | ✅ | Extras only — 22/22 rows |
| `heroImage` | 22/22 | ⚠️ partial | `frontmatter_extras.heroImage` | ✅ | Extras only — 22/22 rows |
| `heroImageAlt` | 22/22 | ⚠️ partial | `frontmatter_extras.heroImageAlt` | ✅ | Extras only — 22/22 rows |
| `seoTitle` | 22/22 | ⚠️ partial | `frontmatter_extras.seoTitle` | ✅ | Extras only — 22/22 rows |
| `seoDescription` | 22/22 | ⚠️ partial | `frontmatter_extras.seoDescription` | ✅ | Extras only — 22/22 rows |
| `faq` | 22/22 | ⚠️ partial | `frontmatter_extras.faq` | ✅ | Extras only — 22/22 rows |
| `parentSlug` | 6/22 | ⚠️ partial | `frontmatter_extras.parentSlug` | ✅ | Extras only — 6/22 rows |

**Cluster linkage:** All 22 comparison rows have `cluster_id` set (linked to DB clusters via `SyncClustersFromFrontmatterStep`).

---

## Section 2.4: Collection — `ki-wissen`

**Expected MDX files:** 24 (12 DE + 12 EN)
**Imported in DB:** 24 (12 DE + 12 EN)
**Coverage:** 100%

**Field coverage table:**

| Frontmatter field | Frequency in MDX | Imported? | DB target | Locale-preserved? | Notes |
|---|---|---|---|---|---|
| `title` | 24/24 | ✅ | `articles.title` | ✅ | Dedicated column |
| `description` | 24/24 | ✅ | `articles.meta_description` | ✅ | Dedicated column |
| `category` | 24/24 | ✅ | `articles.category` | ✅ | Dedicated column |
| `tags` | 24/24 | ✅ | `articles.tags` | ✅ | Dedicated column |
| `locale` | 24/24 | ✅ | `articles.locale` | ✅ | Dedicated column |
| `translationKey` | 24/24 | ✅ | `articles.translation_key` | ✅ | Dedicated column |
| `clusterKey` | 24/24 | ✅ | `articles.cluster_key` | ✅ | Dedicated column |
| `clusterRole` | 24/24 | ✅ | `articles.cluster_role` | ✅ | All `"hub"` |
| `author` | 24/24 | ✅ | `articles.author` | ✅ | String `"toolwiki – Redaktion"` |
| `updatedAt` | 24/24 | ✅ | `articles.frontmatter_updated_at` | ✅ | Dedicated column |
| `noindex` | 0/24 (default false) | ✅ | `articles.noindex` | ✅ | Default applied |
| `level` | 24/24 | ⚠️ partial | `frontmatter_extras.level` | ✅ | Extras only — 24/24 rows |
| `icon` | 24/24 | ⚠️ partial | `frontmatter_extras.icon` | ✅ | Extras only — 24/24 rows |
| `color` | 24/24 | ⚠️ partial | `frontmatter_extras.color` | ✅ | Extras only — 24/24 rows |
| `facts` | 24/24 | ⚠️ partial | `frontmatter_extras.facts` | ✅ | Extras only — 24/24 rows |
| `next` | 24/24 | ⚠️ partial | `frontmatter_extras.next` | ✅ | Extras only — 24/24 rows |
| `heroImage` | 22/24 | ⚠️ partial | `frontmatter_extras.heroImage` | ✅ | Extras only — 22/24 rows |
| `heroImageAlt` | 22/24 | ⚠️ partial | `frontmatter_extras.heroImageAlt` | ✅ | Extras only — 22/24 rows |
| `seoTitle` | 24/24 | ⚠️ partial | `frontmatter_extras.seoTitle` | ✅ | Extras only — 24/24 rows |
| `seoDescription` | 24/24 | ⚠️ partial | `frontmatter_extras.seoDescription` | ✅ | Extras only — 24/24 rows |
| `faq` | 24/24 | ⚠️ partial | `frontmatter_extras.faq` | ✅ | Extras only — 24/24 rows |

**Cluster linkage:** All 24 ki-wissen rows have `cluster_id` set.

---

## Section 2.5: Collection — `usecases`

**Expected MDX files:** 24 (12 DE + 12 EN)
**Imported in DB:** 24 (12 DE + 12 EN)
**Coverage:** 100%

**Field coverage table:**

| Frontmatter field | Frequency in MDX | Imported? | DB target | Locale-preserved? | Notes |
|---|---|---|---|---|---|
| `title` | 24/24 | ✅ | `articles.title` | ✅ | Dedicated column |
| `description` | 24/24 | ✅ | `articles.meta_description` | ✅ | Dedicated column |
| `locale` | 24/24 | ✅ | `articles.locale` | ✅ | Dedicated column |
| `translationKey` | 24/24 | ✅ | `articles.translation_key` | ✅ | Dedicated column |
| `author` | 24/24 | ✅ | `articles.author` | ✅ | String `"toolwiki"` |
| `tags` | 22/24 | ✅ | `articles.tags` | ✅ | Dedicated column |
| `updatedAt` | 24/24 | ✅ | `articles.frontmatter_updated_at` | ✅ | Dedicated column |
| `noindex` | 0/24 (default false) | ✅ | `articles.noindex` | ✅ | Default applied |
| `clusterKey` | 0/24 (none set) | ❌ | `articles.cluster_key = null` | — | MDX files do not set clusterKey; DB has null |
| `clusterRole` | 0/24 (none set) | ❌ | `articles.cluster_role = null` | — | MDX files do not set clusterRole; DB has null |
| `cluster_id` | — | ❌ | `articles.cluster_id = null` | — | No cluster FK linkage for usecases |
| `icon` | 24/24 | ⚠️ partial | `frontmatter_extras.icon` | ✅ | Extras only — 24/24 rows |
| `heroImage` | 24/24 | ⚠️ partial | `frontmatter_extras.heroImage` | ✅ | Extras only — 24/24 rows |
| `heroImageAlt` | 24/24 | ⚠️ partial | `frontmatter_extras.heroImageAlt` | ✅ | Extras only — 24/24 rows |
| `contentType` | 24/24 | ⚠️ partial | `frontmatter_extras.contentType` | ✅ | Extras only — 24/24 rows |
| `relatedTags` | 24/24 | ⚠️ partial | `frontmatter_extras.relatedTags` | ✅ | Extras only — 24/24 rows |
| `relatedPillarSlugs` | 24/24 | ⚠️ partial | `frontmatter_extras.relatedPillarSlugs` | ✅ | Extras only — 24/24 rows |
| `relatedComparisonSlugs` | 24/24 | ⚠️ partial | `frontmatter_extras.relatedComparisonSlugs` | ✅ | Extras only — 24/24 rows |
| `featuredToolSlugs` | 24/24 | ⚠️ partial | `frontmatter_extras.featuredToolSlugs` | ✅ | Extras only — 24/24 rows |
| `faq` | 24/24 | ⚠️ partial | `frontmatter_extras.faq` | ✅ | Extras only — 24/24 rows |
| `estimatedReadTime` | 24/24 | ⚠️ partial | `frontmatter_extras.estimatedReadTime` | ✅ | Extras only — 24/24 rows |
| `industryFocus` | 18/24 | ⚠️ partial | `frontmatter_extras.industryFocus` | ✅ | Extras only — 18/24 rows (6 files missing it in MDX) |

---

## Section 2.6: Collection — `authors`

**Expected MDX files:** 10 (5 DE + 5 EN)
**Imported in DB:** 10 (5 DE + 5 EN)
**Coverage:** 100% — authors ARE imported

**Field coverage table:**

| Frontmatter field | Frequency in MDX | Imported? | DB target | Locale-preserved? | Notes |
|---|---|---|---|---|---|
| `name` | 10/10 | ❌ | — | — | `name` is not in TYPED_FIELDS; not mapped to `articles.title`; `title = null` for all author rows |
| `description` | 10/10 | ✅ | `articles.meta_description` | ✅ | Description text saved correctly |
| `locale` | 10/10 | ✅ | `articles.locale` | ✅ | Dedicated column |
| `translationKey` | 10/10 | ✅ | `articles.translation_key` | ✅ | Dedicated column |
| `jobTitle` | 10/10 | ⚠️ partial | `frontmatter_extras.jobTitle` | ✅ | Extras only — 10/10 rows |
| `expertise` | 10/10 | ⚠️ partial | `frontmatter_extras.expertise` | ✅ | Extras only — 10/10 rows |
| `initials` | 10/10 | ⚠️ partial | `frontmatter_extras.initials` | ✅ | Extras only — 10/10 rows |
| `avatarGradient` | 10/10 | ⚠️ partial | `frontmatter_extras.avatarGradient` | ✅ | Extras only — 10/10 rows |
| `image` | 10/10 | ⚠️ partial | `frontmatter_extras.image` | ✅ | Extras only — 10/10 rows |
| `sameAs` | 10/10 | ⚠️ partial | `frontmatter_extras.sameAs` | ✅ | Extras only — 10/10 rows; all `[]` empty arrays |
| `location` | 10/10 | ⚠️ partial | `frontmatter_extras.location` | ✅ | Extras only — 10/10 rows |
| `yearsExperience` | 10/10 | ⚠️ partial | `frontmatter_extras.yearsExperience` | ✅ | Extras only — 10/10 rows |
| `email` | 0/10 (not set in MDX) | ❌ | — | — | Schema field; not present in any MDX file; absent from extras |
| `author` | 0/10 (not an author field) | ❌ | `articles.author = null` | — | Authors don't have an `author` field; DB column null |
| `category` | 0/10 (not set) | ❌ | `articles.category = null` | — | Authors don't have category; DB column null |
| `tags` | 0/10 (not set) | — | `articles.tags = []` | — | Empty array default applied |

**Critical gap:** The `name` field in authors is the person's full name (e.g. `"Anna Weidner"`) — analogous to `title` in other collections. However, `name` is NOT in the `TYPED_FIELDS` set, so it goes to `frontmatter_extras.name` instead of `articles.title`. All 10 author rows have `articles.title = null`. Any UI query of `articles.title` for author rows will return null.

**Author completeness verdict:** Authors are imported and all fields survive in `frontmatter_extras`. The collection is queryable by `slug` (which is the author slug like `anna-weidner`), `locale`, `translationKey`, and `meta_description`. However, `title` is unusable for authors, and resolution of "get author by slug" requires reading from `frontmatter_extras.name`.

---

## Section 2.7: Collection — `tool-categories`

**Expected MDX files:** 14 (7 DE + 7 EN)
**Imported in DB:** 14 (7 DE + 7 EN)
**Coverage:** 100%

**Field coverage table:**

| Frontmatter field | Frequency in MDX | Imported? | DB target | Locale-preserved? | Notes |
|---|---|---|---|---|---|
| `title` | 14/14 | ✅ | `articles.title` | ✅ | Dedicated column |
| `description` | 14/14 | ✅ | `articles.meta_description` | ✅ | Dedicated column |
| `locale` | 14/14 | ✅ | `articles.locale` | ✅ | Dedicated column |
| `translationKey` | 14/14 | ✅ | `articles.translation_key` | ✅ | Dedicated column |
| `author` | 14/14 | ✅ | `articles.author` | ✅ | Mixed strings: `"toolwiki – Redaktion"`, `"toolwiki Editorial"` |
| `updatedAt` | 14/14 | ✅ | `articles.frontmatter_updated_at` | ✅ | Dedicated column — verified: `2026-04-25 02:00:00+02` |
| `noindex` | 0/14 (default false) | ✅ | `articles.noindex` | ✅ | Default applied |
| `seoTitle` | 14/14 | ⚠️ partial | `frontmatter_extras.seoTitle` | ✅ | Extras only — 14/14 rows |
| `seoDescription` | 14/14 | ⚠️ partial | `frontmatter_extras.seoDescription` | ✅ | Extras only — 14/14 rows |
| `categorySlug` | 14/14 | ⚠️ partial | `frontmatter_extras.categorySlug` | ✅ | Extras only — 14/14 rows |
| `faq` | 14/14 | ⚠️ partial | `frontmatter_extras.faq` | ✅ | Extras only — 14/14 rows |

**Cluster linkage:** Zero — `tool-categories` have no `clusterKey` or `clusterRole` fields in MDX. `cluster_id = null`, `cluster_key = null` for all 14 rows. This is expected.

---

## Section 2.8: Collection — `special-landings`

**Expected MDX files:** 10 (5 DE + 5 EN)
**Imported in DB:** 10 (5 DE + 5 EN)
**Coverage:** 100%

**Field coverage table:**

| Frontmatter field | Frequency in MDX | Imported? | DB target | Locale-preserved? | Notes |
|---|---|---|---|---|---|
| `title` | 10/10 | ✅ | `articles.title` | ✅ | Dedicated column |
| `description` | 10/10 | ✅ | `articles.meta_description` | ✅ | Dedicated column |
| `locale` | 10/10 | ✅ | `articles.locale` | ✅ | Dedicated column |
| `translationKey` | 10/10 | ✅ | `articles.translation_key` | ✅ | Dedicated column |
| `updatedAt` | 10/10 | ✅ | `articles.frontmatter_updated_at` | ✅ | Dedicated column |
| `noindex` | 0/10 (default false) | ✅ | `articles.noindex` | ✅ | Default applied |
| `h1` | 10/10 | ⚠️ partial | `frontmatter_extras.h1` | ✅ | Extras only — 10/10 rows |
| `seoTitle` | 10/10 | ⚠️ partial | `frontmatter_extras.seoTitle` | ✅ | Extras only — 10/10 rows |
| `seoDescription` | 10/10 | ⚠️ partial | `frontmatter_extras.seoDescription` | ✅ | Extras only — 10/10 rows |
| `toolSlug` | 10/10 | ⚠️ partial | `frontmatter_extras.toolSlug` | ✅ | Extras only — 10/10 rows; verified values look correct |
| `alternativeToolSlugs` | 10/10 | ⚠️ partial | `frontmatter_extras.alternativeToolSlugs` | ✅ | Extras only — 10/10 rows; broken `"dall-e"` ref preserved verbatim |
| `heroImage` | 10/10 | ⚠️ partial | `frontmatter_extras.heroImage` | ✅ | Extras only — 10/10 rows |
| `heroImageAlt` | 10/10 | ⚠️ partial | `frontmatter_extras.heroImageAlt` | ✅ | Extras only — 10/10 rows |
| `canonicalPath` | 10/10 | ⚠️ partial | `frontmatter_extras.canonicalPath` | ✅ | Extras only — 10/10 rows; e.g. `"/de/chatgpt/"` |
| `applicationCategory` | 10/10 | ⚠️ partial | `frontmatter_extras.applicationCategory` | ✅ | Extras only — 10/10 rows |
| `offerPrice` | 10/10 | ⚠️ partial | `frontmatter_extras.offerPrice` | ✅ | Extras only — 10/10 rows; integer (e.g. `20`) |
| `offerCurrency` | 10/10 | ⚠️ partial | `frontmatter_extras.offerCurrency` | ✅ | Extras only — 10/10 rows |
| `faq` | 10/10 | ⚠️ partial | `frontmatter_extras.faq` | ✅ | Extras only — 10/10 rows |
| `relatedArticles` | 6/10 | ⚠️ partial | `frontmatter_extras.relatedArticles` | ✅ | Extras only — 6/10 rows (4 files without it in MDX) |

---

## Section 3: Gap Categories

### Gap A: Fields silently dropped (not in DB at all)

| Field | Collection | Why dropped | Impact |
|---|---|---|---|
| `articles.title` for `authors` | authors | `name` not in TYPED_FIELDS; goes to extras | Any title-based query on authors returns null |
| `articles.publishedAt` for `blog` | blog | Blog uses `date` not `publishedAt`; typed mapper expects `publishedAt` | All blog `publishedAt` = null in DB |
| `articles.frontmatterUpdatedAt` for `blog` | blog | Blog uses `updated` not `updatedAt`; mapper expects `updatedAt` | All blog `frontmatterUpdatedAt` = null in DB |
| `articles.intentType` for `tools` | tools | Tools don't set `intentType`; no default applied | Tool spotlight eligibility check needs `intentType` from frontmatterExtras instead |
| `email` | authors | Not set in any MDX file; absent from extras | No impact now; but schema intent is lost |

### Gap B: Fields in JSONB `frontmatter_extras` catch-all only

These fields are present in DB (queryable via JSONB operators) but not in dedicated typed columns:

**High-frequency extras in tools (all 108 rows):**
`pricing`, `rating`, `votes`, `website`, `image`, `features`, `pros`, `cons`, `useCases`, `integrations`, `faq`, `seoTitle`, `seoDescription`, `affiliateSlug`, `relatedPillars`, `source`

**High-frequency extras in blog (all 60 rows):**
`date`, `excerpt`, `heroImage`, `heroImageAlt`, `seoTitle`, `seoDescription`, `featured`, `speakable`, `readingTime`, `bottomLinksVariant`, `faq`

**High-frequency extras in comparisons (all 22 rows):**
`toolSlugs`, `winner`, `verdict`, `useCaseVerdicts`, `testMethodology`, `comparedAt`, `heroImage`, `heroImageAlt`, `seoTitle`, `seoDescription`, `faq`

**High-frequency extras in ki-wissen (all 24 rows):**
`level`, `icon`, `color`, `facts`, `next`, `seoTitle`, `seoDescription`, `faq`

**High-frequency extras in usecases (all 24 rows):**
`icon`, `heroImage`, `heroImageAlt`, `contentType`, `relatedTags`, `relatedPillarSlugs`, `relatedComparisonSlugs`, `featuredToolSlugs`, `faq`, `estimatedReadTime`

**Consequence:** Filtering and sorting on these fields requires JSONB operators: `WHERE frontmatter_extras->>'pricing' = 'freemium'` instead of `WHERE pricing = 'freemium'`. This is queryable but ~10-50x slower than indexed column queries on large tables. Not a blocker for 272 rows but will be at scale.

### Gap C: Type/coercion issues

| Field | Collection | Issue | DB state |
|---|---|---|---|
| `pricing` in tools | tools | Mixed quoted/unquoted YAML (`"freemium"` vs `freemium`) | Normalized correctly by gray-matter to string |
| `source` in tools | tools | Mixed quoted/unquoted YAML | Normalized by gray-matter; JSONB value is string |
| `author` in tools | tools | Mixed quoted/unquoted YAML | Normalized; DB `articles.author = "toolwiki"` |
| `date` in blog | blog | String date `"2026-03-28"` preserved as string in extras | Not coerced to Date; stored as string in JSONB |
| `priceFrom` in tools | tools | Integer in MDX (`39`); stored as JSONB number | Preserved as number in JSONB — correct type |
| `offerPrice` in special-landings | special-landings | Integer in MDX; stored as JSONB number | Correct |
| `publishedAt` for blog `date` | blog | Should be timestamp; is null in `articles.publishedAt` | Requires custom mapping to fix |

### Gap D: Cross-collection FK relationships lost

| Relationship | Source field | Status | Impact |
|---|---|---|---|
| blog.author → authors.slug | `articles.author` (string) | ⚠️ partial | Author slug stored in `articles.author` column; no DB FK; join must be manual |
| tools.clusterKey → clusters | `articles.cluster_key` | ✅ | `SyncClustersFromFrontmatterStep` creates `cluster_id` FK for all 108 tool rows |
| comparisons.toolSlugs → tools articles | `frontmatter_extras.toolSlugs` | ⚠️ partial | Array of slugs in JSONB only; no FK linkage; requires multi-step query |
| usecases.featuredToolSlugs → tools | `frontmatter_extras.featuredToolSlugs` | ⚠️ partial | Array in JSONB; no FK |
| special-landings.toolSlug → tools | `frontmatter_extras.toolSlug` | ⚠️ partial | String in JSONB; no FK |
| special-landings.alternativeToolSlugs → tools | `frontmatter_extras.alternativeToolSlugs` | ⚠️ partial | Array in JSONB; includes broken `"dall-e"` ref |
| usecases no cluster linkage | — | ❌ | 24 usecases rows have `cluster_id = null`; not in any cluster graph |

### Gap E: Per-locale gaps

| Gap | Collection | DE rows affected | EN rows affected |
|---|---|---|---|
| `heroImage` in tools | tools | 0/54 (none in MDX) | 36/54 (match MDX) |
| `heroImage` in ki-wissen | ki-wissen | 11/12 (1 missing "was-ist-ki") | 11/12 (1 missing "what-is-ai") |
| `frontmatterUpdatedAt` in blog | blog | 0/30 (null — uses `updated` not `updatedAt`) | 0/30 (same) |
| `publishedAt` in blog | blog | 0/30 (null — uses `date` not `publishedAt`) | 0/30 (same) |
| `schemaJsonLd` non-standard field | blog | 2/30 (chatgpt-preise, code-assistenten) | 1/30 (chatgpt-pricing) |

---

## Section 4: Tools Deep Dive

### Question 1: Of the 29 tools frontmatter fields, how many are imported and where?

| Storage tier | Field count | Fields |
|---|---|---|
| Dedicated DB column | 11 | `title`, `description→metaDescription`, `category`, `subcategory`, `locale`, `translationKey`, `clusterKey`, `clusterRole`, `tags`, `author`, `frontmatterUpdatedAt` |
| JSONB `frontmatter_extras` (100% coverage) | 14 | `pricing`, `rating`, `votes`, `website`, `image`, `features`, `pros`, `cons`, `useCases`, `integrations`, `faq`, `seoTitle`, `seoDescription`, `affiliateSlug`, `relatedPillars`, `source` |
| JSONB `frontmatter_extras` (partial coverage) | 4 | `heroImage` (36/108 EN only), `heroImageAlt` (36/108 EN only), `affiliateSlug` (106/108), `parentSlug` (80/108), `speakable` (8/108) |
| Effectively dropped | 1 | `intentType` — not set in any tools MDX; DB column is null for all 108 rows |

**Total: 11 dedicated + 16 extras = 27 of 29 fields reachable. 2 effectively absent** (`intentType` never set in tools, `noindex` defaulted to false and technically present as column).

### Question 2: Are the tool rows complete enough to support Spec 54.8 without re-reading MDX?

**Yes, for the primary use cases.** All critical tool data is in `frontmatter_extras`:
- `pricing`, `rating`, `votes`, `priceFrom` — sufficient for sort/filter
- `pros`, `cons`, `features`, `useCases` — sufficient for spotlight generation
- `affiliateSlug` — sufficient for CTA/link generation
- `seoTitle`, `seoDescription` — sufficient for page rendering
- `faq` — sufficient for FAQ schema rendering
- `heroImage` (EN only), `image` (all) — sufficient for media rendering

**Known limitations for 54.8:**
- `intentType = null` for all tool rows — any eligibility check for "tool spotlight" must use `frontmatter_extras->>'pricing'` or similar proxy, NOT `articles.intent_type`
- Tools `heroImage` is missing for all 54 DE rows — DE tool pages cannot render hero banners without re-reading MDX or copying from EN sibling
- `source` in extras is the frontmatter `source: "manual"` field (editorial provenance), distinct from `articles.source = "imported"` (pipeline source enum)

### Question 3: Migration strategy recommendation

**Recommendation: Strategy C — Hybrid (DB reshape + selective MDX re-read)**

| Strategy | Description | Pros | Cons |
|---|---|---|---|
| A: Re-read all MDX | Parse all 108 tools MDX again; populate new columns | Authoritative; handles quoting normalization | Requires GitHub API access; re-processes 108 files |
| B: DB-only reshape | Extract from `frontmatter_extras` into new dedicated columns via SQL UPDATE | No GitHub dependency; instant | Data already in JSONB; no re-parsing needed except type coercions |
| C: Hybrid | DB-only reshape for text/number fields; re-read MDX only for DE heroImage | Minimal GitHub calls; authoritative for heroes | Slightly more complex |

**For Spec 54.8 specifically:**
- `pricing`, `rating`, `votes`, `priceFrom`, `pros`, `cons`, `features`, `useCases`, `affiliateSlug`, `website`, `image` → promote from `frontmatter_extras` via SQL UPDATE to new dedicated columns (or leave in extras and document the query pattern)
- DE `heroImage` → requires 54 GitHub blob reads OR copy from EN sibling (hero images are locale-neutral)
- No data is lost — everything is already in the DB via `frontmatter_extras`

---

## Section 5: Authors Deep Dive

### Question 1: Are author MDX files imported?

**Yes — confirmed.** All 10 author files (5 DE + 5 EN) are imported into `articles` with `collection = 'authors'` and `source = 'imported'`. Import has been running since 2026-05-08.

### Question 2: Do author fields make it into DB?

**Partially.** The critical gap is that `name` (the author's full name — the primary identifier) is NOT in `TYPED_FIELDS` and therefore goes to `frontmatter_extras.name` while `articles.title` is null for all author rows.

| Field | DB location | Queryable? |
|---|---|---|
| name | `frontmatter_extras.name` (NOT `articles.title`) | ⚠️ Only via JSONB |
| description | `articles.meta_description` | ✅ Direct column |
| locale | `articles.locale` | ✅ Direct column |
| translationKey | `articles.translation_key` | ✅ Direct column |
| slug (from filename) | `articles.slug` | ✅ Direct column |
| jobTitle | `frontmatter_extras.jobTitle` | ⚠️ JSONB only |
| expertise | `frontmatter_extras.expertise` | ⚠️ JSONB only |
| initials | `frontmatter_extras.initials` | ⚠️ JSONB only |
| avatarGradient | `frontmatter_extras.avatarGradient` | ⚠️ JSONB only |
| image | `frontmatter_extras.image` | ⚠️ JSONB only |
| sameAs | `frontmatter_extras.sameAs` | ⚠️ JSONB only — all `[]` |
| location | `frontmatter_extras.location` | ⚠️ JSONB only |
| yearsExperience | `frontmatter_extras.yearsExperience` | ⚠️ JSONB only |

### Question 3: Are author REFERENCES preserved verbatim?

**Yes.** Blog and comparison articles store the author slug string (e.g. `"lukas-hoffmann"`) in `articles.author`. This matches the `articles.slug` of the corresponding author row. A manual join resolves correctly:

```sql
SELECT a.title AS article_title, auth.frontmatter_extras->>'name' AS author_name
FROM articles a
JOIN articles auth ON auth.collection = 'authors'
  AND auth.project_id = a.project_id
  AND auth.slug = a.author
  AND auth.locale = a.locale
WHERE a.collection = 'blog' AND a.source = 'imported';
```

No DB-level FK exists for this join. The join works correctly in practice.

---

## Section 6: Special Cases

### The 4 Normalized Blog Files

Files `de/chatgpt-preise-2026.mdx`, `de/code-assistenten.mdx`, `en/chatgpt-pricing-2026.mdx`, `en/ai-code-assistants.mdx` use JSON-style YAML frontmatter (quoted keys) and contain non-schema fields. DB outcome:

| Extra non-schema field | Present in DB? | Value type |
|---|---|---|
| `cornerstoneKeyword` | ✅ `frontmatter_extras.cornerstoneKeyword` | string (4/4 rows) |
| `wordCount` | ✅ `frontmatter_extras.wordCount` | integer (4/4 rows) |
| `draft` | ✅ `frontmatter_extras.draft` | boolean `false` (4/4 rows) |
| `schemaJsonLd` | ✅ `frontmatter_extras.schemaJsonLd` | nested object (3/4 rows — `en/ai-code-assistants.mdx` does NOT have it) |

The passthrough mechanism preserves these extra fields. No data loss. However, `schemaJsonLd` in extras may produce duplicate JSON-LD output on the rendered page if the application renders both its own JSON-LD and the embedded extras value.

### Pre-existing Data Anomalies Preserved in DB

| Anomaly | MDX source | DB impact |
|---|---|---|
| `alternativeToolSlugs: ["dall-e"]` broken ref | `special-landings/de/midjourney.mdx` + EN | Preserved verbatim in `frontmatter_extras.alternativeToolSlugs`; no validation at import |
| `author: "toolwiki"` non-slug in tools/ki-wissen/usecases | Multiple collections | Stored as-is in `articles.author`; join against authors table returns no match |
| `heroImage` absent in all DE tools | `tools/de/*.mdx` (all 54) | `frontmatter_extras.heroImage` absent in 54/108 rows — DE tools only |
| `speakable: true` in tools (not in tools schema) | 8 tool files | Preserved in `frontmatter_extras.speakable`; no schema enforcement issue at import |
| ki-wissen miscategorized articles (3 pairs) | `ki-wissen/de/{bias,risiken,zukunft}` + EN | Category stored as `"Technik"` in `articles.category` |

### Articles in DB Without MDX Counterpart

The DB contains 13 articles with `source = 'generated'` for the `toolwiki` project (9 DE + 4 EN, all `collection = 'blog'`). These were created by the content pipeline — not from MDX files. They are the expected generated articles.

No imported articles appear to lack an MDX counterpart. The count exactly matches:

| Collection | MDX audit | DB imported | Delta |
|---|---|---|---|
| authors | 10 | 10 | 0 |
| blog | 60 | 60 | 0 |
| comparisons | 22 | 22 | 0 |
| ki-wissen | 24 | 24 | 0 |
| special-landings | 10 | 10 | 0 |
| tool-categories | 14 | 14 | 0 |
| tools | 108 | 108 | 0 |
| usecases | 24 | 24 | 0 |
| **TOTAL** | **272** | **272** | **0** |

### MDX Files Without DB Row (Silent Import Failures)

Zero silent failures observed. The counts match exactly across all 8 collections. The last import ran 2026-05-13. All 272 MDX files are accounted for in DB.

---

## Section 7: Spec 54.8 Implications

### MUST Address in 54.8 (Blocking)

| Issue | Root cause | Required action |
|---|---|---|
| `blog.publishedAt = null` for all 60 blog rows | Mapper expects `publishedAt` but blog uses `date` | Add `date` to TYPED_FIELDS with Date coercion; map to `articles.publishedAt` |
| `blog.frontmatterUpdatedAt = null` for all 60 blog rows | Mapper expects `updatedAt` but blog uses `updated` | Add `updated` as alias in mapper; map to `articles.frontmatterUpdatedAt` |
| `authors.title = null` for all 10 author rows | `name` not in TYPED_FIELDS | Add `name` mapping: fall back `title = fm.name ?? fm.title ?? null` |
| `tools.intentType = null` for all 108 rows | Tools don't set intentType | Either: (a) accept null and adjust spotlight eligibility to not require intentType for imported tools; OR (b) derive a default `intentType = "review"` for all tools during import |

### SHOULD Address in 54.8 (Data Quality)

| Issue | Root cause | Recommended action |
|---|---|---|
| `heroImage` absent for all 54 DE tools | MDX files never had DE hero banners | Add logic to copy `heroImage` from EN sibling when importing DE tool (or copy via SQL after full import) |
| `toolSlugs`, `featuredToolSlugs`, `alternativeToolSlugs` are JSONB arrays only | By design — extras catch-all | For any query that needs to find "articles containing tool X": add GIN index on `frontmatter_extras` or promote key reference fields to typed columns |
| `broken alternativeToolSlugs "dall-e"` ref | MDX file error | Fix MDX source (two files) + re-import; DB will self-correct |
| Cluster linkage for `usecases` | usecases MDX has no cluster fields | Populate cluster fields in MDX + re-import; or accept that usecases live outside the cluster graph |
| Non-schema `schemaJsonLd` in 3 blog extras rows | JSON-style MDX files | Verify application does not double-render; strip from extras on next import or normalize MDX source |

### CAN Defer to Post-54.8 Backlog

| Issue | Notes |
|---|---|
| Promote `pricing`, `rating`, `votes` to dedicated tool columns | Currently queryable via JSONB; only needed for indexed filtering at scale |
| Add GIN index on `frontmatter_extras` | Would accelerate JSONB queries but not required for correctness |
| `seoTitle` / `seoDescription` typed columns | Currently in extras for all collections; promotion adds query convenience |
| `author: "toolwiki"` non-slug attribution | Editorial decision; no pipeline blocker |
| `speakable` field in tools (schema ghost) | Preserved in extras; no runtime impact |
| Monetization fields (`adsenseSlots`, `hasAffiliateLinks`) | Entirely dormant in MDX and DB |
| `clusterOrder` typed column for blog | Currently in extras; needed for hub/spoke ordering UI but not pipeline blocking |

### Recommended Migration Strategy for Spec 54.8

1. **Patch `parse-frontmatter.ts`** — Add to TYPED_FIELDS:
   - `date` → coerce to Date → map to `publishedAt`
   - `updated` → coerce to Date → map to `frontmatterUpdatedAt` (as alias for `updatedAt`)
   - `name` → string → fall back `title = fm.name ?? fm.title ?? null`
   
2. **Run force-re-import** (`forceAll: true`) for the toolwiki project to backfill the 60 blog rows and 10 author rows with corrected field values. The upsert pattern will update existing rows without data loss.

3. **For tools `intentType`**: Add a collection-aware default in `UpsertArticlesStep` — when `collection === 'tools'` and `typed.intentType === null`, set `intentType = 'review'` as a sensible default for tool articles.

4. **For DE tools heroImage**: After the force-re-import, run a SQL UPDATE to copy EN heroImage/heroImageAlt to DE siblings via translationKey join:
   ```sql
   UPDATE articles de_tool
   SET frontmatter_extras = jsonb_set(
     de_tool.frontmatter_extras,
     '{heroImage}',
     en_tool.frontmatter_extras->'heroImage'
   )
   FROM articles en_tool
   WHERE de_tool.project_id = en_tool.project_id
     AND de_tool.collection = 'tools'
     AND de_tool.locale = 'de'
     AND en_tool.collection = 'tools'
     AND en_tool.locale = 'en'
     AND de_tool.translation_key = en_tool.translation_key
     AND en_tool.frontmatter_extras ? 'heroImage'
     AND NOT de_tool.frontmatter_extras ? 'heroImage';
   ```

### New Schema Fields Recommended for Tools Table

If Spec 54.8 requires dedicated tool columns for filtering/sorting, the following fields would benefit from promotion:

| Field | Proposed column | SQL type | Rationale |
|---|---|---|---|
| `pricing` | `tool_pricing` | `text` | Enum-like; used for filter UI |
| `priceFrom` | `tool_price_from` | `numeric(10,2)` | Numeric; needed for sort-by-price |
| `rating` | `tool_rating` | `numeric(3,1)` | Numeric; needed for sort-by-rating |
| `votes` | `tool_votes` | `integer` | Numeric; sort-by-popularity |
| `affiliateSlug` | `tool_affiliate_slug` | `text` | Used for revenue tracking |
| `website` | `tool_website` | `text` | Used for canonical external links |

Minimum migration for 54.8: Add a `migration 0043` to add these 6 columns as nullable, then backfill from `frontmatter_extras` via SQL.

### Astro-Sync Code Changes Needed for Spec 54.8

| File | Change | Priority |
|---|---|---|
| `packages/adapters/astro-sync/src/import/parse-frontmatter.ts` | Add `date`, `updated`, `name` to TYPED_FIELDS with correct mapping | MUST |
| `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts` | Map `date` → `publishedAt`, `updated` → `frontmatterUpdatedAt`, `name` → `title` fallback | MUST |
| `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts` | Add collection-aware `intentType` default for `tools` collection | SHOULD |
| `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts` | Add 6 new tool-specific columns to INSERT/UPDATE if schema migration done | SHOULD |
| New migration file | Add tool-specific columns: `tool_pricing`, `tool_price_from`, `tool_rating`, `tool_votes`, `tool_affiliate_slug`, `tool_website` | SHOULD (if promoted columns strategy chosen) |

---

*Audit produced by read-only inspection. No code changes or DB writes were made.*
