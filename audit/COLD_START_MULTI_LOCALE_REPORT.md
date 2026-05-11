# Cold-Start Multi-Locale Support — Implementation Report

Date: 2026-05-11

## Section 1: Schema Migration

**Files changed:**
- `packages/db/src/schema/projects.ts` — added `targetLocales: jsonb.$type<string[]>().notNull().default(["de-DE"])`
- `packages/db/drizzle/0019_add_target_locales.sql` — migration SQL + `UPDATE projects SET target_locales = '["de-DE","en-US"]' WHERE slug = 'toolwiki'`
- `packages/db/drizzle/meta/_journal.json` — idx 19, when 1779700000000

**Migration applied:** YES — `bun run db:migrate` output confirmed `Migrations completed`.

**Deviations:** None.

---

## Section 2: locale-context.ts Utility

**Files created:**
- `packages/pipelines/src/cold-start/_lib/locale-context.ts`

**Exports:**
- `buildLocaleContext(targetLocales: string[]): LocaleContext` — maps locale codes to search engines, audience descriptors, DataForSEO location/language codes
- `localeFromDomain(domain: string, fallback: LocaleContext)` — infers DataForSEO location/language from competitor TLD

**Supported locales:** `de-DE` (Google.de, 2276/de), `en-US` (Google.com, 2840/en), `en-GB` (Google.co.uk, 2826/en). Extensible via `LOCALE_METADATA`.

**Deviations:** Added `locationCodes` and `languageCodes` arrays to `LocaleContext` (not in spec) — needed so `FetchCompetitorKeywordsStep` can use `localeFromDomain` without re-deriving from scratch. Also added `localeFromDomain` helper here (Section 5 concern) for co-location.

---

## Section 3: Phase 2a — IdentifyCompetitorsStep locale-aware

**Files changed:**
- `packages/pipelines/src/cold-start/02-competitor-analysis/steps.ts`

**Changes:**
- Added imports: `db`, `projects` from `@marketing-auto/db`; `eq` from `drizzle-orm`; `buildLocaleContext`, `localeFromDomain` from `../_lib/locale-context.ts`
- `IdentifyCompetitorsStep.execute`: loads `targetLocales` from DB by `projectSlug`; builds `audienceLine`, `searchLine`, `competitorDistribution` dynamically
- Multi-locale: distribution block mentions toolify.ai/futurepedia.io + forces per-locale coverage
- Single-locale: stays DACH-focused (unchanged behavior for existing tenants)

**Deviations:** None.

---

## Section 4: Phase 3 — GenerateClusterCandidatesStep locale-aware

**Files changed:**
- `packages/pipelines/src/cold-start/03-cluster-plan/steps.ts`

**Changes:**
- Added same DB/drizzle/locale-context imports
- `GenerateClusterCandidatesStep.execute`: loads `targetLocales`; builds `searchVolumeRule` dynamically
- Multi-locale: rule asks LLM to tag each cluster with its target locale in `reasoning` field; allows secondary-locale volume > 30
- Single-locale: unchanged behavior

**Deviations:** None.

---

## Section 5: DataForSEO — FetchCompetitorKeywordsStep locale-aware

**Files changed:**
- `packages/pipelines/src/cold-start/02-competitor-analysis/steps.ts`

**Changes:**
- `FetchCompetitorKeywordsInputSchema` extended with `projectSlug: z.string()` — the pipeline already passes it (first step receives full `AnalysisInputSchema` which includes `projectSlug`)
- `FetchCompetitorKeywordsStep.execute`: loads `targetLocales` → `buildLocaleContext` as fallback; calls `localeFromDomain(c.domain, localeCtx)` per competitor; passes `locationCode`/`languageCode` to `dataforseo.rankedKeywords()`

**TLD routing:**
- `.de` / `.at` / `.ch` → Germany (2276) / de
- `.co.uk` / `.uk` → UK (2826) / en
- `.com` / `.ai` / `.io` / `.net` / `.org` / `.app` / `.dev` → USA (2840) / en
- Unknown TLD → project primary locale fallback

**Deviations:** `projectSlug` added to `FetchCompetitorKeywordsInputSchema` (not in spec, but needed to load locale). No bridge changes needed — pipeline already passes `projectSlug` as part of `AnalysisInputSchema` to the first step.

---

## Section 6: Tests

**Files created:**
- `packages/pipelines/test/cold-start/locale-context.test.ts` — 10 tests covering buildLocaleContext (single/bilingual/unknown/empty/en-GB) and localeFromDomain (.de/.at/.ai/.com/.co.uk/unknown)
- `packages/pipelines/test/cold-start/identify-competitors-locale.test.ts` — 4 tests verifying prompt strings for single-locale, bilingual, toolify/futurepedia hint, unknown locale fallback
- `packages/pipelines/test/cold-start/cluster-candidates-locale.test.ts` — 4 tests verifying search volume rule strings for single-locale, bilingual, volume threshold, unknown locale fallback

**Test run:** `bun run --cwd packages/pipelines test` → **106 pass, 23 skip, 0 fail** (skipped = live-API-gated tests, unchanged).

---

## Section 7: Docs

**Files changed:**
- `apps/api/CLAUDE.md` — added "## Project Target-Locales" section

---

## Acceptance Checklist

- [x] Schema-Migration: `target_locales` column added + toolwiki set to bilingual
- [x] `locale-context.ts` created + tested (10 unit tests)
- [x] `IdentifyCompetitorsStep`: prompt dynamic by locale + tested
- [x] `GenerateClusterCandidatesStep`: prompt dynamic by locale + tested
- [x] DataForSEO calls: location/language based on competitor TLD
- [x] CLAUDE.md updated with Project-Locales section
- [x] All existing tests still pass (106 pass, 0 fail)

**Manual verification (toolwiki Phase 2 re-run):**
Not run in this session (requires live DataForSEO + Anthropic credits). The prompt for a
bilingual project now explicitly includes:
- "Audiences: German-speaking DACH professionals AND English-speaking international professionals"
- "Active and ranking on multiple search engines: Google.de, Google.com"
- "DISTRIBUTION (CRITICAL for multi-locale projects): For each target locale (de-DE, en-US)..."
- Examples: toolify.ai / futurepedia.io for international + DACH-specific sites
