# Theme 57 Backend Inventory (Social Media / Remotion)

**Date:** 2026-05-17  
**Investigator:** Claude Code via discovery prompt  
**Repository:** `/Users/marcelklaczinski/WebstormProjects/marketing-automation`

---

## Area A: Templates Inventory

### A.1 Template Source Files

**Directory Structure:**
```
packages/social/
├── src/
│   ├── compositions/           # Remotion composition components (slide-level UI)
│   │   ├── list-carousel/       # 2-5 tool comparison carousel
│   │   ├── single-tool-spotlight/  # 4-5 slide single-tool detail
│   │   └── use-case-verdict/    # Dynamic verdict carousel (1 cover + N use-cases + 2 recap)
│   ├── shared/                 # Reusable Remotion components (icons, pricing chip, footer)
│   ├── templates/              # Template definitions + adapters + registry
│   │   ├── definitions/        # Template business logic + fixture data
│   │   ├── adapters/          # Data transformation (tool lookup, comparison context, etc.)
│   │   └── lib/               # writeSlides() helper
│   └── lib/theme.ts            # getThemeTokens(), pricingColor()
├── render-server.ts            # Programmatic Remotion render entry (renderListCarousel, etc.)
├── index.tsx                   # Remotion root with <Composition> registrations
└── CLAUDE.md
```

**Compositions (18 files total):**
- `list-carousel/`: ListCarousel, ListCarouselStunning (variants), CoverSlide, CoverSlideStunning, ToolSlide, ToolSlideStunning, EndSlide, EndSlideStunning
- `single-tool-spotlight/`: SingleToolSpotlightComposition, CoverSlide, StrengthsSlide, PricingForWhomSlide, UseCaseDetailSlide, EndSlide
- `use-case-verdict/`: UseCaseVerdictComposition, UseCaseVerdictCoverSlide, UseCaseVerdictSlide, UseCaseVerdictRecapSlide

### A.2 Template Selection Logic

**Registration:** Code-based registry pattern (no DB enum).
- Templates are registered in `packages/social/src/templates/bootstrap.ts` at API startup via `bootstrapTemplates()`
- `templateRegistry` singleton stores all templates keyed by `TemplateKey` union
- `listEligibleFor(article, discovery)` returns templates whose `eligibility(article, discovery)` predicate returns true

**Template eligibility logic:**
Each template has a pure, synchronous `eligibility: (article, discovery) => EligibilityResult` predicate:
- Checks article collection (e.g. `collection === "comparisons"`)
- Checks frontmatter field presence/bounds (e.g. `pros.length >= 2 && <= 5`)
- Returns `{ eligible: true }` or `{ eligible: false, reason, requirements }`

**Selection mechanism:**
1. Backend endpoint `/api/articles/:articleId/social-posts/generate` receives `{ format, theme, variant }`
2. Pipeline `article:social-image` calls `templateRegistry.listEligibleFor(article, discovery)` to find candidates
3. Frontend component `TemplateGallery.vue` displays eligible templates + "Not Available" stubs for ineligible ones
4. User clicks "Generate" on a template → backend re-checks eligibility, then renders

**No manual selection in current UI** — templates are auto-discovered. Future: content planner may pre-select templates by campaign rules.

### A.3 Template Catalog

| Name | Path | Dims | Slides | Aspect | Platform | Status | Brand-Aware | Hardcoded Items |
|------|------|------|--------|--------|----------|--------|-------------|-----------------|
| **comparison-stunning** | `definitions/comparisonStunning.ts` | 1080×1350 | 4 | 4:5 (IG Story) | Instagram, TikTok | Production | ✅ Partial | Pricing colors (green/blue/amber), footer layout |
| **comparison-stunning-3** | `definitions/comparisonStunning3.ts` | 1080×1350 | 5 | 4:5 | Instagram, TikTok | Production | ✅ Partial | Pricing colors, footer |
| **use-case-verdict-per-tool** | `definitions/useCaseVerdictPerTool.ts` | 1080×1350 | 1+N+2 (dyn) | 4:5 | Instagram, TikTok | Production | ✅ Partial | Pricing colors |
| **single-tool-spotlight** | `definitions/singleToolSpotlight.ts` | 1080×1350 | 4-5 | 4:5 | Instagram, TikTok | Production | ✅ Partial | Pricing colors, footer layout |
| *Future: news-slide* | (stubbed in types) | — | — | — | — | Stub | — | — |
| *Future: concept-explainer-deck* | (stubbed in types) | — | — | — | — | Stub | — | — |
| *Future: price-comparison* | (stubbed in types) | — | — | — | — | Stub | — | — |
| *Future: pro-con-verdict* | (stubbed in types) | — | — | — | — | Stub | — | — |

**Current state:** 4 production templates (all Stunning variants), all 1080×1350 (Instagram Story/TikTok), all require frontmatter enrichment.

### A.4 Template Composition Interface

**Common TypeScript Props Interface** (from `compositions/list-carousel/types.ts`):

```typescript
export const brandTokensSchema = z.object({
  colors: z.object({
    primary: z.string().default("oklch(64% 0.16 248)"),
    primaryHue: z.number().default(248),
    accent: z.string().default("oklch(72% 0.15 168)"),
    surface: z.string().default("#ffffff"),
    surfaceDark: z.string().default("oklch(16% 0.02 250)"),
    ink: z.string().default("oklch(20% 0.025 250)"),
    inkMuted: z.string().default("oklch(45% 0.025 250)"),
    wikiCream: z.string().default("#fef9ec"),
  }).default({}),
  typography: z.object({
    fontFamily: z.string().default("Inter Variable, Inter, sans-serif"),
    headingWeight: z.number().default(800),
    bodyWeight: z.number().default(400),
    eyebrowLetterSpacing: z.string().default("0.08em"),
  }).default({}),
  voice: z.object({
    locale: z.string().default("de-DE"),
    addressForm: z.string().default("du"),
    forbiddenWords: z.array(z.string()).default([]),
    signaturePhrases: z.array(z.string()).default([]),
  }).default({}),
  social: z.object({
    instagramHandle: z.string().default("@toolwiki.ai"),
    websiteUrl: z.string().default("toolwiki.ai"),
    logoAssetKey: z.string().default("main"),
  }).default({}),
});
export type BrandTokens = z.infer<typeof brandTokensSchema>;

export const listCarouselInputSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  variant: z.enum(["editorial", "stunning"]).default("editorial"),
  brandTokens: brandTokensSchema.default({}),
  slideIndex: z.number().int().default(0),
  cover: z.object({
    eyebrow: z.string().max(40),
    headlineLead: z.string().max(30),
    headlineHighlight: z.string().max(40),
    headlineTrail: z.string().max(20).optional(),
    subhead: z.string().max(80).optional(),
    hookOutput: hookOutputSchema.optional(),
  }),
  tools: z.array(toolSchema).min(2).max(10),
  end: z.object({
    headline: z.string().max(40),
    headlineHighlight: z.string().max(40),
    articleUrl: z.string(),
    qrCodeUrl: z.string().optional(),
    closer: endCloserSchema.optional(),
    toolRecap: z.array(z.string()).optional(),
  }),
});
export type ListCarouselInput = z.infer<typeof listCarouselInputSchema>;
```

**Key fields per template:**
- `ListCarouselInput`: theme, variant, cover hook+headline, tools[rank/name/domain/strengths/pricing/icon], end hook, article URL, footer branding
- `SingleToolSpotlightInput`: theme, locale, tool object (name, pros, cons, features, useCases, rating, pricing), web/IG metadata
- `UseCaseVerdictInput`: theme, locale, tools[], verdicts[] (use-case, winner, reason)

**Interface contract:**
Each composition receives `slideIndex` (which slide to render) and `totalSlides` (for progress indicator). Remotion server iterates `slideIndex` from 0 to totalSlides-1, calling `renderStill()` once per slide.

### A.5 Hardcoded Values per Template (Critical for Brand Migration)

**Pricing Colors (in `lib/theme.ts`)**
```typescript
export function pricingColor(tier: "free" | "freemium" | "paid"): string {
  switch (tier) {
    case "free":     return "#22c55e";  // green (Tailwind 500)
    case "freemium": return "#3b82f6";  // blue (Tailwind 500)
    case "paid":     return "#f59e0b";  // amber (Tailwind 500)
  }
}
```
**Usage:** All tool-slide pricing chips call `pricingColor(tool.pricing.tier)` directly. These hex values are hardcoded and NOT part of `BrandTokens` schema.

**Footer Layout (in `shared/BrandLogo.tsx`)**
```typescript
export function BrandFooter({ websiteUrl, instagramHandle, theme, fontFamily, slideLabel }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontFamily, fontSize: 20, fontWeight: 700, color: theme.ink }}>
          {websiteUrl}  {/* hardcoded layout: website on top */}
        </span>
        <span style={{ fontFamily, fontSize: 16, color: theme.inkMuted }}>
          {instagramHandle}  {/* hardcoded layout: Instagram handle below */}
        </span>
      </div>
      <span style={{ fontFamily, fontSize: 18, fontWeight: 600, color: theme.inkMuted }}>
        {slideLabel}  {/* hardcoded right alignment */}
      </span>
    </div>
  );
}
```
**Hardcoded layout:** 20px website font, 16px Instagram font (spacing: 2px gap), 18px slide label on right. No token control over spacing/sizing.

**Rank Badge Font Size (in `compositions/list-carousel/ToolSlideStunning.tsx`)**
```typescript
<span style={{
  fontFamily,
  fontSize: 72,  // HARDCODED big number
  fontWeight: 900,  // HARDCODED weight
  color: theme.brand,  // uses theme
  letterSpacing: "-0.03em",  // HARDCODED tight spacing
  lineHeight: 1,
}}>
  {rankLabel}
</span>
```
**Hardcoded:** 72px font size for rank badge, 900 weight, -0.03em letter spacing. Not parameterized via `BrandTokens`.

**Theme Colors (in `lib/theme.ts` — these ARE tokenized via `BrandTokens`)**
```typescript
export function getThemeTokens(
  brandTokens: BrandTokens | undefined,
  theme: "dark" | "light"
): ThemeTokens {
  const c = brandTokens?.colors;
  if (theme === "dark") {
    return {
      bg:           c?.surfaceDark   ?? DARK_DEFAULTS.surfaceDark,  // oklch(16% 0.02 250)
      surface:      "oklch(22% 0.02 248)",  // HARDCODED (no token override)
      ink:          "oklch(95% 0.01 250)",
      inkMuted:     "oklch(70% 0.025 250)",
      brand:        c?.primary        ?? DARK_DEFAULTS.primary,
      accent:       c?.accent         ?? DARK_DEFAULTS.accent,
      eyebrowColor: "oklch(85% 0.10 168)",  // HARDCODED bright eyebrow
    };
  }
  // Light theme uses white bg + tokenized ink/brand/accent
}
```
**Tokenized:** `surfaceDark`, `primary`, `accent`. **Hardcoded:** `surface` (medium dark), `eyebrowColor` (bright orange).

### A.6 Multi-language Support

**Current state:** Minimal locale support.
- `ListCarouselInput`, `UseCaseVerdictInput`, `SingleToolSpotlightInput` all accept `locale: "de" | "en"` parameter
- Text strings (headlines, tool descriptions, eyebrows) are passed in by the pipeline — they come from frontmatter, not generated by the composition
- No locale-specific visual variants (fonts, spacing, layout change with language)

**i18n in frontend UI:**
- `apps/web/src/i18n/de/social.ts` and `en/social.ts` contain UI labels for the social-posts admin page ("Generate Carousel", "Template Gallery", "Rendering…", etc.)
- These are **not** used in the carousel slides themselves — slides use input data passed from the pipeline

**Decision:** Slides are locale-agnostic in layout; locale only affects the **data** (titles, captions, hashtags) coming from the LLM, not the visual design.

---

## Area B: Pipeline / Generation Flow

### B.1 Generation Pipeline

**Pipeline name:** `article:social-image` (in `packages/pipelines/src/article/social-image/`)

**Step sequence (8 steps):**
1. **LoadArticleStep** — fetch article + project + brand tokens from DB
2. **ExtractToolsStep** — parse tools from article frontmatter + discovery metadata
3. **ResolveAssetsStep** — resolve tool icons via the icon-resolver chain (simple-icons → iconify → lobe-icons → deterministic avatar)
4. **RenderSlidesStep** — dynamic dispatch to appropriate Remotion renderer based on eligibility
5. **UploadSlidesStep** — upload PNG slides to S3 (via Cloudflare R2)
6. **GenerateCaptionStep** — LLM caption + hashtag generation (via `generateContentWithGate()` from `@marketing-auto/core`)
7. **ResearchHashtagsStep** — trend-specific hashtag research (DataForSEO)
8. **PersistSocialPostStep** — INSERT into `social_posts` table with rendered slide URLs, caption, hashtags

**Input/Output:**
```typescript
type PipelineInput = {
  articleId: string;
  projectId: string;
  theme: "dark" | "light";
  variant: "editorial" | "stunning";
  preRunId?: string;  // from Spec 36 preRunId pattern
};

type PipelineOutput = {
  socialPostId: string;
  slideUrls: string[];
  caption: string;
  hashtags: string[];
  totalSlides: number;
};
```

**Rendering mechanism:**
- `RenderSlidesStep` calls the appropriate render function from `packages/social/render-server.ts`
- Each function signature: `async (input: TemplateInput) => Promise<RenderResult>` where `RenderResult = { slides: Buffer[], sequenceCount: number }`
- Example: `renderListCarouselStunning(input: ListCarouselInput)` uses Remotion's `@remotion/bundler` + `@remotion/renderer`
  - Bundles `packages/social/src/index.tsx` into a temporary URL
  - Calls `getCompositions(bundleUrl)` to resolve the composition (ListCarouselStunning)
  - For each `slideIndex` in 0..sequenceCount-1, calls `renderStill({ composition, serveUrl, output, frame: 0, imageFormat: 'png' })`
  - Returns PNG buffers (one per slide)

**Output format:** PNG files (1080×1080 for square, 1080×1350 for story/reel). Stored in temporary directory during render, then uploaded to S3 by next step.

**File retention:** 
- Rendered PNG slides are stored in S3 (versioned by `articleId/templateKey/locale-theme/slide-NN.png`)
- Old renders are NOT automatically deleted — `social_posts` records point to immutable URLs
- Manual re-render creates a new `social_posts` row with a new `socialPostId`; old post remains in `draft` status

### B.2 Trigger Mechanisms Today

**Manual trigger endpoint:**
```
POST /api/articles/:articleId/social-posts/generate
```
Body:
```json
{
  "format": "list_carousel",
  "theme": "dark",
  "variant": "stunning"
}
```

**Frontend UI:** `SocialPostsTab.vue` in article detail page (within the "Social" tab alongside Body/Versions/etc.)
- Shows available templates (filtered by eligibility)
- User clicks "Generate Carousel"
- Endpoint called, returns `{ ok: true, data: { runId, jobId } }`
- Frontend polls `/api/pipeline-runs/:runId` for status (via SSE if available)
- On completion, displays download button for the ZIP bundle

**Auto-trigger:** None currently. Pipeline does not auto-run after `article:blog` completes. (Future Spec: may integrate with the content planner.)

**Re-render:** User can click "Regenerate" on an existing social post → new render with same input parameters, creating a new `social_posts` row.

### B.3 Cost Tracking

**Cost billed to:** Remotion rendering is **CPU-based** (charged per render minute), not LLM-based.
- Estimate in template definition: `estimatedCostUsd: 0.006` (single-tool-spotlight) to `0.01` (comparisons)
- Actual cost persisted in `social_posts.costEur` (numeric field, precision 10 scale 4)
- Also tracked in `template_renders.costUsd` if the row is used for admin preview

**Cost operation:** No explicit `COST_OPS` enum entry for "social rendering" in the core. Cost is estimated inline in the route handler and passed to `triggerWithPreRunId()`:
```typescript
costEstimate: {
  service: "anthropic",  // LLM caption generation only
  estimatedCostEur: 0.03,
},
```
(Remotion + DataForSEO costs are NOT currently tracked in the cost system — only the LLM call for caption is tracked.)

---

## Area C: Frontend UI Today

### C.1 Current Social UI Components

**File locations in `apps/web/src/`:**
- `pages/ArticleDetailPage.vue` — contains tab system; Social tab mounted conditionally when article has eligible templates
- `components/article/SocialPostsTab.vue` — main content panel for social rendering
- `components/article/TemplateGallery.vue` — card grid of available/unavailable templates + preview modal
- `components/article/TemplateCard.vue` — individual template card with status badge (Ready/Rendering/Failed/Not Available)
- `components/article/RenderHistoryList.vue` — timeline of past renders for the article

**i18n keys:** `src/i18n/de/social.ts` and `src/i18n/en/social.ts` (both ~70 keys)
- Top-level tabs: `tabs.generate`, `tabs.suggestions`, `tabs.history`
- Template gallery: `templateGallery.title`, `templateGallery.notEligible`, `templateGallery.statusReady`, etc.
- Render card: `renderCard.statusReady`, `renderCard.duration`, `renderCard.costUsd`, etc.
- Theme/variant labels: `theme.dark`, `variant.stunning`, `variant.stunningHint`, etc.

**No legacy snapshot** — this is new Spec 54k code (added in latest commits). No "legacy-snapshot" branch with prior social UI.

### C.2 API Endpoints

**Social Posts routes** (in `apps/api/src/routes/social-posts.ts`):
```
POST   /api/articles/:articleId/social-posts/generate
GET    /api/articles/:articleId/social-posts
GET    /api/social-posts/:id
GET    /api/social-posts/:id/download-bundle
```

**Admin batch routes** (in `apps/api/src/routes/projects/social-posts.ts`):
```
GET    /api/projects/:slug/social-posts
POST   /api/projects/:slug/social-posts/re-render-batch
```

**No SSE events yet** for social rendering status. Pipeline events use generic `pipeline.running`/`pipeline.completed`/`pipeline.failed` events. Dedicated `social.rendered` event type does not exist (future: Spec 54.11 may add it).

---

## Area D: Brand-Token Integration

### D.1 Brand-Token Awareness Status

**All 4 production templates are PARTIALLY brand-aware:**

| Template | Brand Fields Used | Hardcoded Items | Safety Level |
|----------|-------------------|-----------------|--------------|
| **comparison-stunning** | `brandTokens.colors.primary`, `.accent`, `.ink`, `.inkMuted`, `.surfaceDark` | Pricing colors (green/blue/amber), eyebrow color, footer layout | Medium: Replace hardcoded color hex with tokens |
| **comparison-stunning-3** | Same as comparison-stunning | Same hardcodes | Medium |
| **use-case-verdict-per-tool** | Same (via theme.ts) | Same hardcodes | Medium |
| **single-tool-spotlight** | Same (via theme.ts) | Same hardcodes | Medium |

**Pattern observed in all templates:**
```typescript
// In ToolSlideStunning.tsx, line 59:
const { brandTokens } = input;
const { fontFamily, headingWeight, eyebrowLetterSpacing } = brandTokens.typography;
```

**What is tokenized:**
- Primary brand color (oklch string)
- Accent color
- Ink (text) color + muted variant
- Surface dark (background)
- Font family
- Heading weight
- Eyebrow letter-spacing

**What is NOT tokenized (hardcoded):**
- Pricing tier colors: green (#22c55e), blue (#3b82f6), amber (#f59e0b)
- Eyebrow color: oklch(85% 0.10 168) (bright orange)
- Medium dark surface: oklch(22% 0.02 248)
- Rank badge font size: 72px
- Footer spacing/sizing: 20px website, 16px Instagram handle
- Line-clamp on taglines: -webkit-line-clamp rules (CSS constants)

### D.2 Brand-Token Injection Pattern

**In template definitions** (e.g. `singleToolSpotlight.ts` line 92):
```typescript
const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;
// Then pass to composition:
const compositionInput = {
  ...resolved,
  brandTokens: brandTokens,
};
```

**In compositions** (e.g. `ToolSlideStunning.tsx` line 59):
```typescript
const { brandTokens } = input;
const { fontFamily, headingWeight, eyebrowLetterSpacing } = brandTokens.typography;
const theme = getThemeTokens(brandTokens, themeMode);
```

**In `lib/theme.ts`** (the central token resolver):
```typescript
export function getThemeTokens(
  brandTokens: BrandTokens | undefined,
  theme: "dark" | "light"
): ThemeTokens {
  const c = brandTokens?.colors;
  // Returns merged set of default + override values
}
```

**Fallback behavior:** All templates call `brandTokens ?? DEFAULT_BRAND_TOKENS` before using the tokens. `DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({})`, which applies all Zod `.default()` values, ensuring no token is ever `undefined`.

### D.3 Brand-Asset Integration

**Tool icons:**
- Fetched by `ResolveAssetsStep` in the social-image pipeline
- Calls `resolveToolIcon()` from `src/lib/icon-resolver.ts` (re-exported from pipelines package)
- Resolution chain: `project_brand_assets` DB cache → simple-icons → iconify → lobe-icons → deterministic avatar
- Passed in composition input as `tool.iconSvg` (inline SVG string) or `tool.iconInitials` + `tool.iconHue` (avatar fallback)

**Logo:**
- Passed in composition input via `brandTokens.social.logoAssetKey` (e.g. "main")
- Compositions do NOT currently render the brand logo (future feature)
- Footer uses text-only branding (website URL + Instagram handle)

**Brand assets table:**
`project_brand_assets` schema (in `packages/db/src/schema/`):
```
id uuid, project_id uuid, asset_type ("tool_icon" | "logo"), 
asset_key text, inline_svg text, r2_key text, source ("simple-icons" | "iconify" | "lobe-icons" | "custom-upload"),
created_at, updated_at
```

**No template-level asset slot declarations** — compositions hardcode which asset keys they expect (e.g. `logoAssetKey: "main"`). No schema to declare "this template needs: logo + hero-image-1 + hero-image-2".

---

## Area E: Cross-cutting

### E.1 Cost Tracking for Social

**Cost operation types:**
- Remotion rendering: NO explicit `COST_OPS` code (Remotion is CPU-billed, not LLM-billed; costs are estimated, not metered)
- LLM caption/hashtag generation: Tracked via `generateContentWithGate()` from `@marketing-auto/core`
  - Uses `COST_OPS.SOCIAL_HOOK_GENERATION` (Haiku, ~€0.0003 per call)

**Cost columns in DB:**
- `social_posts.costEur` — numeric(10,4), actual cost persisted after render
- `template_renders.costUsd` — numeric(8,4), cost of a single template render (if row used for admin preview)

**Cost estimate in route:**
```typescript
// apps/api/src/routes/social-posts.ts, line 49:
costEstimate: {
  service: "anthropic",
  estimatedCostEur: 0.03,  // LLM caption only
},
```
This is passed to `triggerWithPreRunId()` for budget checking. Remotion's estimated cost (in template definition) is NOT summed into this total.

### E.2 Worker Configuration

**Remotion rendering:** Single-process, synchronous execution.
- NO BullMQ worker for Remotion rendering
- Runs in-process as part of `RenderSlidesStep` in the main `article:social-image` pipeline
- Dynamically imports `render-server.ts` functions via:
  ```typescript
  const mod = (await import("@marketing-auto/social")) as unknown as {
    renderListCarouselStunning: (input: ListCarouselInput) => Promise<RenderResult>;
  };
  ```
- Each render blocks the step execution (~10-30 seconds per carousel)

**Memory limits:** No explicit limit set. Remotion bundles Chromium (100+ MB). Max 5 simultaneous pipeline jobs enforced by BullMQ `concurrency` setting (global, not social-specific).

**Error handling:** If Remotion render throws, `RenderSlidesStep` catches + logs, then rethrows. Pipeline fails, `afterError()` hook never called (no cleanup needed for in-process rendering).

### E.3 Configuration & Settings

**Project configuration columns** (in `projects` table):
- No `social_*` columns exist
- No `defaultTemplate`, `autoRender`, `socialChannels` fields

**Per-project settings:**
- Brand tokens: `brand_tokens` JSONB column (Spec 52b) — stores overrides for colors, typography, voice, social metadata
- Target locales: `target_locales` JSONB array (default `["de-DE"]`) — affects which language the pipeline renders in
- Brand assets: `project_brand_assets` FK table — tool icons, logos stored here

**No social-specific UI in SettingsPage yet** — brand asset/token editors exist (Spec 52b), but no "Social Rendering Settings" page for template defaults, auto-publish rules, or channel configuration.

---

## Summary

### What Works Today (in Production)

1. **4 template designs:** comparison-stunning (2-tool), comparison-stunning-3 (3-tool), use-case-verdict-per-tool (N use-cases), single-tool-spotlight (1 tool)
2. **Remotion rendering:** Server-side PNG generation via `@remotion/bundler` + `@remotion/renderer`, headless Chrome
3. **Manual trigger UI:** Social Posts tab in article detail, template gallery with eligibility filtering
4. **Multi-slide support:** 1080×1350 carousels with 3-10 slides per template
5. **Brand token system:** Color + typography overrides via `BrandTokens` schema, fallback to defaults
6. **Tool icon resolution:** 4-tier fallback chain (project cache → simple-icons → iconify → lobe-icons → avatar)
7. **LLM-generated captions:** Hook patterns + hashtags via `generateContentWithGate()` (Haiku)
8. **File persistence:** PNG slides stored in S3 (Cloudflare R2), URLs saved in `social_posts` rows
9. **Cost tracking:** LLM costs metered, Remotion costs estimated (not metered)
10. **Download ZIP:** Bundle individual slides + caption + hashtags for manual download

### What's Stubbed / Partial

1. **Template coverage:** Only comparison + single-tool + use-case templates; news/concept/pricing/pro-con templates listed in types but not implemented
2. **Brand-token coverage:** Pricing colors (green/blue/amber) NOT tokenized; eyebrow color, footer spacing NOT tokenized
3. **Auto-publish:** No integration with social media APIs (Instagram, TikTok, LinkedIn); manual download only
4. **Pipeline auto-trigger:** No auto-trigger after `article:blog` completes; user must manually click "Generate"
5. **Locale variants:** Slides are locale-agnostic in visual design; locale affects only input data (titles/captions)
6. **Template selection UI:** Auto-discovery via eligibility predicate; no manual template picker or template assignment in content planner
7. **Cost metering:** Remotion rendering costs NOT tracked in real-time; estimated cost only
8. **SSE status events:** No `social.rendering`/`social.completed` event types; generic pipeline events used instead

### What's Missing Entirely

1. **Social media publishing:** No Instagram/TikTok/LinkedIn API integrations; no auto-publish or scheduled posting
2. **Template customization:** No visual editor for templates; no per-project template variants
3. **Carousel preview:** No WYSIWYG preview in the web UI (template gallery shows static frames, not interactive slides)
4. **Performance metrics:** No tracking of slide engagement (likes, shares, saves) per social post
5. **Hashtag research:** `ResearchHashtagsStep` is stubbed (calls DataForSEO but result not integrated; falls back to hardcoded logic)
6. **Video output:** Only PNG slides, no MP4 video carousels
7. **Multi-language visual variants:** Slides don't adapt layout/fonts for different languages
8. **A/B testing:** No framework for testing template variations side-by-side
9. **Trend-aware templates:** Templates don't react to current trends (Spec 54.5 trend discovery data not fed into template selection)
10. **Inline template editing:** No UI to customize template copy per article (hook phrases, taglines, etc. are fixed at render time)

---

## Template Migration Readiness

### Safe to Make Brand-Aware Now (Low Risk)

**Pricing colors** → Extract hex values to `BrandTokens.colors` (add `pricingFree`, `pricingFreemium`, `pricingPaid` fields).
- Current hardcode: `#22c55e` (free), `#3b82f6` (freemium), `#f59e0b` (paid) in `lib/theme.ts`
- Why safe: These are semantic colors (tied to pricing tier, not subjective design); no contrast issues if swapped for brand colors
- Effort: 1-2 hours (add 3 fields to schema, update pricingColor() switch, test with custom colors)

**Footer spacing/sizing** → Add `BrandTokens.social.footerFontSizes` (website, handle, label fields) + gaps.
- Current hardcodes: 20px, 16px, 18px in `shared/BrandLogo.tsx`
- Why safe: Text sizing is mechanical; unlikely to break layout if adjusted ±2-4px
- Effort: 2-3 hours (parameterize via Zod schema, pass through input, update footer component)

### Needs Design Review (Medium Risk)

**Eyebrow color** → Currently `oklch(85% 0.10 168)` (bright orange). If a project uses a dark brand color, the eyebrow would become unreadable on dark backgrounds.
- Risk: Contrast regression if brand color hue is moved to reds/greens/purples
- Recommendation: Add `BrandTokens.colors.eyebrowColor` as optional override, but enforce WCAG AA contrast check in the brand-tokens PATCH endpoint before persisting
- Effort: 4-5 hours (add field, implement contrast checker via culori, add validation in API)

**Medium dark surface** → Currently `oklch(22% 0.02 248)` (the muted gray behind tool cards). If project uses a very light primary color (e.g. `oklch(75% ...)`), this dark surface would kill readability.
- Risk: Poor figure/ground separation if brand primary is light
- Recommendation: Derive `surface` color from brand primary hue dynamically (e.g. `oklch(25% calc(primary.c * 0.5) primary.h)`); allow override but validate contrast
- Effort: 5-6 hours (add dynamic derivation + contrast validation)

### Should Be Replaced (Low Quality / Not Used)

**Editorial variant** → Legacy `variant: "editorial"` (first version before "Stunning" redesign). Minimal polish, no usage in production.
- Recommendation: Mark as deprecated, hide from UI, remove in next major spec release
- Effort: 1 hour (hide from template gallery, add deprecation comment in code)

**Concept-explainer / Pro-con verdict templates** → Stubbed in `TemplateKey` union but never implemented. No compositions, no fixture data.
- Recommendation: Remove from `TemplateKey` union, add proper implementation only when spec defines design + eligibility rules
- Effort: 1-2 hours (prune dead code)

---

## Recommended Theme 57 Sub-Spec Split

### Option A: "Brand-Token Completion" (Narrowest Scope)

**Scope:** Tokenize remaining hardcoded values in existing templates.
- Add 5-8 new schema fields: `pricingFree/Freemium/Paid`, `eyebrowColor`, `surfaceSecondary`, `footerFontSizes`
- Implement contrast validation in brand-tokens PATCH endpoint
- Update all 4 templates to read new tokens
- Add tests for theme parity (dark + light, custom brand colors)

**Effort:** 20-25 days
**Risk:** Low (templates already brand-aware; just extending the schema)
**Value:** High (unblocks per-project brand customization; low technical debt)

### Option B: "Template Gallery Enhancement" (Medium Scope)

**Scope:** Improve template UI + selection logic.
- Add preview carousel in the template gallery (interactive slide preview in a modal, not static frames)
- Implement manual template pre-selection in content planner (mark article for specific template before generation)
- Add eligibility explanation tooltips ("Why isn't this template available?")
- Complete `ResearchHashtagsStep` DataForSEO integration

**Effort:** 25-30 days
**Risk:** Medium (preview carousel requires Remotion client-side rendering or server-side image snapshot; selection logic adds complexity to planning UI)
**Value:** Medium (better UX, more control; but doesn't unlock new content types)

### Option C: "Social Publishing Integration" (Broadest Scope)

**Scope:** Add Instagram/TikTok/LinkedIn publishing.
- Implement social media SDK integrations (Meta Graph API, TikTok Content Library API, LinkedIn Share API)
- Add publishing UI (schedule/publish modal, platform selection)
- Add OAuth flows for project-level social account linking
- Track published post metrics (likes, comments, saves)
- Implement scheduling + auto-publish rules

**Effort:** 40-50 days
**Risk:** High (external API compliance, auth complexity, Instagram rate limits, legal/ToS review)
**Value:** Very High (core feature for marketing automation; unlocks full social repurposing workflow)

### Recommendation

**Start with Option A** (Brand-Token Completion). Reasons:
1. Unblocks per-project customization without external dependencies
2. Lowers technical debt (removes hardcoded color magic numbers)
3. Pairs naturally with Spec 52b brand asset work
4. Sets foundation for Option B/C later (both need robust brand controls)
5. Lowest risk, highest immediate value

**Then pursue Option C** (Social Publishing) in a second phase. Option B is a nice-to-have but not critical (preview modal is UI sugar; eligibility tooltips are documentation).

---

## Key Open Questions for Spec Author

1. **Pricing color override strategy:** Should each project be allowed to set custom pricing colors, or should they stay semantic (free=green, paid=amber)? Is there a brand reason to use different colors?

2. **Remotion cost metering:** Should Remotion rendering costs be tracked in real-time (requires integrating Replicate/Lambda billing) or stay estimated? Current implementation never records actual Remotion cost, only LLM caption cost.

3. **Template picker placement:** Should templates be selectable in the article detail UI (current), or moved to a content planner step (editorial decision point)? If the latter, does the planner pre-compute eligibility or compute on-demand?

4. **Hashtag research:** `ResearchHashtagsStep` queries DataForSEO but doesn't use the result. Should this be completed (use trending keywords in hashtags) or removed (fall back to static hook pattern)?

5. **Locale-specific slide variants:** Should slides adapt their visual layout for different languages (e.g. German nominative compounds take more space), or stay fixed-layout? Current implementation is fixed-layout (data-driven, not design-driven).

6. **Video output:** Is MP4 video carousel output (instead of PNG) in scope for Theme 57? Remotion supports video export but we only use `renderStill()`.

7. **Multi-project template library:** Should templates be project-scoped (each project can have custom template variants) or global (all projects use the same 4 templates)? Current implementation is global.

8. **Editorial/Stunning variant deprecation:** Should Editorial variant be removed now or kept for backward compat? No new articles use it, but old articles might have renders that reference it.

---

## Estimated Effort per Sub-Spec

| Task | Days | Notes |
|------|------|-------|
| **Tokenize pricing colors** | 3-4 | Add 3 fields, update switch statement, validate contrast |
| **Tokenize footer sizing** | 2-3 | Parameterize 3 font sizes + gap, pass through input |
| **Tokenize eyebrow + surface** | 4-5 | Add fields, implement contrast validation, test themes |
| **Complete hashtag research** | 3-4 | Integrate DataForSEO result into caption generation |
| **Template gallery preview modal** | 5-6 | Build carousel view, handle image snapshots or video embed |
| **Manual template selection** | 4-5 | Add selector to content planner, wire eligibility check |
| **Deprecate Editorial variant** | 1 | Hide from UI, document removal timeline |
| **Remove concept-explainer stubs** | 1 | Prune unused TemplateKey values, clean up test fixtures |
| **Instagram/TikTok API integrations** | 20-25 | OAuth, share endpoints, rate-limit handling, error recovery |
| **Scheduled publishing UI** | 6-8 | Calendar picker, timezone handling, publish confirmation flow |
| **Publish metrics tracking** | 4-5 | Polling loop for post metrics, dashboard display |
| **Testing + documentation** | 5-7 | Test coverage for token schema, API docs for publishing endpoints |

---

## Appendix: Key File Paths

**Core rendering:**
- `/packages/social/src/index.tsx` — Remotion root + Composition registrations
- `/packages/social/render-server.ts` — programmatic render entry (renderListCarouselStunning, etc.)
- `/packages/social/src/lib/theme.ts` — BrandTokens schema + getThemeTokens()

**Templates:**
- `/packages/social/src/templates/registry.ts` — template registry singleton
- `/packages/social/src/templates/bootstrap.ts` — template registration at startup
- `/packages/social/src/templates/definitions/*.ts` — template business logic (4 production templates)
- `/packages/social/src/templates/types.ts` — TemplateKey, TemplateDef, RenderContext types

**Compositions:**
- `/packages/social/src/compositions/list-carousel/` — 2-5 tool carousel (8 files)
- `/packages/social/src/compositions/single-tool-spotlight/` — single tool detail (6 files)
- `/packages/social/src/compositions/use-case-verdict/` — N use-case verdict carousel (4 files)

**Pipeline:**
- `/packages/pipelines/src/article/social-image/pipeline.ts` — pipeline orchestration
- `/packages/pipelines/src/article/social-image/steps.ts` — 8 step implementations
- `/apps/api/src/routes/social-posts.ts` — POST /generate, GET /posts endpoints
- `/apps/api/src/routes/projects/social-posts.ts` — admin batch re-render endpoint

**Frontend:**
- `/apps/web/src/components/article/SocialPostsTab.vue` — main UI panel
- `/apps/web/src/components/article/TemplateGallery.vue` — template card grid
- `/apps/web/src/components/article/RenderHistoryList.vue` — render timeline
- `/apps/web/src/i18n/de/social.ts` + `/en/social.ts` — i18n keys

**DB schema:**
- `/packages/db/src/schema/content.ts` — `social_posts`, `template_renders` tables

