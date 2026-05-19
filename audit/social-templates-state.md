# Social Templates Architecture State
**Date:** 2026-05-19
**Scope:** Pre-Spec 59.3–59.5 discovery — three new templates (news-slide, concept-explainer-deck, pro-con-verdict)
**Status:** Read-only — no code changes

---

## Section 1: Template Inventory

### Implemented Templates

| Template Key | Status | Definition File | Composition Dir | Overrides File | Since |
|---|---|---|---|---|---|
| `comparison-stunning` | implemented | `packages/social/src/templates/definitions/comparisonStunning.ts` | `packages/social/src/compositions/list-carousel/` | `comparisonStunning.overrides.ts` | Spec 54e |
| `comparison-stunning-3` | implemented | `packages/social/src/templates/definitions/comparisonStunning3.ts` | `packages/social/src/compositions/list-carousel/` (shared) | `comparisonStunning.overrides.ts` (shared) | Spec 54e |
| `use-case-verdict-per-tool` | implemented | `packages/social/src/templates/definitions/useCaseVerdictPerTool.ts` | `packages/social/src/compositions/use-case-verdict/` | `useCaseVerdict.overrides.ts` | Spec 54f |
| `single-tool-spotlight` | implemented | `packages/social/src/templates/definitions/singleToolSpotlight.ts` | `packages/social/src/compositions/single-tool-spotlight/` | `singleToolSpotlight.overrides.ts` | Spec 54f |
| `news-slide` | stub (TemplateKey only) | not created | not created | not created | Spec 54g (backlog) |
| `concept-explainer-deck` | stub (TemplateKey only) | not created | not created | not created | Spec 54h (backlog) |
| `price-comparison` | stub (TemplateKey only) | not created | not created | not created | unscheduled |
| `pro-con-verdict` | stub (TemplateKey only) | not created | not created | not created | unscheduled |

**TemplateKey union:** `packages/social/src/templates/types.ts:18–26`
**Bootstrap registration:** `packages/social/src/templates/bootstrap.ts:9–23` — lines 18–19 are commented-out stubs for `news-slide` and `concept-explainer-deck`

**Narrative:** Four templates are fully in production today. All four share the same lifecycle contract (eligibility predicate → content generation → Remotion render → R2 storage). Two of the three 59.3–59.5 targets (`news-slide`, `concept-explainer-deck`) are pre-declared in the TemplateKey union with commented-out bootstrap stubs; `pro-con-verdict` is also declared in the union but has no bootstrap comment. All three are pure greenfield — no definition file, no composition, no fixtures, no overrides schema exists for any of them.

---

## Section 2: Template Architecture Pattern

### Full Lifecycle for `carousel-classic` (here: `comparison-stunning` as the most mature)

```
1. BRIEF / INTENT
   - Template chosen by: manual selection in ArticleSocialTab.vue
     OR auto-selected by TemplateRegistry.listEligibleFor(article, discovery)
   - Eligibility check: packages/social/src/templates/definitions/comparisonStunning.ts (eligibility() fn)
     checks article collection = "tools" + toolCount ≥ 4 in discovery
   - checkEligibilityWithOverrides() in registry.ts:50 applies override-gated bounds
     (e.g. minProsCount / maxProsCount for single-tool-spotlight, lines 67–77)

2. CONTENT GENERATION
   - Step: GenerateCaptionStep in packages/pipelines/src/article/social-image/steps.ts
   - Model: claude-sonnet-4-6 (Sonnet, not Opus per cost audit)
   - generateContent() defined on TemplateDefinition: returns { hook, caption, hashtags }
   - Output schema: GeneratedContent (packages/social/src/templates/types.ts:34–40)
   - Persisted to: social_posts.content JSONB (caption + hashtags sub-keys)
   - Hook prompt: packages/core/src/social-hooks/hookPrompt.ts
   - Hashtag rules: packages/core/src/social-hashtags/buildHashtagInstructions.ts
     (7 tags, bilingual DE+EN mix, no hyphens, no year tags)

3. RENDER
   - BullMQ queue: "social-render" (packages/pipelines/src/engine/social-render-queue.ts:55)
   - Enqueue helper: enqueueSocialRenderJob() (same file, lines 81–102)
   - Worker: apps/api/src/workers/social-render.worker.ts
   - Worker concurrency: 1 (line 200 — Chromium memory constraint)
   - Lock duration: 5 minutes (line 202)
   - Attempts: 2 with 5s fixed backoff (social-render-queue.ts:64–65)
   - Remotion composition: packages/social/src/compositions/list-carousel/ListCarouselStunning.tsx
   - Called via: packages/social/render-server.ts → renderListCarouselStunning()
   - Canvas size: 1080×1350 (4:5 Instagram ratio)
     source: packages/social/src/compositions/list-carousel/safeZones.ts
   - Slide dispatch: composition receives slideIndex prop; top-level component
     switches on slideIndex to render cover / tool-slide / end-slide

4. STORAGE / DELIVERY
   - R2 key pattern: ${projectSlug}/social/${articleSlug}-${timestamp}-slide-${i}.png
     source: apps/api/src/workers/social-render.worker.ts:85
   - social_posts.assetUrl: not a single URL — slides array stored in content JSONB
   - social_posts.content.slides[]: array of { filePath, width, height }
   - Download UI: yes (ArticleSocialTab.vue)
   - Auto-publish: no — manual download only

5. OVERRIDE SYSTEM
   - Overrides file: packages/social/src/templates/overrides/comparisonStunning.overrides.ts
   - Schema sections: copy (bilingual DE/EN text), layout (boolean toggles), eligibility (min/max bounds)
   - Application: mergeOverrides(schema, storedValues) = schema.parse(storedValues ?? {})
     source: packages/social/src/templates/overrides/index.ts:62–67
   - Persistence: project_template_overrides table (packages/db/src/schema/social-overrides.ts)
   - Registry helper: fetchTemplateOverrides(projectId, templateKey) in packages/db
```

**ASCII flow:**
```
ArticleSocialTab → POST /social-posts → PersistSocialPostStep (pending)
                                              ↓
                                    enqueueSocialRenderJob (BullMQ)
                                              ↓
                               social-render.worker.ts (concurrency: 1)
                                              ↓
                               renderSlidesViaRemotion()
                                              ↓
                               render-server.ts → renderListCarouselStunning()
                                              ↓
                               getCompositions(serveUrl) → renderStill() per slide
                                              ↓
                               Upload PNG buffers → R2
                                              ↓
                               UPDATE social_posts: slides[], renderStatus='rendered'
                                              ↓
                               SSE event: social.render.completed
```

---

## Section 3: Brand Tokens + Theme System

Brand tokens are stored at project level in the `projects` table (`brandTokens` jsonb column, not per-template). They are resolved and passed at render time through `RenderContext.brandTokens`.

**Brand token schema** (full definition at `packages/social/src/compositions/list-carousel/types.ts:4–54`):
```typescript
{
  colors: {
    primary, primaryHue, accent, surface, surfaceDark, ink, inkMuted, wikiCream,
    surfaceSecondary, eyebrowColor, pricingFree, pricingFreemium, pricingPaid
  },
  typography: {
    fontFamily, headingWeight, bodyWeight, eyebrowLetterSpacing,
    rankBadgeSize, rankBadgeWeight, rankBadgeLetterSpacing,
    footerWebsiteSize, footerHandleSize, footerLabelSize, footerGap
  },
  voice: {
    locale, addressForm, forbiddenWords, signaturePhrases
  },
  social: {
    instagramHandle, websiteUrl, logoAssetKey
  }
}
```
All fields have `.default()` values — `brandTokensSchema.parse({})` returns a complete object.

**Injection pattern:** Every template's `render()` function reads:
```typescript
const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;
```
(source: `packages/social/src/templates/definitions/singleToolSpotlight.ts:14`)

Theme tokens (dark/light palette, oklch colors, CSS vars) are resolved via `getThemeTokens(brandTokens?, theme?)` in `packages/social/src/lib/theme.ts`. Composition components never import `DEFAULT_BRAND_TOKENS` directly — they receive tokens via `input.brandTokens` prop from the render context.

Per-template overrides layer on top of project-level brand tokens; they do not replace them. Override copy fields (e.g. `coverEyebrowLabel`) exist as bilingual objects `{ de: string, en: string }` separate from brand color tokens. Tokens are resolved only at render time — the LLM generation step does not have access to brand tokens.

---

## Section 4: Content-Type vs Template Mapping

Template selection is currently **manual** — Marcel selects a template in ArticleSocialTab.vue from the list of eligible templates returned by `listEligibleFor()`. There is no LLM-based auto-suggestion or scoring for template selection.

`TemplateRegistry.listEligibleFor()` (`packages/social/src/templates/registry.ts:38`) runs each template's `eligibility()` predicate and returns eligible ones sorted alphabetically by key. Each definition encodes its own eligibility logic (collection, tool count, pros count, pricing data, etc.) — there is no shared content-type → template routing table.

The `plannerMeta` field on `TemplateDefinition` (introduced Spec 54g) stores structured metadata: `contentType`, `engagementTier`, `recyclability`, `requiresLiveData`. This is present on all four existing templates but is informational only — no code currently uses it for auto-routing. This is the intended scaffolding for future "LLM-based auto-template-suggestion" work, but that feature is not implemented.

Hashtag categorization does reference template content types (`comparison`, `tool-spotlight`, `use-case`) in `packages/core/src/social-hooks/hookPrompt.ts` for selecting anchor hashtags.

---

## Section 5: Multi-Slide Carousel Structure

**Slide dispatch pattern** (all implemented compositions):

Each Remotion composition receives `slideIndex: number` as an input prop. The top-level component renders the correct slide type via a switch/if on `slideIndex`. The render-server calls `renderStill()` once per slide index to produce individual PNG frames.

**Canvas dimensions** (all templates):
```
CANVAS_W:      1080px
CANVAS_H_4_5:  1350px  (4:5 ratio — Instagram feed)
PAD_X:         60px
PAD_Y_TOP:     140px
PAD_Y_BOTTOM:  140px
INNER_W:       960px
INNER_H:       1070px
```
Source: `packages/social/src/compositions/list-carousel/safeZones.ts`

**Slide counts:**
- `comparison-stunning`: 6 slides (cover + 4 tool slides + end)
- `comparison-stunning-3`: 5 slides (cover + 3 tool slides + end)
- `use-case-verdict-per-tool`: dynamic = 1 (cover) + N (verdicts) + 2 (recap + end)
  source: `packages/social/render-server.ts:120`
- `single-tool-spotlight`: 4–5 slides (cover + strengths + pricing/whom + 1–2 use-case detail + end)
  source: `packages/social/render-server.ts:85`

**Slides stored in DB:** `social_posts.content.slides[]` = array of `{ filePath: string, width: number, height: number }`. Not typed by role (hook/context/verdict) — just ordered PNGs with index implied by array position.

**ListCarouselInput schema** (used by both comparison templates):
```typescript
// packages/social/src/compositions/list-carousel/types.ts
{
  tools: ToolEntry[],       // min 3 (3-variant) or 4 (4-variant)
  locale: "de" | "en",
  theme: "dark" | "light",
  brandTokens?: BrandTokens,
  overrides?: Record<string, unknown>,
  hook?: string,
  coverEyebrow?: string
}
```

**Font requirement:** `loadFont()` from `@remotion/google-fonts/SpaceGrotesk` must be called at module scope in every composition file.

---

## Section 6: Existing Bilingual Support

All four implemented templates are fully bilingual. Locale (`"de" | "en"`) propagates through the entire stack:

1. Article's `locale` column (DB source of truth)
2. `template.buildInput(article, discovery)` receives article locale, includes it in input
3. `template.generateContent(article, input, locale, llmCaller)` — locale param drives LLM output language
4. `RenderContext.locale` passed to `template.render()`
5. `input.locale` in composition props → Remotion components choose DE/EN copy

**All four composition `types.ts` files include:** `locale: z.enum(["de", "en"]).default("de")`
(This is enforced by a CLAUDE.md warning after a Spec 57.3 regression where `list-carousel` was missing this field.)

**Caption/hashtag generation:** Single Sonnet 4.6 JSON call in `GenerateCaptionStep` (Spec 57.4). The prompt in `packages/core/src/social-hooks/hookPrompt.ts` is always in English with inline language directive: `"German output, du-form"` or equivalent. Hashtags are bilingual DE+EN mix regardless of article locale (7 total, per `buildHashtagInstructions.ts`).

**Override copy fields** use bilingual objects `{ de: string, en: string }` — e.g. `coverEyebrowLabel: { de: "TOOL-VERGLEICH", en: "TOOL COMPARISON" }`. Composition reads: `const text = locale === "de" ? overrides.copy.field.de : overrides.copy.field.en`.

For 59.3–59.5: new templates must include `locale` in their `types.ts` input schema and follow the same bilingual pattern for any copy strings.

---

## Section 7: Render Worker + BullMQ Integration

| Property | Value | Source |
|---|---|---|
| Queue name | `"social-render"` | `packages/pipelines/src/engine/social-render-queue.ts:55` |
| Worker file | `apps/api/src/workers/social-render.worker.ts` | — |
| Concurrency | 1 (Chromium memory) | worker line 200 |
| Lock duration | 5 minutes | worker line 202 |
| Stall check interval | 10 minutes | worker line 203 |
| Max stalled count | 1 | worker line 204 |
| Attempts | 2 | queue line 64 |
| Backoff | 5s fixed | queue line 65 |
| Remove on complete | last 100 | queue line 66 |
| Remove on fail | last 500 | queue line 67 |

**Render lifecycle states:** `pending → rendering → rendered` or `failed`

**Re-render jobId rule (Spec 58.2):** Initial render uses stable `render-${socialPostId}`. Re-renders must use `rerender-${id}-${Date.now()}` to avoid BullMQ dedup silently no-op-ing.

**R2 upload:** Worker uploads each PNG buffer to R2, stores URL array in `social_posts.content.slides` via `jsonb_set()` (preserves caption/hashtags sibling keys).

**SSE events emitted by worker:** `social.render.started`, `social.render.completed`, `social.render.failed` (via `apps/api/src/lib/ui.ts` SSE bus).

Commentary: With concurrency 1, renders are sequential. A new template with more slides (e.g. 10-slide concept-explainer) will block the queue longer. No timeout per-render is currently configured beyond the 5-minute lock. Failure on final attempt writes `renderError` string + emits `social.render.failed`.

---

## Section 8: Override System State

### Schema structure example (`comparisonStunning.overrides.ts`)

```typescript
// packages/social/src/templates/overrides/comparisonStunning.overrides.ts
export const comparisonStunningOverridesSchema = z.object({
  copy: z.object({
    coverEyebrowLabel: z.object({ de: z.string(), en: z.string() })
      .default({ de: "TOOL-VERGLEICH", en: "TOOL COMPARISON" }),
    // ... additional copy fields with de/en defaults
  }).default({}),
  layout: z.object({
    includeEndSlide: z.boolean().default(true),
    showRankBadge: z.boolean().default(true),
    showPricingChip: z.boolean().default(true),
    // ... additional layout toggles
  }).default({}),
  eligibility: z.object({
    // template-specific bounds if needed
  }).default({})
}).strip()
```

**Rule:** Every nested object must have `.default({})` so `schema.parse({})` returns a fully-populated object with all defaults applied.

**Override registry** (`packages/social/src/templates/overrides/index.ts`):
- `OVERRIDE_TEMPLATE_KEYS`: `["comparison-stunning", "comparison-stunning-3", "single-tool-spotlight", "use-case-verdict-per-tool"]` (lines 26–31)
- `getOverrideSchema(templateKey)` — switch returning the correct Zod schema (lines 41–51)
- `mergeOverrides(schema, storedValues)` — just `schema.parse(storedValues ?? {})` (lines 62–67)
- `isOverrideTemplateKey(key)` — type guard (lines 53–55)

**Persistence:**
- Table: `project_template_overrides` (`packages/db/src/schema/social-overrides.ts`)
- Composite unique: `(projectId, templateKey)`
- `values: jsonb` — raw stored overrides (partial, missing keys get defaults from `mergeOverrides`)
- `lastUsedAt`: updated fire-and-forget on use (1-hour debounce)

**Override-gated eligibility:** `registry.checkEligibilityWithOverrides()` (line 50) reads stored overrides to apply bounds — e.g. `single-tool-spotlight` requires `prosCount` between `minProsCount` and `maxProsCount` from overrides. This allows project-level tuning of eligibility without code changes.

**For 59.3–59.5:** Each new template must have:
1. An overrides schema file in `packages/social/src/templates/overrides/<key>.overrides.ts`
2. Entry in `OVERRIDE_TEMPLATE_KEYS` array
3. Case in `getOverrideSchema()` switch
4. `copy` section with bilingual fields for any fixed UI strings
5. `layout` section with boolean toggles for optional structural elements
6. `eligibility` section if slide-count bounds or content requirements should be tunable

---

## Section 9: Template Gaps

| Template | TemplateKey Union | Bootstrap Stub | Definition File | Composition | Overrides | Fixtures |
|---|---|---|---|---|---|---|
| `news-slide` | ✅ line 23 | ✅ commented line 18 (Spec 54g) | ❌ | ❌ | ❌ | ❌ |
| `concept-explainer-deck` | ✅ line 24 | ✅ commented line 19 (Spec 54h) | ❌ | ❌ | ❌ | ❌ |
| `price-comparison` | ✅ line 25 | ❌ | ❌ | ❌ | ❌ | ❌ |
| `pro-con-verdict` | ✅ line 26 | ❌ | ❌ | ❌ | ❌ | ❌ |

All four stubs are pure greenfield. No scaffold, no partial implementation, no TODO comments in template files. The TemplateKey union declarations in `types.ts` are the only artifacts that exist.

---

## Section 10: Open Items for 59.3–59.5 Consideration

**Anti-patterns to avoid:**
- Do not use `jsonMode: true` with `claude-sonnet-4-6` — model rejects assistant prefill (CLAUDE.md warning). Extract JSON manually with `indexOf("{")` / `lastIndexOf("}")`.
- Do not omit `locale: z.enum(["de", "en"]).default("de")` from composition `types.ts` — silent DE default on EN articles (Spec 57.3 regression).
- Do not hardcode oklch colors with hex-alpha digits — use `color-mix(in oklch, ...)` for transparency (CLAUDE.md warning).
- Do not add `as T` casts to jsonb columns that already use `.$type<T>()`.

**Patterns 59.3–59.5 must follow:**
- `TemplateDefinition<TInput>` full contract: all fields required including `generateContent()`, `mockFixtures` (char + edge-min + edge-max)
- `eligibility()` returns `{ eligible: boolean, reason: string }` — never throws
- `render()` calls render-server.ts via dynamic import (`await import("../../render-server.js")`)
- Composition input schema must include `locale`, `theme`, `brandTokens?`, `overrides?`
- Render-server.ts needs a new `renderXxx()` function per new composition; composition registered in `packages/social/src/index.tsx`
- Bootstrap: uncomment existing stubs (`news-slide`, `concept-explainer-deck`) or add new ones (`pro-con-verdict`)
- Override schema in `packages/social/src/templates/overrides/` with `copy + layout + eligibility` sections
- `OVERRIDE_TEMPLATE_KEYS` array and `getOverrideSchema()` switch updated in `overrides/index.ts`

**Files that must be extended for each new template:**
1. `packages/social/src/templates/types.ts` — TemplateKey union (already done for 3 of 4)
2. `packages/social/src/templates/bootstrap.ts` — uncomment or add `templateRegistry.register(...)`
3. `packages/social/src/templates/overrides/index.ts` — OVERRIDE_TEMPLATE_KEYS + switch case
4. `packages/social/src/index.tsx` — `<Composition id="..." ... />` registration
5. `packages/social/render-server.ts` — new `renderXxx()` function
6. `apps/api/src/workers/social-render.worker.ts` — routing in `renderSlidesViaRemotion()` switch

**New files to create per template:**
- `packages/social/src/templates/definitions/<key>.ts` — TemplateDefinition
- `packages/social/src/templates/definitions/fixtures/<key>.fixtures.ts` — 3 fixtures
- `packages/social/src/templates/overrides/<key>.overrides.ts` — Zod override schema
- `packages/social/src/compositions/<composition-name>/` — React/Remotion components + types.ts + safeZones.ts

**Shared components already available** (can reuse without modification):
- `packages/social/src/shared/ToolIconImage.tsx`
- `packages/social/src/shared/PricingChip.tsx`
- `packages/social/src/shared/BrandLogo.tsx`
- `packages/social/src/shared/Eyebrow.tsx`
- `packages/social/src/shared/BackgroundLayer.tsx`

**Test convention:** `packages/social/test/<composition-name>.test.ts` — see `list-carousel-stunning.test.ts` for pattern.

**Render queue note:** concurrency is 1. A 10-slide concept-explainer-deck renders 10× sequential `renderStill()` calls. Expect ~3–5s per slide with Chromium warmup = 30–50s total for longer templates.

---

## Section 11: Recommendations for 59.3–59.5 Specs

### Structure Recommendation

**One spec per template** (three separate specs: 59.3, 59.4, 59.5). Each template has distinct slide structure, LLM prompt logic, eligibility criteria, and composition components. A combined spec would be unwieldy to implement in a single session.

Proposed spec sections (replicate this across 59.3–59.4–59.5):
1. **Overview** — what the template is, target content type, slide count
2. **TemplateDefinition contract** — eligibility predicate, plannerMeta, cost estimate
3. **Slide schema** — input types.ts, slide variants, canvas layout decisions
4. **LLM prompt** — generateContent() prompt design, output schema, model (Sonnet 4.6)
5. **Remotion composition** — component breakdown, slide dispatcher, safeZones
6. **Override fields** — which copy/layout/eligibility fields are tunable
7. **Fixtures** — characteristic, edge-min, edge-max specs
8. **render-server.ts addition** — function signature
9. **Worker routing** — switch case addition in social-render.worker.ts
10. **Test plan** — smoke test with mock fixture, renderStatus assertion

### Estimated Effort (based on carousel-classic baseline)

| Template | Slides | LLM Complexity | Est. Effort |
|---|---|---|---|
| `news-slide` | 1 (single-slide teaser) | low — short text slots | 0.5 spec sessions |
| `pro-con-verdict` | 4–6 (cover + pro-slots + con-slots + verdict + end) | medium — structured extraction from article | 1 spec session |
| `concept-explainer-deck` | 5–8 (cover + concept frames + CTA) | high — original concept synthesis | 1.5 spec sessions |

### Recommended Implementation Order

1. **pro-con-verdict** (59.3 first) — most structural parallels to existing templates; pros/cons data already extracted by DraftStep for tool articles (`frontmatterExtras.pros`, `frontmatterExtras.cons`); eligibility predicate straightforward
2. **news-slide** (59.4 second) — simplest render (single slide); different LLM approach (extract headline + stat + CTA from article); establishes "single-slide" pattern
3. **concept-explainer-deck** (59.5 last) — most complex LLM step; requires generating educational framing from article; highest risk

### Cross-Cutting Concerns (all three templates share)

- `locale: z.enum(["de", "en"]).default("de")` in composition `types.ts` — mandatory
- `brandTokens?` + `overrides?` in composition input schema — mandatory
- `generateContent()` single Sonnet 4.6 JSON call returning `{ hook, caption, hashtags }` — mandatory
- Bilingual `copy` object in overrides schema for all UI-visible strings
- 3-fixture pattern: characteristic + edge-min + edge-max
- `loadFont()` at module scope in each composition file (SpaceGrotesk or chosen font)
- Dynamic import of render-server in `render()` function
- Worker switch case addition in `renderSlidesViaRemotion()` to route by templateKey
- SSE events reused as-is — no new event types needed
- Re-render flow (Spec 58.2) works for new templates automatically once worker routes them
- All prompts in English; output locale specified inline
