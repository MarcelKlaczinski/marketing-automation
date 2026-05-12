═══════════════════════════════════════════════════════════════════
SPEC 51a — Social Image-Post-Generation
Phase A: Asset-DB + Phase B: List-Carousel Template
═══════════════════════════════════════════════════════════════════

CONTEXT

toolwiki.ai braucht Instagram-Content für Brand-Awareness. Aktuell:
- Web-Design-System steht (OKLCH-Tokens, Inter Variable, ToolIcon.astro)
- Marketing-Context Block A enthält Voice + Brand-Guidance
- lobe-icons werden via unplugin-icons in Astro genutzt
- Marketing-Tool hat KEINE Asset-Library, KEIN Social-Generation

GOAL: Marcel kann pro Article einen "List-Carousel" Instagram-Post
generieren — Cover + 5-10 Tool-Slides + End-Slide, gebrandet im
toolwiki-Visual-System, Dark default + Light variant.

PHASING:
- Phase A: Minimal Asset-DB + lobe-icons Integration (~5h)
- Phase B: Remotion + List-Carousel Template + Caption (~8h)

DEFERRED (eigene Specs):
- Template 2 (Comparison-Grid) — Spec 51a-template-2
- Template 3 (2025vs2026) — Spec 51a-template-3
- Asset-Upload-UI für Multi-Tenant — Spec 51a-asset-ui
- Reels via Remotion — Spec 51b
- Instagram Graph API Publishing — Spec 51c

═══════════════════════════════════════════════════════════════════
NON-GOAL
═══════════════════════════════════════════════════════════════════

- Kein Multi-Tenant Asset-Upload-UI (Phase D, future spec)
- Kein Auto-Publishing zu Instagram (Spec 51c, dependent on Meta-Review)
- Keine Custom Brand-Templates für non-toolwiki Tenants
- Keine Reel-Generation (Spec 51b)
- Keine Animation in Image-Posts (statisch)
- Keine echten Tool-Screenshots (nur Logos via lobe-icons)
- Kein A/B-Testing-Framework
- Keine Performance-Analytics (Engagement-Tracking)

═══════════════════════════════════════════════════════════════════
PHASE A — MINIMAL ASSET-DB + LOBE-ICONS INTEGRATION (~5h)
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
A.1: Schema — project_brand_assets Table
──────────────────────────────────────────────────────────────────

DATEI: packages/db/src/schema/projects.ts (oder neue file brand-assets.ts)

CREATE TABLE project_brand_assets (
id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

-- Asset-Typ + Identifikation
asset_type      TEXT NOT NULL, -- 'logo' | 'tool_icon' | 'background_pattern'
asset_key       TEXT NOT NULL, -- für tool_icon: tool-slug (z.B. 'midjourney')
-- für logo: 'main' | 'wordmark' | 'submark'

-- Storage
source          TEXT NOT NULL, -- 'lobe-icons' | 'r2' | 'inline-svg'
source_ref      TEXT,          -- für lobe-icons: 'midjourney-color'
-- für r2: 'brand-assets/toolwiki/logo.svg'
-- für inline-svg: raw SVG string in `inline_svg` column
inline_svg      TEXT,          -- Optional inline SVG für Direct-Render

-- Metadata
display_name    TEXT,
metadata        JSONB NOT NULL DEFAULT '{}',

created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

UNIQUE(project_id, asset_type, asset_key)
);

CREATE INDEX brand_assets_project_type_idx
ON project_brand_assets(project_id, asset_type);

DRIZZLE Schema entsprechend.

MIGRATION: packages/db/drizzle/0025_project_brand_assets.sql

──────────────────────────────────────────────────────────────────
A.2: Schema — project_brand_tokens (Style-Guide-Storage)
──────────────────────────────────────────────────────────────────

ADD COLUMN zu projects (oder eigene table wenn 1:N nötig):

projects.brand_tokens JSONB NOT NULL DEFAULT '{}'

Shape (typed via Zod):
{
colors: {
primary:      string,  // OKLCH or hex
primaryHue:   number,  // 248 für toolwiki
accent:       string,  // mint
surface:      string,
surfaceDark:  string,
ink:          string,
inkMuted:     string,
wikiCream:    string   // "#fef9ec" for toolwiki
},
typography: {
fontFamily:   string,  // "Inter Variable"
headingWeight: number, // 800
bodyWeight:   number,  // 400
eyebrowLetterSpacing: string  // "0.08em"
},
voice: {
locale:       string,  // "de-DE"
addressForm:  string,  // "du" | "Sie" | "you"
forbiddenWords: string[],
signaturePhrases: string[]
},
social: {
instagramHandle: string,  // "@toolwiki.ai"
websiteUrl:      string,  // "toolwiki.ai"
logoAssetKey:    string   // "main" → resolves via project_brand_assets
}
}

Seed-Migration für toolwiki:
UPDATE projects SET brand_tokens = '{
"colors": {
"primary": "oklch(64% 0.16 248)",
"primaryHue": 248,
"accent": "oklch(72% 0.15 168)",
"surface": "#ffffff",
"surfaceDark": "oklch(16% 0.02 250)",
"ink": "oklch(20% 0.025 250)",
"inkMuted": "oklch(45% 0.025 250)",
"wikiCream": "#fef9ec"
},
"typography": {
"fontFamily": "Inter Variable",
"headingWeight": 800,
"bodyWeight": 400,
"eyebrowLetterSpacing": "0.08em"
},
"voice": {
"locale": "de-DE",
"addressForm": "du",
"forbiddenWords": ["innovativ", "revolutionär", "bahnbrechend"],
"signaturePhrases": ["redaktionell verifiziert", "ohne hype", "ehrlich"]
},
"social": {
"instagramHandle": "@toolwiki.ai",
"websiteUrl": "toolwiki.ai",
"logoAssetKey": "main"
}
}'::jsonb
WHERE slug = 'toolwiki';

──────────────────────────────────────────────────────────────────
A.3: lobe-icons Integration als npm-Package
──────────────────────────────────────────────────────────────────

Marketing-Tool nutzt aktuell KEIN lobe-icons. Wir brauchen:

INSTALL:
apps/api/package.json + packages/social/package.json:
"@lobehub/icons-static-png": "^1.x"   // Pre-rendered PNGs für Remotion

ODER (wenn React-Components für Remotion):
"@lobehub/icons": "^1.x"   // React-Components

EMPFEHLUNG: @lobehub/icons-static-png
- Pre-rendered, kein React-Runtime nötig in Remotion
- Direct PNG-import via path
- Smaller bundle für Worker

USAGE in Remotion:
import iconUrl from "@lobehub/icons-static-png/dark/midjourney.png";
oder dynamically:
import { getIconUrl } from "@lobehub/icons-static-png";
const url = getIconUrl("midjourney", { theme: "dark", size: 256 });

ASSET-SEEDING:
Script: apps/api/src/scripts/seed-tool-icons.ts

// Liest alle Tool-Slugs aus articles WHERE entity_type='tool'
// Für jeden Slug:
//   1. Check if lobe-icons hat ein Icon dafür
//   2. Wenn ja: insert into project_brand_assets
//      (project_id, asset_type='tool_icon', asset_key=slug,
//       source='lobe-icons', source_ref=`${slug}-color`)
//   3. Wenn nein: insert mit source='deterministic-avatar' (HSL-Fallback)

Lobe-icons Slug-Naming-Convention beachten:
toolwiki "chatgpt" → lobe-icons "openai" (Brand-Family-Logic)
Mapping-Table in code für edge-cases.

──────────────────────────────────────────────────────────────────
A.4: Service — brand-asset-service.ts
──────────────────────────────────────────────────────────────────

DATEI: apps/api/src/lib/brand-asset-service.ts (NEU)

Pattern wie gap-service.ts und chain-orchestrator.ts (Service-File, kein Pipeline-Step).

Core Funktionen:

export async function getBrandTokens(projectId: string): Promise<BrandTokens> {
const project = await db.query.projects.findFirst({
where: eq(projects.id, projectId)
});
return brandTokensSchema.parse(project.brandTokens);
}

export async function resolveToolIcon(
projectId: string,
toolSlug: string
): Promise<ResolvedIcon> {
// 1. Lookup in project_brand_assets
const asset = await db.query.projectBrandAssets.findFirst({
where: and(
eq(projectBrandAssets.projectId, projectId),
eq(projectBrandAssets.assetType, "tool_icon"),
eq(projectBrandAssets.assetKey, toolSlug)
)
});

if (asset?.source === "lobe-icons") {
return { type: "url", url: getLobeIconUrl(asset.sourceRef, "dark") };
}

if (asset?.source === "r2") {
return { type: "url", url: getR2Url(asset.sourceRef) };
}

if (asset?.source === "inline-svg") {
return { type: "svg", svg: asset.inlineSvg };
}

// Fallback: deterministic HSL avatar
return { type: "avatar", initials: toolSlug.slice(0, 2).toUpperCase(), hue: hashToHue(toolSlug) };
}

export async function getProjectAssets(
projectId: string,
assetType?: string
): Promise<ProjectBrandAsset[]> {
// List all assets for a project, optionally filtered by type
}

──────────────────────────────────────────────────────────────────
A.5: Tests Phase A
──────────────────────────────────────────────────────────────────

apps/api/test/lib/brand-asset-service.test.ts:
- getBrandTokens returns parsed tokens for toolwiki
- resolveToolIcon returns lobe-icon URL for mapped tool
- resolveToolIcon returns deterministic avatar for unmapped tool
- resolveToolIcon returns inline-svg for inline-stored asset

═══════════════════════════════════════════════════════════════════
PHASE B — REMOTION + LIST-CAROUSEL TEMPLATE (~8h)
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
B.1: Remotion-Package Setup
──────────────────────────────────────────────────────────────────

NEUE WORKSPACE: packages/social/

packages/social/package.json:
{
"name": "@org/social",
"type": "module",
"scripts": {
"render": "remotion render src/index.tsx",
"studio": "remotion studio"
},
"dependencies": {
"remotion": "^4.x",
"@remotion/cli": "^4.x",
"@remotion/bundler": "^4.x",
"@remotion/renderer": "^4.x",
"@lobehub/icons-static-png": "^1.x",
"react": "^18.x",
"react-dom": "^18.x"
}
}

DATEI-STRUKTUR:
packages/social/
├── src/
│   ├── index.tsx                   (Remotion entry — register all compositions)
│   ├── compositions/
│   │   └── list-carousel/
│   │       ├── ListCarousel.tsx    (Composition)
│   │       ├── CoverSlide.tsx
│   │       ├── ToolSlide.tsx
│   │       ├── EndSlide.tsx
│   │       └── types.ts            (Zod input schema)
│   ├── shared/
│   │   ├── BrandLogo.tsx
│   │   ├── ToolIconImage.tsx
│   │   ├── Eyebrow.tsx
│   │   ├── PricingChip.tsx
│   │   └── BackgroundLayer.tsx     (Dark or Light variant)
│   └── lib/
│       ├── brand-tokens.ts         (CSS-Variables aus BrandTokens objekt)
│       └── theme.ts                (Light/Dark theme resolver)
└── render-server.ts                (Programmatic render entry)

──────────────────────────────────────────────────────────────────
B.2: List-Carousel Composition
──────────────────────────────────────────────────────────────────

INPUT SCHEMA (Zod):

const ListCarouselInputSchema = z.object({
// Theme
theme: z.enum(["dark", "light"]).default("dark"),
brandTokens: brandTokensSchema,

// Cover
cover: z.object({
eyebrow: z.string().max(40),                  // "AUSGABE 03 · KI-TOOLS"
headlineLead: z.string().max(30),             // "Die 5 besten"
headlineHighlight: z.string().max(40),        // "KI-Bild-Generatoren"
headlineTrail: z.string().max(20).optional(), // "in 2026."
subhead: z.string().max(80).optional(),       // "redaktionell verifiziert"
}),

// Tools (3-10 slides)
tools: z.array(z.object({
slug: z.string(),                             // → resolves via brand-asset-service
rank: z.number().int(),                       // 01, 02, ...
name: z.string(),                             // "Midjourney"
domain: z.string(),                           // "midjourney.com"
eyebrow: z.string().max(40),                  // "01 · KI-BILD-GENERATOR"
tagline: z.string().max(120),                 // "Beste Wahl für ..."
strengths: z.array(z.string()).min(2).max(4), // 3 bullets
pricing: z.object({
tier: z.enum(["free", "freemium", "paid"]),
label: z.string(),                          // "ab 10€/Monat"
}),
})).min(3).max(10),

// End
end: z.object({
headline: z.string().max(40),                 // "Mehr Reviews"
headlineHighlight: z.string().max(40),        // "ehrlich getestet."
articleUrl: z.string().url(),                 // "toolwiki.ai/ki-bild-generatoren"
qrCodeUrl: z.string().url().optional(),
}),
});

CANVAS:
1080×1080 px (square Instagram)
30 fps, 1 frame static (kein motion in Phase 1)

──────────────────────────────────────────────────────────────────
B.3: Slide-Components
──────────────────────────────────────────────────────────────────

CoverSlide.tsx:
- Background: dark variant (oklch(16% 0.02 250)) oder light variant (wikiCream)
- Eyebrow oben: brand-700 (für light) oder brand-300 (für dark)
- 3-Token-Headline mit Highlight in brand-500
- Optional subhead
- Bottom: Logo + Page-Indicator "1/7"

ToolSlide.tsx:
- Background: dark/light
- Eyebrow: "01 · KATEGORIE"
- Tool-Card:
  - BrandLogo aus brand-asset-service.resolveToolIcon
  - Name + Domain
- Divider
- Tagline (1-2 lines)
- Strengths-List mit Brand-Accent-Bullets
- Pricing-Chip semantic (free=green, freemium=blue, paid=amber)
- Bottom: Logo + "N/Total"

EndSlide.tsx:
- Background: dark/light mit subtle aurora-gradient
- Eyebrow: "ZUR VERTIEFUNG"
- 2-Token-Headline mit Highlight
- Article-URL prominent
- Optional QR-Code
- Bottom: Logo + "Last/Total"

──────────────────────────────────────────────────────────────────
B.4: Theme-System (Dark + Light)
──────────────────────────────────────────────────────────────────

packages/social/src/lib/theme.ts:

export function getThemeTokens(
brandTokens: BrandTokens,
theme: "dark" | "light"
) {
if (theme === "dark") {
return {
bg:           brandTokens.colors.surfaceDark,
surface:      "oklch(22% 0.02 248)",
ink:          "oklch(95% 0.01 250)",
inkMuted:     "oklch(70% 0.025 250)",
brand:        brandTokens.colors.primary,
accent:       brandTokens.colors.accent,
eyebrowColor: "oklch(85% 0.10 168)",  // mint-light
};
}
return {
bg:           brandTokens.colors.wikiCream,
surface:      brandTokens.colors.surface,
ink:          brandTokens.colors.ink,
inkMuted:     brandTokens.colors.inkMuted,
brand:        brandTokens.colors.primary,
accent:       brandTokens.colors.accent,
eyebrowColor: "oklch(48% 0.14 248)",   // brand-700
};
}

──────────────────────────────────────────────────────────────────
B.5: Render-Server (Programmatic Rendering)
──────────────────────────────────────────────────────────────────

packages/social/render-server.ts:

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

export async function renderListCarousel(
input: ListCarouselInput
): Promise<{ slides: Buffer[]; sequenceCount: number }> {
// 1. Bundle the Remotion entry
const bundled = await bundle({ entryPoint: "./src/index.tsx" });

// 2. For each slide: select composition, render as PNG
const totalSlides = 1 + input.tools.length + 1;  // cover + tools + end
const slides: Buffer[] = [];

for (let slideIndex = 0; slideIndex < totalSlides; slideIndex++) {
const composition = await selectComposition({
serveUrl: bundled,
id: "ListCarousel",
inputProps: { ...input, slideIndex },
});

    const slideBuffer = await renderStillToBuffer({
      composition,
      serveUrl: bundled,
      inputProps: { ...input, slideIndex },
      frame: 0,
      imageFormat: "png",
    });
    
    slides.push(slideBuffer);
}

return { slides, sequenceCount: totalSlides };
}

──────────────────────────────────────────────────────────────────
B.6: Pipeline — article:social-image
──────────────────────────────────────────────────────────────────

DATEI: packages/pipelines/src/article/social-image/pipeline.ts (NEU)

STEPS:
1. LoadArticleStep         — load article + extract tool-list from body
2. ExtractToolsStep        — Claude Haiku extracts structured tool data
3. ResolveAssetsStep       — brand-asset-service.resolveToolIcon für jeden Tool
4. RenderSlidesStep        — render-server.renderListCarousel
5. UploadSlidesStep        — Upload PNGs to R2 als bundle
6. GenerateCaptionStep     — Claude Sonnet schreibt Instagram-Caption
7. ResearchHashtagsStep    — Claude + (optional DataForSEO) für Hashtags
8. PersistSocialPostStep   — saves to article.social_assets jsonb

INPUT: { articleId, theme: "dark" | "light" }

OUTPUT: {
socialPostId: UUID,
slideUrls: string[],         // R2 URLs
caption: string,
hashtags: string[],
totalSlides: number
}

ESTIMATED COST PER POST:
- Claude Haiku (extract tools):    ~$0.005
- Claude Sonnet (caption):         ~$0.015
- Claude Sonnet (hashtags):        ~$0.005
- Remotion render (CPU):           ~$0.002 (worker-time)
- R2 storage:                      ~$0.0001
  Total: ~$0.027 per Instagram-Carousel-Post

──────────────────────────────────────────────────────────────────
B.7: DB-Schema — social_posts table
──────────────────────────────────────────────────────────────────

CREATE TABLE social_posts (
id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
article_id      UUID REFERENCES articles(id) ON DELETE SET NULL,

platform        TEXT NOT NULL DEFAULT 'instagram',
format          TEXT NOT NULL,  -- 'list_carousel' | 'comparison_grid' | 'use_case_mapping'
theme           TEXT NOT NULL,  -- 'dark' | 'light'

-- Assets
slide_urls      JSONB NOT NULL,  -- ["r2-url-1", "r2-url-2", ...]
total_slides    INTEGER NOT NULL,

-- Caption + Hashtags
caption         TEXT NOT NULL,
hashtags        JSONB NOT NULL,  -- array of strings

-- Status
status          TEXT NOT NULL DEFAULT 'generated', -- 'generated' | 'downloaded' | 'published'
generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
published_at    TIMESTAMPTZ,

-- Cost-Tracking
cost_eur        NUMERIC(10, 4) NOT NULL DEFAULT 0,

created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX social_posts_article_idx ON social_posts(article_id);
CREATE INDEX social_posts_project_idx ON social_posts(project_id, status);

MIGRATION: packages/db/drizzle/0026_social_posts.sql

──────────────────────────────────────────────────────────────────
B.8: API Endpoints
──────────────────────────────────────────────────────────────────

POST /api/articles/:articleId/social-posts/generate
Body: { format: 'list_carousel', theme: 'dark' | 'light' }
Triggers article:social-image pipeline
Returns: { jobId, pipelineRunId }

GET /api/articles/:articleId/social-posts
Returns: list of social_posts for article

GET /api/social-posts/:id
Returns: full social_post with slide URLs + caption

GET /api/social-posts/:id/download-bundle
Returns: ZIP-Stream with all slides as PNG + caption.txt + hashtags.txt
Filename: toolwiki-{article-slug}-{timestamp}.zip

──────────────────────────────────────────────────────────────────
B.9: UI — Generate-Button on Article-Detail
──────────────────────────────────────────────────────────────────

DATEI: apps/web/src/components/articles/SocialPostsPanel.vue (NEU)

┌──────────────────────────────────────────────────────┐
│  Instagram-Posts                                      │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Format: ⊙ List-Carousel  ○ Comparison (soon)        │
│                                                       │
│  Theme:  ⊙ Dark  ○ Light                              │
│                                                       │
│  [Generate Carousel] (~$0.03, ~30s)                  │
│                                                       │
├──────────────────────────────────────────────────────┤
│  Bisherige Posts                                      │
│                                                       │
│  • List-Carousel · Dark · 7 Slides · vor 5 min       │
│    [Vorschau] [Download Bundle]                       │
└──────────────────────────────────────────────────────┘

Live-Polling während Generation (2s interval).
Preview-Modal zeigt alle Slides in Carousel-Layout.

──────────────────────────────────────────────────────────────────
B.10: i18n
──────────────────────────────────────────────────────────────────

apps/web/src/i18n/de/social.ts:
socialPosts: {
title: "Instagram-Posts",
format: { listCarousel: "List-Carousel", comparison: "Vergleich (bald)" },
theme:  { dark: "Dunkel", light: "Hell" },
generate: "Carousel generieren",
cost: "~$0.03 · ~30 Sekunden",
history: "Bisherige Posts",
preview: "Vorschau",
download: "Bundle herunterladen"
}

EN: equivalent translations.

──────────────────────────────────────────────────────────────────
B.11: Tests Phase B
──────────────────────────────────────────────────────────────────

packages/social/test/render-server.test.ts:
- renderListCarousel returns N PNG buffers
- Theme dark produces dark backgrounds
- Theme light produces wikiCream backgrounds
- Tool icons resolve correctly (via mock brand-asset-service)
- Deterministic-avatar fallback works for unmapped tools

packages/pipelines/test/article/social-image-pipeline.test.ts:
- Pipeline runs end-to-end with mocks
- ExtractToolsStep produces valid tool list
- ResolveAssetsStep returns ResolvedIcons for all tools
- Pipeline persists social_posts row correctly

apps/api/test/routes/social-posts.test.ts:
- POST /generate triggers pipeline
- GET /:id returns full social post
- GET /:id/download-bundle returns ZIP

──────────────────────────────────────────────────────────────────
B.12: Worker-Integration
──────────────────────────────────────────────────────────────────

apps/api/src/workers/index.ts:
- Register article:social-image pipeline in worker
- Memory-budget für Remotion: kein zusätzliches Setup nötig (Remotion bundles itself)
- Logging: pipeline-step durations + final render time

WORKER-RESTART nach Deploy:
bun run worker:restart

═══════════════════════════════════════════════════════════════════
SECTION C — DOCS
═══════════════════════════════════════════════════════════════════

apps/api/CLAUDE.md neue Section:

## Social-Posts (Instagram)

Per-article Instagram-Carousel-Generation via:
POST /api/articles/:articleId/social-posts/generate
Body: { format, theme }

Pipeline: article:social-image
Cost: ~$0.03 per carousel
Output: R2-stored PNG slides + caption + hashtags

Templates currently available:
- list_carousel: Cover + 3-10 Tool-Slides + End-Slide

Brand-Tokens loaded from projects.brand_tokens.
Tool-Icons resolved via project_brand_assets → lobe-icons (primary)
or deterministic HSL avatar (fallback).

To onboard new project for social:
1. Set projects.brand_tokens (manual SQL or future UI)
2. Run apps/api/src/scripts/seed-tool-icons.ts <project-slug>

packages/social/CLAUDE.md:

## Remotion Compositions

Each composition lives in src/compositions/<template-name>/
Input via Zod-schema in types.ts
Programmatic render via render-server.renderListCarousel()

Theme-system: dark default, light variant
Both use brand_tokens from project config.

═══════════════════════════════════════════════════════════════════
ACCEPTANCE
═══════════════════════════════════════════════════════════════════

PHASE A:
- [ ] Migration 0025 (project_brand_assets) applied
- [ ] projects.brand_tokens column added + toolwiki seeded
- [ ] @lobehub/icons-static-png installed
- [ ] brand-asset-service.ts with resolveToolIcon + getBrandTokens
- [ ] seed-tool-icons.ts script seeds assets for toolwiki tools
- [ ] 4+ tests for brand-asset-service pass

PHASE B:
- [ ] packages/social workspace created
- [ ] List-Carousel composition with Cover/Tool/End slides
- [ ] Dark + Light themes working
- [ ] render-server.renderListCarousel returns N PNG buffers
- [ ] article:social-image pipeline runs end-to-end
- [ ] Migration 0026 (social_posts) applied
- [ ] API endpoints for generate + list + download-bundle
- [ ] SocialPostsPanel.vue with format/theme picker + Generate-Button
- [ ] i18n DE+EN
- [ ] 6+ tests pass

PRODUCTION-READINESS:
- [ ] Manual test: generate 1 carousel for existing toolwiki article
- [ ] Cost actually ~$0.03 (not $0.10+)
- [ ] Visual review: 7 slides look on-brand
- [ ] Download bundle works
- [ ] Worker-restart documented
- [ ] Branch: feature/social-image-posts
- [ ] 8-10 granular commits

═══════════════════════════════════════════════════════════════════
ESTIMATED EFFORT
═══════════════════════════════════════════════════════════════════

PHASE A (Asset-DB + lobe-icons):
A.1 Schema brand_assets:           30 min
A.2 brand_tokens column:           20 min
A.3 lobe-icons install + seed:     90 min
A.4 brand-asset-service:           60 min
A.5 Tests:                         45 min
─────
4.5h

PHASE B (Remotion + List-Carousel):
B.1 packages/social setup:         60 min
B.2 Composition schema:            30 min
B.3 Slide-Components (3x):         150 min
B.4 Theme-system:                  30 min
B.5 Render-server:                 60 min
B.6 Pipeline (article:social):     90 min
B.7 social_posts table:            30 min
B.8 API endpoints:                 45 min
B.9 UI SocialPostsPanel:           90 min
B.10 i18n:                         15 min
B.11 Tests:                        90 min
B.12 Worker-Integration:           20 min
─────
~12h

Total focused work: 16.5h
Plus +30% discovery buffer: ~22h realistic
Über 3-4 Tage verteilt (4-6h pro Tag)

═══════════════════════════════════════════════════════════════════
DEFERRED (NICHT IN DIESER SPEC)
═══════════════════════════════════════════════════════════════════

- Spec 51a-template-2: Comparison-Grid Template
- Spec 51a-template-3: 2025vs2026 Use-Case-Mapping
- Spec 51a-asset-ui: Asset-Upload-UI für Multi-Tenant
- Spec 51b: Reel-Generation (incl. "Tool-Battle" animation)
- Spec 51c: Instagram Graph API Publishing
- Logo-Mark für toolwiki: braucht Design-Entscheidung (separate)
- Performance-Analytics

═══════════════════════════════════════════════════════════════════
REPORT FORMAT
═══════════════════════════════════════════════════════════════════

audit/SOCIAL_IMAGE_POSTS_PHASE_A_B.md:

## Phase A Implementation
- Migration 0025 commit hash
- brand-asset-service.ts: N tests pass
- toolwiki tool-icon seeding: N tools mapped to lobe-icons, M fallback

## Phase B Implementation
- packages/social setup commit hash
- List-Carousel composition: N slide-types
- Render-test: dark + light theme outputs ✓
- Pipeline article:social-image: end-to-end run
- Cost-Test: 1 carousel = $X.XX (target ~$0.03)

## Visual Verification
- 3 sample carousels rendered (one per existing toolwiki article)
- Screenshots inline
- Marcel review notes

## Deviations from Spec
- ...
