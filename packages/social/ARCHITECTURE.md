# Social-Media-Tool — Architecture Analysis & Refactoring Plan

> Written 2026-05-14. Reference for all post-54f refactoring specs.  
> Code verified — every finding cites file:function.

---

## Part 1 — Analysis Findings

### 1.1 Current Template Schema

**`TemplateDefinition<TInput>`** lives in `packages/social/src/templates/types.ts`:

```typescript
interface TemplateDefinition<TInput = unknown> {
  key: TemplateKey;          // must be in TemplateKey union
  displayName: string;
  description: string;
  defaultSlideCount: number; // implicit: assumes carousel output
  estimatedCostUsd: number;  // static field — Remotion render cost only
  eligibility: EligibilityPredicate;   // sync, pure
  buildInput: (article, discovery) => Promise<TInput>;
  render: (context: RenderContext<TInput>) => Promise<RenderResult>;
  mockFixtures: MockFixtureMap;
}
```

**What's missing from the schema:**
- No `outputFormat` — carousel is assumed, never declared
- No `channels` — Instagram is assumed everywhere
- No `generationClass` — frontmatter-derived vs. LLM-live is invisible from the schema
- No `generateHook` — hooks are assembled ad-hoc inside each template's `render()` or hardcoded in `buildInput()`
- No `buildCaption(channel)` / `buildHashtags(channel)` contract — these are private functions per-template

**Active templates** (registered in `packages/social/src/templates/bootstrap.ts`):

| Key | Collection | Slides | LLM? |
|-----|-----------|--------|------|
| `comparison-stunning` | `comparisons` (exactly 2 tools) | 4 | ❌ |
| `comparison-stunning-3` | `comparisons` (exactly 3 tools) | 5 | ❌ |
| `use-case-verdict-per-tool` | `comparisons` (≥3 verdicts) | 4–11 | ❌ |
| `single-tool-spotlight` | `tools` | 4–5 | ❌ (in-flight, Spec 54f) |

**All current templates are frontmatter-derived.** No Anthropic calls anywhere in `buildInput` or `render`. The "LLM-live" class does not exist yet in the template system — it's a future concept.

---

### 1.2 Carousel Coupling

**Dimensions — hardcoded in two places:**

`packages/social/src/compositions/list-carousel/safeZones.ts:3–5`:
```
CANVAS_W      = 1080
CANVAS_H_4_5  = 1350   ← 4:5 Instagram portrait (3 templates)
CANVAS_H_1_1  = 1080   ← 1:1 square (editorial variant, not used in template path)
```

`packages/social/src/index.tsx:84–214`: All `<Composition>` registrations hardcode `width={1080} height={1080 or 1350}`.

**PNG output hardcoded:**
`packages/social/render-server.ts:64`: `imageFormat: "png"` — no JPEG/WebP option.

**Slide count formulas** (all in `render-server.ts`):

| Template | Formula | Notes |
|----------|---------|-------|
| comparison-stunning | `1 + tools.length + 1` = 4 | Fixed |
| comparison-stunning-3 | `1 + tools.length + 1` = 5 | Fixed |
| use-case-verdict | `1 + verdicts.length + 2` = 4–11 | **BUG: max 11 violates Instagram 10-limit** |
| single-tool-spotlight | `useCases.length >= 3 ? 5 : 4` | OK |

**BUG (priority quick-win):** `use-case-verdict-per-tool` caps verdicts at 8 via `.slice(0, 8)` in `buildInput` (`useCaseVerdictPerTool.ts:54`), but `1 + 8 + 2 = 11 slides`. Instagram limit is 10. The clamp must be `.slice(0, 7)` (1+7+2=10).

**Fields meaningless for Reel/Story:**
- `defaultSlideCount` — meaningless for video
- `estimatedCostUsd` as a static number — insufficient for multi-backend cost modelling
- `CANVAS_H_4_5` / `CANVAS_W` — Reel is 9:16 (1080×1920), Story is also 9:16

---

### 1.3 Generation Classes: Frontmatter-Derived vs. LLM-Live

**The distinction is not in the schema. It must be inferred from code.**

**All current templates = frontmatter-derived:**
- `buildInput()` reads `article.domainExtras` directly — no Anthropic calls
- `render()` calls Remotion via dynamic import — no Anthropic calls
- Captions and hashtags: private static functions (`buildCaption()`, `buildHashtags()`) per template definition — hardcoded string templates per locale

Example from `packages/social/src/templates/definitions/useCaseVerdictPerTool.ts:130–151`: `buildCaption()` is a plain function assembling strings with no LLM involvement.

**The LLM-live pipeline** (separate system — see important note below):
`packages/pipelines/src/article/social-image/` contains a DIFFERENT social image pipeline that predates the template system:
- `steps.ts:generateHookWithGate()` — LLM-driven hook with 2-retry + validation loop
- `hookEngine.ts` — pure hook utilities (pattern selection, fallback, article-type inference)
- `hookValidator.ts` — quality gate (word count 3–7, forbidden words, pattern-specific rules)
- `hookPrompt.ts` — LLM system prompts, 5 pattern-specific variants

**IMPORTANT:** The `hookEngine` / `hookValidator` pipeline is **not called by any template in `packages/social/src/templates/`**. Templates assemble hooks manually. The two systems are currently disconnected.

**Where the frontmatter-derived path is evidenced:**
- `comparisonStunning.ts:94–109`: hook assembled inline with `pattern: "curiosity_gap"` hardcoded — no call to `hookEngine.ts`
- `useCaseVerdictPerTool.ts:48–55`: `buildInput` = pure DB lookup (toolLookup) + frontmatter slice
- No template definition imports from `packages/pipelines/`

---

### 1.4 CRITICAL FINDING — Structured Data in Generated Articles

**Question: do generated articles have `pros`, `cons`, `pricing`, `features`, `useCases` in `domainExtras`?**

**Answer: depends on collection.**

**For `comparisons` collection (generated by DraftStep):**
`packages/pipelines/src/article/steps/draft.ts:111–165` instructs the LLM to emit:
```
<!-- DOMAIN_EXTRAS: { "useCaseVerdicts": [...], "toolSlugs": [...], "winner": "...", "verdict": "...", "testMethodology": "..." } -->
```
✅ Comparison articles generated by DraftStep DO have the structured fields that `use-case-verdict-per-tool` and `comparison-stunning` need.

**For `tools` collection (the `single-tool-spotlight` target):**
`packages/adapters/astro-sync/src/import/parse-frontmatter.ts:96–99`: Tool article extras (`pros`, `cons`, `pricingTier`, `priceFrom`, `features`, `useCases`, `rating`) come from **Astro YAML only** — they are everything not in `TYPED_FIELDS`.

`DraftStep` does NOT write `pros`, `cons`, `features`, `useCases`, `rating`, `pricing` for tool articles. The LLM output block for tool articles contains only: `author`, `category`, `intentType`, `bottomLinksVariant`, `tags`, `faq`, `primaryTool`.

**THE GAP:** A programmatically generated `tools` article (not Astro-imported) will have minimal `domainExtras` and will fail the `single-tool-spotlight` eligibility check (`pros.length < 2`).

**Impact assessment:**
- KI-Wissensraum today: 108 tool articles exist via Astro import → full structured data → `single-tool-spotlight` works.
- Future: if tool articles are generated via pipeline (not imported), they will not be eligible for `single-tool-spotlight` or any frontmatter-derived tool template.
- The "automated content operator" vision requires this gap to be closed.

**Proposed fix (for Spec 54l):** Extend `DraftStep` to emit `pros`, `cons`, `features`, `useCases`, `pricing`, `pricingTier`, `rating` for tool-category articles, or create a dedicated `EnrichToolFrontmatterStep`. Prerequisite for automated end-to-end tool content.

---

### 1.5 Hook Generation

**Central hook engine lives at:** `packages/pipelines/src/article/social-image/hookEngine.ts`
- `selectPattern(articleId, type)` — deterministic pattern via hash (same article → same pattern always)
- `inferArticleType(article)` — heuristic: comparison / list / howto / guide / review
- `programmaticFallbackHook()` — hardcoded DE fallback for LLM failure
- `buildPromiseBlock(pattern, locale)` — 2-line promise text per pattern

**LLM-live hook generation** (`steps.ts:294–424`):
- `generateHookWithGate()`: LLM call → `validateHook()` → 2 retries → fallback
- Validation (`hookValidator.ts`): word count 3–7, highlight 1–2 words, 9 forbidden hyperbolic words, pattern-specific rules (e.g. `superlative_question` must end `?`)

**Template hook generation (current state):**
- `comparisonStunning.ts:94–109`: manually assembles `HookOutput` — hardcodes `"curiosity_gap"` pattern, no validation
- `comparisonStunning3.ts`: identical pattern
- `useCaseVerdictPerTool.ts`: no explicit hook in `buildInput`; hook is baked into composition directly
- `singleToolSpotlight.ts`: TBD (Spec 54f in progress)

**Quality gap:** Template hooks have zero validation. No word-count check, no forbidden-word gate, no retry. The LLM pipeline has all of this; templates bypass it entirely.

---

### 1.6 Render Path

**Render-server** (`packages/social/render-server.ts`):
- 4 exported functions: `renderListCarousel`, `renderListCarouselStunning`, `renderSingleToolSpotlight`, `renderUseCaseVerdictCarousel`
- Pattern: `getBundle()` → `getCompositions()` → loop `slideIndex` → `renderStill({ imageFormat: "png" })` → collect `Buffer[]`
- Bundle cached in module-level `bundleUrl` variable
- No abstraction: each function hardcodes Composition ID and slide count formula directly

**Remotion coupling:**
- All render functions call `@remotion/renderer` functions directly (`renderStill`, `getCompositions`)
- No interface or contract between `TemplateDefinition` and Remotion
- Adding a second render backend (Video-AI) requires a new code path alongside `render-server.ts` with no clean seam

**Dynamic import isolation:**
Template definitions call `await import("../../../render-server.ts")` — this is the only mechanism preventing Remotion from being bundled into the API startup context.

---

### 1.7 Platform / Channel Assumptions

**Instagram is never declared — it's implied everywhere:**

| What | Where | Overridable? |
|------|-------|-------------|
| Dimensions 1080×1350 | `safeZones.ts:3–5`, `index.tsx:146,156,182` | ❌ |
| PNG format | `render-server.ts:64` | ❌ |
| 10-slide limit | `list-carousel/types.ts:123` (Zod `max(10)`) | ❌ |
| 6–7 hashtags | `buildHashtags()` in each template | ❌ |
| `@toolwiki.ai` handle | `useCaseVerdictPerTool.ts:80`, `types.ts:34` | ✅ brandTokens (partial) |
| `toolwiki.ai` website | `useCaseVerdictPerTool.ts:79`, caption strings | ✅ brandTokens (partial) |
| Caption CTA format | per-template `buildCaption()` | ❌ |

**`brandTokens` gap:** `context.brandTokens ?? DEFAULT_BRAND_TOKENS` exists in `RenderContext`, but `useCaseVerdictPerTool.ts:79–80` still hardcodes `"toolwiki.ai"` and `"@toolwiki.ai"` as literal strings instead of reading from `context.brandTokens.social.*`.

**Caption format is Instagram-specific in structure:** Line breaks, `"→ Vollständiger Vergleich: domain/slug"` CTA pattern, hashtag block appended at end — assumes Instagram/Facebook text formatting. LinkedIn uses different CTA conventions; TikTok has different caption length constraints.

---

## Part 2 — Architecture Plan

### 2.1 Scalable Template Schema

**Two axes to separate cleanly:**
- **Output format** — determines render backend, dimensions, media type (PNG vs MP4)
- **Channel** — determines caption format, hashtag strategy, posting constraints

**Proposed `TemplateDefinition<TInput>`:**

```typescript
interface TemplateDefinition<TInput = unknown> {
  // Identity (unchanged)
  key: TemplateKey;
  displayName: string;
  description: string;

  // --- NEW: Two explicit axes ---
  outputFormat: OutputFormat;         // "carousel" | "reel" | "story"
  compatibleChannels: Channel[];      // e.g. ["instagram"] | ["instagram", "tiktok"]

  // --- NEW: Generation class (first-class) ---
  generationClass: GenerationClass;   // "frontmatter-derived" | "llm-live"

  // Cost (reflects generationClass)
  estimatedCostUsd: number;           // Remotion-only for frontmatter-derived
                                      // render + LLM tokens for llm-live

  // Slide count: carousel only
  defaultSlideCount?: number;

  // --- NEW: Mandatory hook contract (see 2.3) ---
  generateHook: (article: Article, input: TInput, locale: Locale) => Promise<HookOutput>;

  // Unchanged core contract
  eligibility: EligibilityPredicate;
  buildInput: (article: Article, discovery: ArticleDiscovery) => Promise<TInput>;
  render: (context: RenderContext<TInput>) => Promise<RenderResult>;

  // --- NEW: Channel-aware caption/hashtag ---
  buildCaption: (input: TInput, channel: Channel, locale: Locale, article: Article) => string;
  buildHashtags: (input: TInput, channel: Channel, locale: Locale) => string[];

  // --- NEW: Content planner metadata (see 2.5) ---
  plannerMeta: TemplatePlannerMeta;

  mockFixtures: MockFixtureMap;
}

type OutputFormat     = "carousel" | "reel" | "story";
type Channel          = "instagram" | "tiktok" | "linkedin";
type GenerationClass  = "frontmatter-derived" | "llm-live";

interface TemplatePlannerMeta {
  contentType: "comparison" | "tool-spotlight" | "use-case" | "news" | "concept";
  estimatedEngagementTier: "low" | "medium" | "high";
  recycleableFromExistingArticle: boolean;
  requiresLiveData: boolean;  // false = can pre-render; true = generate on demand only
}
```

**How existing templates map to the new schema:**

| Template | outputFormat | channels | generationClass | contentType |
|----------|-------------|----------|-----------------|-------------|
| `comparison-stunning` | `carousel` | `["instagram", "tiktok"]` | `frontmatter-derived` | `comparison` |
| `comparison-stunning-3` | `carousel` | `["instagram", "tiktok"]` | `frontmatter-derived` | `comparison` |
| `use-case-verdict-per-tool` | `carousel` | `["instagram", "tiktok"]` | `frontmatter-derived` | `use-case` |
| `single-tool-spotlight` | `carousel` | `["instagram", "tiktok"]` | `frontmatter-derived` | `tool-spotlight` |

**LinkedIn extensibility test:** Templates declare `compatibleChannels: ["instagram", "linkedin"]`. `buildCaption` receives `channel: "linkedin"` and returns a LinkedIn-formatted string. Existing templates that declare only `["instagram"]` are unaffected. The schema passes the LinkedIn-without-breakage test.

---

### 2.2 Generation Classes as First-Class Concept

**`frontmatter-derived`** — current de-facto standard:
- `buildInput()` reads `article.domainExtras` + optional DB lookup (tool icons via `buildToolLookup`)
- `generateHook()` may be the one LLM touchpoint (see 2.3)
- `render()` calls Remotion via existing dynamic import pattern
- `estimatedCostUsd` = Remotion render cost (0.006–0.01)
- Runner implication: can be pre-rendered at article import/discovery time

**`llm-live`** — not yet in template system, prepared structurally:
- `buildInput()` calls Anthropic to generate slide content live
- `generateHook()` same as frontmatter-derived (hook engine, no change)
- `render()` unchanged — Remotion renders the visual output
- `estimatedCostUsd` = render cost + LLM tokens (~$0.01 total)
- Runner implication: render only on explicit user trigger or scheduled generation (not at import time)

**Where to enforce in the runner:**
`apps/api/src/workers/discoveryWorker.ts` currently triggers all eligible templates at discovery time. After schema change, it gates on `generationClass`:
- `frontmatter-derived` → render immediately
- `llm-live` → enqueue for explicit trigger only

---

### 2.3 Hook as Mandatory Contract

**Problem:** Template hooks are assembled inline with no validation. `hookEngine` / `hookValidator` exist and are mature, but no template uses them.

**Solution:** `generateHook()` as a required field on every `TemplateDefinition`. TypeScript enforces it — templates that don't implement it fail to compile.

**For frontmatter-derived templates — the one-LLM-touchpoint pattern:**

The hook is the one place where even a frontmatter-derived template calls an LLM. Justification:
1. Hook quality is the primary engagement driver — worth a small LLM call (~$0.001)
2. `programmaticFallbackHook()` means $0 cost on LLM failure — no quality cliff
3. Hooks are generated once per article+template and cached in the post record

**Implementation path:**
- `generateHook()` calls `generateHookWithGate()` from `packages/pipelines/src/article/social-image/steps.ts:359–424`
- Pattern selected via `selectPattern()` (deterministic by article ID — same article always gets same pattern)
- Validation: word count 3–7, highlight 1–2 words, 9 forbidden hyperbolic words, pattern-specific rules (all existing)
- 2 retries → `programmaticFallbackHook()` on exhaustion
- Result passed to `render()` via `RenderContext<TInput>`

**UNCLEAR:** Does `RenderContext` currently carry a `hookOutput` field? Check `packages/social/src/templates/types.ts` before implementing — if not, this field must be added in Spec 54h.

**Pattern upgrade for comparison templates:** The hardcoded `"curiosity_gap"` in `comparisonStunning.ts:94–109` gets replaced by `generateHook()`. `inferArticleType()` will classify comparison articles as `"comparison"`, which maps to `"superlative_question"` in `PATTERN_MAP` — a better pattern for two-tool comparisons than the current hardcoded curiosity gap.

**All quality enforcement uses existing code** — nothing new to build, just wire it in.

---

### 2.4 Render Backend Abstraction

**Current state:** `render-server.ts` is a Remotion-specific monolith. Templates call it via dynamic import. No interface exists between `TemplateDefinition` and the renderer.

**Proposed `RenderBackend` interface:**

```typescript
// packages/social/src/render-backends/types.ts
interface RenderBackend {
  id: string;  // "remotion-carousel" | "remotion-reel" | "video-ai"
  supportedFormats: OutputFormat[];

  render(
    compositionId: string,
    input: Record<string, unknown>,
    options: RenderOptions
  ): Promise<RenderBackendResult>;
}

interface RenderOptions {
  slideCount?: number;      // carousel only
  durationFrames?: number;  // reel/story only
  fps?: number;
  mediaFormat: "png" | "jpg" | "mp4" | "webp";
  width: number;
  height: number;
}

interface RenderBackendResult {
  files: Buffer[];
  type: "images" | "video";
  metadata: { width: number; height: number; count: number };
}
```

**Backend registry:**
- `remotion-carousel` — wraps existing `render-server.ts`, `supportedFormats: ["carousel"]`
- `remotion-reel` — future Remotion video composition, `supportedFormats: ["reel", "story"]`
- `video-ai` — future generative video API, `supportedFormats: ["reel"]`

**Migration path (no breaking changes):**
Wrap existing `render-server.ts` in `RemotionCarouselBackend implements RenderBackend`. All existing templates call `RemotionCarouselBackend.render()` via the interface. Behavior is identical. Future backends implement the same interface.

**Dimension resolution:**

```typescript
const DIMENSIONS: Record<OutputFormat, { width: number; height: number }> = {
  carousel: { width: 1080, height: 1350 },  // 4:5 Instagram portrait
  reel:     { width: 1080, height: 1920 },  // 9:16 vertical
  story:    { width: 1080, height: 1920 },  // 9:16 vertical
};
```

This single table replaces the hardcoded values scattered across `safeZones.ts` and `index.tsx`.

---

### 2.5 Content Planner Provisions

The planner doesn't need to be built now — but the schema must carry the hooks it will need.

**Template-level metadata (static, in `TemplatePlannerMeta`):**
- `contentType` — what category of content this produces
- `estimatedEngagementTier` — editorial estimate of reach (drives scheduling priority)
- `recycleableFromExistingArticle` — true for all current templates (article → post)
- `requiresLiveData` — false = pre-generate at import; true = generate on demand

**Post-level columns needed on `social_posts` (DB, dynamic):**
These do not exist today and must be added in Spec 54k:
- `outputFormat` — what format was generated (carousel / reel / story)
- `channel` — target channel (instagram / tiktok / linkedin)
- `scheduledFor` — timestamp for content calendar
- `publishedAt` — actual publish timestamp

**What already exists and can be reused:**
- `social_posts.articleId` — many-to-one with articles (recycling: one article → many posts)
- `articles.clusterId` → cluster → `contentPillars` → scheduling priority
- `social_posts.createdAt + templateKey` → "this article already has a comparison post from last week"

The planner's core query — "what's scheduled, what needs generating, what can be recycled" — is satisfiable with these columns. No further schema changes needed for basic planner functionality.

---

## Part 3 — Quick-Wins, Risks, Ideas, Open Decisions

### Quick-Wins

**QW-1: Fix UseCaseVerdictCarousel slide count bug**
`useCaseVerdictPerTool.ts:54`: `.slice(0, 8)` → `.slice(0, 7)`
Reason: `1 + 8 + 2 = 11 slides` but Instagram limit is 10. `1 + 7 + 2 = 10` is the correct cap.
Risk: none. Effort: ≤5 min.

**QW-2: Move hardcoded domain/handle to brandTokens in useCaseVerdictPerTool**
`useCaseVerdictPerTool.ts:79–80`: `"toolwiki.ai"` and `"@toolwiki.ai"` are literal strings.
Should read from `context.brandTokens?.social?.websiteUrl ?? DEFAULT_BRAND_TOKENS.social.websiteUrl`.
The other templates may already do this — verify and align.
Risk: none. Effort: 15 min.

**QW-3: Hashtag strategy fix**
Current: 6–7 tags, hardcoded per template, all in one locale. Target: max 7 tags, locale-aware. EN-posts: English-only. DE-posts: context-aware mix of German KI-tags (`#KITools`, `#KIVergleich`, ...) + English AI-tags — German users search "KI", not "AI". The current templates already have a DE/EN branch in `buildHashtags()` but the German tags may be inconsistent. Audit + align all templates in Spec 54i.
Risk: none. Effort: 30 min.

**QW-4: Year-drift in eyebrow text**
Spec 54f uses `"KI-TOOL IM CHECK · {YEAR}"`. Verify the year is `new Date().getFullYear()`, not a hardcoded `2024` or `2025`.
Risk: none. Effort: 5 min when building 54f.

**QW-5: brandTokens consistency audit**
Caption strings in all templates embed `toolwiki.ai/${slug}` directly. Should derive domain from `context.brandTokens`. Do a full pass across all 3 (soon 4) template definitions to confirm consistency.
Risk: none. Effort: 30 min.

---

### Risks

**R-1: Schema migration requires all templates at once**
When `generateHook()` becomes a required field on `TemplateDefinition`, TypeScript enforces it — all 4 templates must implement it in the same PR. If partial, the build breaks. Manageable with 4 templates, but worth noting.

**R-2: Hook LLM cost for first-generation run**
If `generateHook()` adds ~$0.001 per render, first-time generation of 108 tool articles = ~$0.11 via `single-tool-spotlight`. Acceptable per the project's quality > cost policy. Should be logged in cost-tracker.

**R-3: DraftStep structured data gap (silent eligibility failure)**
Tool articles generated via pipeline (not Astro-imported) will fail `single-tool-spotlight` eligibility silently — `eligible: false`, no error, no alert. If pipeline-generated tool articles become common, this produces a confusing "no posts generated" outcome with no visible cause. Needs monitoring or a fix to DraftStep (Spec 54l) before automated tool content is enabled.

**R-4: hookEngine package location blocks `generateHook()` implementation**
`packages/pipelines/src/article/social-image/hookEngine.ts` cannot be imported from `packages/social` without a cross-package dependency that doesn't currently exist. Must resolve OD-3 before Spec 54h can be implemented.

**R-5: single-tool-spotlight is in-flight**
Spec 54f's Remotion/composition work is schema-independent and can proceed. But 54f will need minor additions in 54g: adding `generationClass`, `compatibleChannels`, `outputFormat`, `plannerMeta` as fields. These are purely additive — no re-render needed.

---

### Improvement Ideas

**I-1: Hook caching**
Hooks are deterministic for frontmatter-derived templates (`selectPattern()` hashes article ID). Cache `HookOutput` on `social_posts` or `article_discovery` so re-renders of the same post don't re-call the LLM.

**I-2: LLM-generated captions**
Current static captions are formulaic. An LLM-generated caption per post would materially improve engagement. `buildCaption` could become optionally async — the `llm-live` generation class already accommodates this. Quality > cost applies here.

**I-3: Channel-adaptive hashtag table**
Replace hardcoded arrays with a per-channel lookup:
- Instagram: 5–7 niche-specific tags
- LinkedIn: 3–5 professional/industry tags
- TikTok: 3–5 trending + niche tags

No LLM needed — a static lookup table per channel covers it.

**I-4: Composition ID as template metadata**
`render-server.ts` hardcodes Composition IDs (`"ListCarouselStunning"`, etc.) inside each render function. Moving `compositionId: string` to `TemplateDefinition` (or the `RenderBackend` call) makes the registry self-describing and removes the implicit coupling.

---

### Open Decisions — RESOLVED 2026-05-14

**OD-1: `generateHook()` — required immediately. ✅**
Required from day 1 of Spec 54h. All 4 templates implement `generateHook()` in one PR. TypeScript enforces the contract.

**OD-2: 54f proceeds on current schema. ✅**
54f builds `single-tool-spotlight` on the current schema. Spec 54g adds the new fields additively afterward — Remotion/composition work is schema-independent.

**OD-3: `hookEngine` moves to `packages/core`. ✅**
`hookEngine.ts` + `hookValidator.ts` + `hookPrompt.ts` move to `packages/core` in Spec 54h. Pure TypeScript, no DB, no Remotion — available to all packages without circular dependencies.

**OD-4: Hashtag count — 7 max, DE-posts cover both KI and AI search intents. ✅**
7 hashtags max. EN-posts: English-only. DE-posts: mix of German KI-variants and English AI-variants so the post ranks for both "beste KI" and "best AI" searches on Instagram — not every tag needs both, but the tag set as a whole should cover both search intents. No rigid per-tag rule; the set of 7 should collectively reach both audiences.

**OD-5: `"reel"` in `OutputFormat` from day 1 of 54g. ✅**
`OutputFormat = "carousel" | "reel" | "story"` in Spec 54g. Zero implementation cost, forward-compatible. No `RemotionReelBackend` or `VideoAIReelBackend` until a reel template is actually being built.

---

## Part 4 — Proposed Sub-Spec Sequence

| Spec | What | Risk | Effort | Depends on |
|------|------|------|--------|-----------|
| **54f** | `single-tool-spotlight` template | Low | 3–4h | — |
| **54g** | Schema formalization: add `outputFormat`, `compatibleChannels`, `generationClass`, `plannerMeta`; fix QW-1 + QW-2 | Low | 2–3h | 54f done |
| **54h** | Mandatory hook contract: `generateHook()` required; wire hookEngine; move to packages/core | Medium | 3–4h | 54g, OD-3 resolved |
| **54i** | Channel-aware caption/hashtag: `buildCaption(channel)` + `buildHashtags(channel)` on schema; **Instagram + TikTok live**; fix QW-3 + QW-5 | Medium | 3–4h | 54g |
| **54j** | Render backend abstraction: `RenderBackend` interface + `RemotionCarouselBackend` wrapper | Medium | 3–4h | 54g |
| **54k** | Content planner metadata: add `outputFormat`, `channel`, `scheduledFor`, `publishedAt` to `social_posts` | Low | 2h | 54g |
| **54l** | DraftStep structured data gap: emit `pros`, `cons`, `features`, `useCases`, `pricing` for tool-category articles | Medium | 3–4h | independent |

### Spec Rationale

**54f first:** In-flight, unblocked, composition work is schema-independent.

**54g second:** Purely additive fields — no behavior change, no re-renders. Establishes the schema foundation all subsequent specs build on. Also fixes the slide-count bug (QW-1) and brandTokens consistency (QW-2).

**54h and 54i in parallel after 54g:** Both depend on 54g schema but not on each other. Hook contract (54h) is medium-risk due to the hookEngine package move. Caption/hashtag layer (54i) delivers working Instagram + TikTok implementations — not just structural groundwork. TikTok specifics: shorter caption, 3–5 tags (TikTok algo), different CTA tone vs Instagram. DE-posts on both channels cover KI/AI dual search intent in the tag set.

**54j after 54g:** Render backend abstraction is structural plumbing — no user-visible change. Safe to do before or after 54h/54i.

**54k after 54g:** DB columns only. Migration is additive with safe defaults. Enables planner queries.

**54l independent:** Fixes the DraftStep gap for tool articles. Can be done any time, but must be done before automated pipeline-generated tool content is expected to produce social posts.

---

## File Reference

| File | Role |
|------|------|
| `packages/social/src/templates/types.ts` | `TemplateDefinition`, `TemplateKey`, `RenderContext` — schema root |
| `packages/social/src/templates/bootstrap.ts` | Template registration |
| `packages/social/src/templates/definitions/` | One file per template |
| `packages/social/src/templates/adapters/` | Article → template input adapters |
| `packages/social/render-server.ts` | Remotion render functions (to be wrapped in Spec 54j) |
| `packages/social/src/index.tsx` | Remotion Composition registration |
| `packages/social/src/compositions/list-carousel/safeZones.ts` | Dimension constants |
| `packages/pipelines/src/article/social-image/hookEngine.ts` | Hook engine (move to `packages/core` in Spec 54h) |
| `packages/pipelines/src/article/social-image/hookValidator.ts` | Hook quality gate |
| `packages/pipelines/src/article/social-image/steps.ts` | `generateHookWithGate()` — the LLM hook call with retry/validation |
| `packages/pipelines/src/article/steps/draft.ts` | Article generation — writes `domainExtras` |
| `packages/adapters/astro-sync/src/import/parse-frontmatter.ts` | Astro import → `domainExtras` |
| `packages/db/src/schema/content.ts` | `social_posts` + `articles` schema |
| `apps/api/src/workers/discoveryWorker.ts` | Triggers template rendering post-discovery |
