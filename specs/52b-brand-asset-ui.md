═══════════════════════════════════════════════════════════════════
SPEC 52b — Brand-Asset Management UI
Asset-Browser + Upload + Color-Settings + Typography + Re-Render
═══════════════════════════════════════════════════════════════════

CONTEXT

Spec 51a hat Carousel-Generation production-stable gemacht.
Spec 52a hat Tool-Icons gefixed (echte Logos statt Emojis via 3 Sources).

Aktuell: Brand-Tokens + Assets sind nur via SQL editierbar.
Re-Render existing Posts mit Emojis ist nicht über UI möglich.

GOAL: Frontend-UI für komplettes Brand-Asset-Management pro Project:
- Asset-Browser zeigt alle resolved Tool-Icons + Logo
- Custom-Upload erlaubt eigene Logos pro Tool (Override über Resolution-Chain)
- Color-Settings via OKLCH-Picker (3 Slider, simple)
- Typography-Settings (Family + Weights + Spacing + Sizes)
- Re-Render-Button für existing Social-Posts

Tenant-aware: jeder Project hat eigene Settings, Marcel kann zwischen
Projects switchen via Project-Selector.

═══════════════════════════════════════════════════════════════════
NON-GOAL
═══════════════════════════════════════════════════════════════════

- Keine Live-Preview während Editing (Re-Render Button + $0.01/post reicht)
- Keine Multi-User-Permissions (Future Spec)
- Keine OKLCH-Gamut-Indicator (User entscheidet selbst)
- Keine A/B-Testing-Framework
- Keine Performance-Analytics
- Keine Asset-Sharing zwischen Projects
- Keine Bulk-Upload (1 Asset pro Operation)
- Kein Versioning von Brand-Settings (kein Undo-History)

═══════════════════════════════════════════════════════════════════
SECTION 1: DB-Schema-Erweiterungen
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
1.1: project_brand_assets erweitern
──────────────────────────────────────────────────────────────────

ADD COLUMN: source mit neuem Wert 'custom-upload'
ADD COLUMN: r2_key TEXT (für custom uploads, references R2 storage)

ALTER TABLE project_brand_assets
ADD COLUMN r2_key TEXT;

-- source enum wird informal erweitert um 'custom-upload'
-- (kein DB-Constraint da TEXT, aber dokumentiert)

──────────────────────────────────────────────────────────────────
1.2: brand_tokens erweitern um Typography
──────────────────────────────────────────────────────────────────

Bestehende brand_tokens JSONB-Schema erweitern. Aktuell vermutlich:

{
colors: {...},
typography: {
fontFamily: "Inter Variable",
headingWeight: 800,
bodyWeight: 400,
eyebrowLetterSpacing: "0.08em"
},
voice: {...},
social: {...}
}

ERWEITERTE Typography:

{
typography: {
fontFamily: "Inter Variable",      // Bestehend
fontFamilyOptions: [               // NEU: verfügbare Fonts
"Inter Variable",
"Space Grotesk",
"Plus Jakarta Sans",
"Manrope",
"Outfit"
],
headingWeight: 800,                // Bestehend
bodyWeight: 400,                   // Bestehend
eyebrowWeight: 700,                // NEU
captionWeight: 600,                // NEU (für Pricing-Chips etc.)

    eyebrowLetterSpacing: "0.08em",    // Bestehend
    headingLetterSpacing: "-0.02em",   // NEU
    bodyLetterSpacing: "0em",          // NEU
    
    headingSize: 64,                   // NEU: px für 1080px canvas
    subheadSize: 32,                   // NEU
    bodySize: 24,                      // NEU
    eyebrowSize: 18,                   // NEU
    
    headingLineHeight: 1.1,            // NEU
    bodyLineHeight: 1.5,               // NEU
}
}

Migration: optional brand_tokens UPDATE wenn fields fehlen — defaults
liefert das brand-asset-service bei getBrandTokens().

═══════════════════════════════════════════════════════════════════
SECTION 2: API-Endpoints
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
2.1: Asset-Management
──────────────────────────────────────────────────────────────────

GET /api/projects/:slug/brand-assets
Query params: assetType (optional), source (optional)
Returns:
{
assets: Array<{
id, assetType, assetKey, source, sourceRef,
inlineSvg, r2Key, displayName, metadata,
previewUrl: string  // Resolved URL for display
}>,
summary: {
total: number,
bySource: { "simple-icons": N, "iconify": M, ... }
}
}

POST /api/projects/:slug/brand-assets/upload
Body: multipart/form-data
file: SVG or PNG
assetType: 'tool_icon' | 'logo'
assetKey: string (tool-slug or 'main')
displayName: string (optional)

Process:
1. Validate file (svg or png, <500KB, dimensions check)
2. Upload to R2 → assets/{projectId}/{assetType}/{assetKey}-{timestamp}.{ext}
3. Upsert project_brand_assets:
source = 'custom-upload'
r2_key = R2-path
inlineSvg = NULL (für PNG) or SVG-content (für SVG)
4. If existing entry für (project, type, key): override

Returns: { asset: ProjectBrandAsset, previewUrl: string }

DELETE /api/projects/:slug/brand-assets/:assetId
Process:
1. If source === 'custom-upload': delete R2 object
2. Delete row from project_brand_assets
3. Next resolveToolIcon call wird durch Resolution-Chain neu lösen

Returns: { deleted: true, willResolve: 'auto' }

POST /api/projects/:slug/brand-assets/:assetId/reset
Wie DELETE aber gefolgt von triggered Re-Resolve via icon-resolver
Returns: { newAsset: ProjectBrandAsset }

──────────────────────────────────────────────────────────────────
2.2: Brand-Tokens Management
──────────────────────────────────────────────────────────────────

GET /api/projects/:slug/brand-tokens
Returns: { tokens: BrandTokens, defaults: BrandTokens }

PATCH /api/projects/:slug/brand-tokens
Body: { tokens: Partial<BrandTokens> }
Process:
1. Deep-merge mit existing tokens
2. Validate via Zod (gleicher Schema wie aktuell)
3. UPDATE projects.brand_tokens

Returns: { tokens: BrandTokens }

POST /api/projects/:slug/brand-tokens/reset
Body: { sections?: Array<'colors' | 'typography' | 'voice' | 'social'> }
Restored from default per section
Returns: { tokens: BrandTokens }

──────────────────────────────────────────────────────────────────
2.3: Re-Render existing Social-Posts
──────────────────────────────────────────────────────────────────

POST /api/social-posts/:id/re-render
Triggers neue article:social-image Pipeline für same article + format
Erzeugt NEW social_post row (kein In-Place-Update für Audit)
Old post wird auf status='replaced' gesetzt

Returns: { newSocialPostId, pipelineRunId }

POST /api/projects/:slug/social-posts/re-render-batch
Body: { socialPostIds: string[] }
ODER: { filter: { status?, format?, hasEmoji?: boolean } }

Process:
Für jeden Post:
- Trigger neue article:social-image
- Mark old als 'replaced'

Returns: { triggered: N, estimatedCost: $0.0X }

──────────────────────────────────────────────────────────────────
2.4: Color-Conversion Helper
──────────────────────────────────────────────────────────────────

DATEI: apps/api/src/lib/color-utils.ts (NEU)

import { converter, formatHex } from "culori";

export function hexToOklch(hex: string): { l: number, c: number, h: number } {
const oklch = converter("oklch")(hex);
return {
l: Math.round((oklch?.l ?? 0) * 100),  // 0-100
c: Math.round((oklch?.c ?? 0) * 1000) / 1000,  // 0-0.4
h: Math.round(oklch?.h ?? 0)  // 0-360
};
}

export function oklchToHex(l: number, c: number, h: number): string {
return formatHex({ mode: "oklch", l: l / 100, c, h }) ?? "#000000";
}

bun add culori

═══════════════════════════════════════════════════════════════════
SECTION 3: Frontend — Project-Selector Component
═══════════════════════════════════════════════════════════════════

DATEI: apps/web/src/components/projects/ProjectSelector.vue (NEU oder erweitern)

Globaler Project-Switcher in App-Header:

┌────────────────────────────────────┐
│ Project: [▾ toolwiki              ]│
└────────────────────────────────────┘

On click: Dropdown mit allen Projects + "All Projects" Option.
Switch updated globaler Project-Context (Pinia store).

DATEI: apps/web/src/stores/project-context.ts (NEU)

Pinia store mit:
- currentProjectId: string | null
- currentProjectSlug: string | null
- allProjects: Project[]
- setProject(slug): updates context, persists in localStorage

Alle Asset-Management-Pages lesen currentProjectId aus diesem Store.

═══════════════════════════════════════════════════════════════════
SECTION 4: Frontend — Asset-Browser
═══════════════════════════════════════════════════════════════════

DATEI: apps/web/src/pages/projects/brand/AssetBrowser.vue (NEU)

Route: /projects/:slug/brand/assets

LAYOUT:
┌────────────────────────────────────────────────────────┐
│ Asset-Library  ·  toolwiki                              │
│                                                          │
│ [Tool-Icons (47)] [Logos (1)] [All Sources ▾]           │
│                                                          │
│ Filter: Source [All ▾] · Search: [_____________]        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐      │
│  │ MJ   │  │ ICO  │  │ ICO  │  │ AV   │  │ +    │      │
│  │      │  │      │  │      │  │      │  │      │      │
│  │midjny│  │claude│  │openai│  │tool42│  │Upload│      │
│  │ICON  │  │ICON  │  │ICON  │  │AVATR │  │      │      │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘      │
│                                                          │
│  ... grid ...                                            │
│                                                          │
└──────────────────────────────────────────────────────────┘

Pro Asset-Card:
- SVG-Preview (40px) ODER Avatar-Placeholder
- Tool-Slug (asset_key)
- Source-Badge ("simple-icons" / "iconify" / "custom" / "avatar")
- Hover: Action-Buttons [Override] [Reset] [Delete (if custom)]

Click auf Card → Modal mit Details + Upload-Form.

──────────────────────────────────────────────────────────────────
4.1: AssetCard.vue Component
──────────────────────────────────────────────────────────────────

Props: { asset, onSelect }

Source-Badges semantic:
- simple-icons:    blue
- iconify:         green
- lobe-icons:      purple
- custom-upload:   amber (custom is precious)
- deterministic-avatar: gray

──────────────────────────────────────────────────────────────────
4.2: AssetUploadModal.vue
──────────────────────────────────────────────────────────────────

Trigger: click "Override" auf existing Asset OR "+ Upload" card

Form-Fields:
Asset-Type: [Tool-Icon ▾] · [Logo]
Asset-Key:  [text input, prefilled if override]
File:       [Drag-Drop SVG or PNG, max 500KB]
Display-Name: [optional text]

[Cancel] [Upload]

Validation:
- File: nur SVG, PNG, JPG
- Size: max 500KB
- Dimensions: keine harte Grenze aber Warning bei <128px

Upload-Flow:
1. POST /api/projects/:slug/brand-assets/upload (multipart)
2. Optimistic UI: show "Uploading..." in grid
3. Auf Success: refresh grid + close modal
4. Auf Fail: error toast, retain modal

═══════════════════════════════════════════════════════════════════
SECTION 5: Frontend — Color-Settings
═══════════════════════════════════════════════════════════════════

DATEI: apps/web/src/pages/projects/brand/ColorSettings.vue (NEU)

Route: /projects/:slug/brand/colors

LAYOUT:

┌────────────────────────────────────────────────────────┐
│ Color-Settings  ·  toolwiki                             │
│                                                          │
│ ┌──────────────────────┐  ┌──────────────────────────┐ │
│ │ Primary              │  │  Preview                  │ │
│ │ oklch(64% 0.16 248)  │  │                           │ │
│ │                      │  │  [Color-Swatch]           │ │
│ │ L: [────●──] 64%     │  │                           │ │
│ │ C: [──●────] 0.16    │  │  Hex: #4F6FE5             │ │
│ │ H: [────●──] 248°    │  │                           │ │
│ │                      │  │  Contrast vs Background:  │ │
│ │ [Reset to default]   │  │  AA ✓ AAA ✗               │ │
│ └──────────────────────┘  └──────────────────────────┘ │
│                                                          │
│ ┌──────────────────────┐  ┌──────────────────────────┐ │
│ │ Accent (Mint)        │  │  Preview                  │ │
│ │ ...                  │  │  ...                      │ │
│ └──────────────────────┘  └──────────────────────────┘ │
│                                                          │
│ Tokens: primary · accent · surface · surfaceDark ·      │
│         ink · inkMuted · wikiCream                       │
│                                                          │
│ [Save Changes]  [Discard]  [Reset All to Defaults]      │
└──────────────────────────────────────────────────────────┘

──────────────────────────────────────────────────────────────────
5.1: OklchSlider.vue Component
──────────────────────────────────────────────────────────────────

3 Slider für L (0-100), C (0-0.4), H (0-360).

Auf Change:
- Update local state immediate
- Compute Hex via culori (Client-side mit lazy-loaded module)
- Show Hex below sliders
- Debounced API-Call (300ms) to PATCH brand-tokens

Wichtig: kein gamut-check (Q1=B Entscheidung), aber:
- Bei out-of-gamut: warning-icon mit tooltip "Color may not render correctly"
- Berechnet via: oklch → rgb in sRGB range check

──────────────────────────────────────────────────────────────────
5.2: ContrastChecker.vue Component
──────────────────────────────────────────────────────────────────

Berechnet WCAG-Kontrast zwischen Primary und Surface.

Display:
- AA  (4.5:1 für normal text) ✓ / ✗
- AAA (7:1 für normal text) ✓ / ✗

Implementation:
- culori liefert ΔE-basierte Berechnung
- Plus WCAG-Style relative luminance formula

═══════════════════════════════════════════════════════════════════
SECTION 6: Frontend — Typography-Settings
═══════════════════════════════════════════════════════════════════

DATEI: apps/web/src/pages/projects/brand/TypographySettings.vue (NEU)

Route: /projects/:slug/brand/typography

LAYOUT:

┌────────────────────────────────────────────────────────┐
│ Typography-Settings  ·  toolwiki                        │
│                                                          │
│ Font-Family                                              │
│ [Inter Variable     ▾]                                  │
│ Available: Inter, Space Grotesk, Plus Jakarta Sans,     │
│            Manrope, Outfit                              │
│                                                          │
│ Weights                                                  │
│   Heading:  [────●──] 800                               │
│   Body:     [──●────] 400                               │
│   Eyebrow:  [────●──] 700                               │
│   Caption:  [───●───] 600                               │
│                                                          │
│ Letter-Spacing                                           │
│   Heading:  [──●────] -0.02em                           │
│   Body:     [───●───] 0em                               │
│   Eyebrow:  [─────●─] 0.08em                            │
│                                                          │
│ Sizes (für 1080px canvas)                                │
│   Heading:  [───●───] 64px                              │
│   Subhead:  [──●────] 32px                              │
│   Body:     [──●────] 24px                              │
│   Eyebrow:  [─●─────] 18px                              │
│                                                          │
│ Line-Height                                              │
│   Heading:  [──●────] 1.1                               │
│   Body:     [────●──] 1.5                               │
│                                                          │
│ Preview:                                                 │
│ ┌──────────────────────────────────────────────────┐   │
│ │ EYEBROW · TEXT                                   │   │
│ │ Die richtige Bild-KI wählen                      │   │
│ │ redaktionell verifiziert — ehrlich getestet      │   │
│ │                                                   │   │
│ │ • Strength one                                    │   │
│ │ • Strength two                                    │   │
│ └──────────────────────────────────────────────────┘   │
│                                                          │
│ [Save Changes]  [Discard]  [Reset to Defaults]          │
└──────────────────────────────────────────────────────────┘

Preview ist HTML/CSS Mock — verwendet die aktuellen Token-Werte für
Live-Approximation. Echter Carousel-Render via Re-Render-Button.

Font-Family Dropdown:
- Liste aus tokens.typography.fontFamilyOptions
- Jede Option lädt das Font via @remotion/google-fonts on save
- Render-Server muss matching Font-Loading-Code haben (Phase 2)

═══════════════════════════════════════════════════════════════════
SECTION 7: Frontend — Re-Render existing Posts
═══════════════════════════════════════════════════════════════════

──────────────────────────────────────────────────────────────────
7.1: Single-Post Re-Render
──────────────────────────────────────────────────────────────────

DATEI: apps/web/src/components/articles/SocialPostsList.vue (Erweitern)

Pro Social-Post-Card:
- Existing: Preview + Download
- NEU: [↻ Re-render] Button

Click: POST /api/social-posts/:id/re-render
- Confirmation Modal: "Dies erzeugt einen neuen Post mit aktuellen Brand-Settings.
  Cost: ~$0.01. Alter Post wird als 'replaced' markiert. Fortfahren?"
- On confirm: trigger + show new post in list

──────────────────────────────────────────────────────────────────
7.2: Batch Re-Render
──────────────────────────────────────────────────────────────────

DATEI: apps/web/src/pages/projects/social/SocialPostsAdmin.vue (NEU)

Route: /projects/:slug/social-posts/admin

LAYOUT:

┌────────────────────────────────────────────────────────┐
│ Social-Posts Admin  ·  toolwiki                         │
│                                                          │
│ Filter:                                                  │
│   Status: [All ▾]                                       │
│   Format: [All ▾]                                       │
│   Has Emoji-Logos: [Yes/No/All ▾]                       │
│                                                          │
│ [Select All] [Select None]  ·  3 selected                │
│                                                          │
│ Selected Posts:                                          │
│   ☑ recraft-vs-ideogram-2026 · List · 2 days ago        │
│   ☑ midjourney-vs-dalle-2026 · List · 1 day ago         │
│   ☐ flux-pro-review · Single · 3 days ago               │
│                                                          │
│ [Re-render Selected (3 posts, ~$0.03)]                   │
└──────────────────────────────────────────────────────────┘

Detection für "has emoji-logos":
- Query social_posts WHERE created_at < <spec-52a-deployment-date>
- ODER: parse generation metadata für emoji-marker

═══════════════════════════════════════════════════════════════════
SECTION 8: Navigation + Routing
═══════════════════════════════════════════════════════════════════

apps/web/src/router/index.ts

Neue Routes unter /projects/:slug/brand/:

{
path: "/projects/:slug/brand",
meta: { auth: true },
redirect: { name: "BrandAssets" },
children: [
{ path: "assets", name: "BrandAssets", component: AssetBrowser },
{ path: "colors", name: "BrandColors", component: ColorSettings },
{ path: "typography", name: "BrandTypography", component: TypographySettings },
]
}

Plus:
{ path: "/projects/:slug/social-posts/admin", name: "SocialPostsAdmin", ... }

Navigation in MainSidebar.vue:
- Brand-Section unter Projects:
  - Assets
  - Colors
  - Typography

═══════════════════════════════════════════════════════════════════
SECTION 9: i18n
═══════════════════════════════════════════════════════════════════

apps/web/src/i18n/de/brand.ts:

brand: {
navigation: {
assets: "Assets",
colors: "Farben",
typography: "Typografie"
},
assets: {
title: "Asset-Bibliothek",
upload: "Hochladen",
override: "Ersetzen",
delete: "Löschen",
reset: "Zurücksetzen",
confirmDelete: "Asset wirklich löschen? Es wird automatisch neu aufgelöst.",
sources: {
"simple-icons": "Simple Icons",
"iconify": "Iconify",
"lobe-icons": "Lobe Icons",
"custom-upload": "Eigenes Upload",
"deterministic-avatar": "Fallback-Avatar"
}
},
colors: {
title: "Farb-Einstellungen",
tokens: {
primary: "Primärfarbe",
accent: "Akzent",
surface: "Hintergrund",
surfaceDark: "Hintergrund (Dark)",
ink: "Text",
inkMuted: "Text (gedämpft)",
wikiCream: "Wiki-Cream"
},
save: "Speichern",
discard: "Verwerfen",
reset: "Auf Defaults zurücksetzen"
},
typography: {
title: "Typografie",
fontFamily: "Schriftart",
weights: "Gewichtungen",
letterSpacing: "Buchstaben-Abstand",
sizes: "Größen",
lineHeight: "Zeilenhöhe",
preview: "Vorschau"
},
reRender: {
single: "Neu rendern",
batch: "Ausgewählte neu rendern",
confirm: "Dies erzeugt neue Posts mit aktuellen Brand-Settings. Cost: {cost}",
estimated: "Geschätzte Kosten: {cost}"
}
}

EN equivalent translations.

═══════════════════════════════════════════════════════════════════
SECTION 10: Tests
═══════════════════════════════════════════════════════════════════

apps/api/test/routes/brand-assets.test.ts (NEU):
- GET /brand-assets returns all assets for project
- GET filter by assetType works
- POST /upload with valid SVG saves to R2 + DB
- POST /upload with too-large file fails 400
- DELETE removes asset + R2 object
- POST /reset triggers re-resolve via icon-resolver

apps/api/test/routes/brand-tokens.test.ts (NEU):
- GET returns tokens + defaults
- PATCH deep-merges into existing
- PATCH validates Zod schema (rejects invalid)
- POST /reset resets specific sections

apps/api/test/lib/color-utils.test.ts (NEU):
- hexToOklch and oklchToHex round-trip preserves values
- Edge cases: black (#000), white (#fff), out-of-gamut color

apps/web/test/components/AssetCard.spec.ts (NEU):
- Renders asset with correct source-badge
- Click opens detail modal

apps/web/test/components/OklchSlider.spec.ts (NEU):
- 3 sliders render with correct ranges
- onChange emits new oklch values
- Computed hex matches expected

apps/web/test/stores/project-context.spec.ts (NEU):
- setProject persists to localStorage
- currentProjectId computed correctly

═══════════════════════════════════════════════════════════════════
SECTION 11: R2-Setup für Custom-Uploads
═══════════════════════════════════════════════════════════════════

R2-Bucket: bestehender bucket (gleicher wie Hero-Images).
Path-Convention: assets/{projectId}/{assetType}/{assetKey}-{timestamp}.{ext}

Beispiel:
assets/abc-123/tool_icon/recraft-1715632800.svg
assets/abc-123/logo/main-1715632900.png

Public-URL via R2_PUBLIC_URL env-var (gleicher Setup wie Hero).

Permissions: R2-Bucket sollte read-public + write-authenticated sein.
Verify via existing Hero-Image-Setup (sollte schon korrekt).

═══════════════════════════════════════════════════════════════════
SECTION 12: Docs
═══════════════════════════════════════════════════════════════════

apps/web/CLAUDE.md neue Section:

## Brand-Asset-Management

Pro Project bietet die App folgende Brand-Settings:

- /projects/:slug/brand/assets — Asset-Browser + Custom-Upload
- /projects/:slug/brand/colors — OKLCH Color-Picker
- /projects/:slug/brand/typography — Font + Weights + Sizes

Project-Context wird via Pinia-Store verwaltet (project-context.ts).
ProjectSelector in App-Header switched zwischen Projects.

Re-Render existing Social-Posts:
- Single: button in SocialPostsList per Post
- Batch: /projects/:slug/social-posts/admin

apps/api/CLAUDE.md neue Section:

## Brand-Asset-Management API

Endpoints:
- GET    /api/projects/:slug/brand-assets
- POST   /api/projects/:slug/brand-assets/upload (multipart)
- DELETE /api/projects/:slug/brand-assets/:assetId
- POST   /api/projects/:slug/brand-assets/:assetId/reset
- GET    /api/projects/:slug/brand-tokens
- PATCH  /api/projects/:slug/brand-tokens
- POST   /api/projects/:slug/brand-tokens/reset
- POST   /api/social-posts/:id/re-render
- POST   /api/projects/:slug/social-posts/re-render-batch

Custom uploads go to R2 unter assets/{projectId}/{type}/{key}-{timestamp}.{ext}

═══════════════════════════════════════════════════════════════════
ACCEPTANCE
═══════════════════════════════════════════════════════════════════

DB + Backend:
- [ ] project_brand_assets.r2_key column added
- [ ] brand_tokens.typography erweitert (defaults via service)
- [ ] color-utils.ts mit Hex↔OKLCH conversion
- [ ] culori npm-package installed
- [ ] 9 API-Endpoints implementiert + tested
- [ ] R2-Upload-Flow funktioniert für SVG + PNG
- [ ] Re-Render-Endpoint triggert echte Pipeline

Frontend:
- [ ] ProjectSelector + project-context Store
- [ ] AssetBrowser mit Grid + Filter + Search
- [ ] AssetCard mit Source-Badges
- [ ] AssetUploadModal mit Drag-Drop
- [ ] ColorSettings mit OklchSlider + ContrastChecker
- [ ] TypographySettings mit allen Sub-Sliders + Preview
- [ ] SocialPostsAdmin für Batch Re-Render
- [ ] Routes + Navigation registriert
- [ ] i18n DE+EN komplett

Tests:
- [ ] 12+ Tests pass (6 backend + 6 frontend)
- [ ] Existing tests bleiben grün

Production-Readiness:
- [ ] Manual: Upload custom logo für 1 Tool → Override sichtbar in Carousel
- [ ] Manual: Change Primary-Color → Re-render zeigt neue Farbe
- [ ] Manual: Re-render Recraft-vs-Ideogram post → new post hat aktuelle Settings
- [ ] CLAUDE.md updated
- [ ] Branch: feature/brand-asset-management-ui
- [ ] 10-15 granulare Commits

═══════════════════════════════════════════════════════════════════
ESTIMATED EFFORT
═══════════════════════════════════════════════════════════════════

Section 1 (DB-Schema):            30 min
Section 2 (API-Endpoints):       150 min
Section 3 (ProjectSelector):      45 min
Section 4 (AssetBrowser):        180 min
Section 5 (ColorSettings):       120 min
Section 6 (TypographySettings):  120 min
Section 7 (Re-Render UI):         60 min
Section 8 (Navigation):           30 min
Section 9 (i18n):                 30 min
Section 10 (Tests):              120 min
Section 11 (R2-Setup):            15 min
Section 12 (Docs):                15 min

Total focused work: ~14h
Plus +30% Discovery-Buffer: ~18h realistic
Über 3-4 Tage verteilt

═══════════════════════════════════════════════════════════════════
REPORT FORMAT
═══════════════════════════════════════════════════════════════════

audit/BRAND_ASSET_MANAGEMENT_UI.md:

## Implementation
- Branch: feature/brand-asset-management-ui
- Commits: N hash-list

## Features Implemented
- Asset-Browser: ✓ Grid mit X resolved assets
- Custom-Upload: ✓ SVG + PNG, R2-storage
- Color-Settings: ✓ OKLCH 3-slider per token
- Typography: ✓ Family + Weights + Spacing + Sizes
- Re-Render: ✓ Single + Batch

## Manual Testing
- Test 1: Upload custom Recraft logo → seen in next carousel
- Test 2: Change primary color → re-render verified
- Test 3: Batch re-render of 3 emoji-posts → all now have logos

## Cost-Impact
- Custom uploads: $0 (only R2 storage)
- Re-renders: $0.01 per post
- 3 existing posts re-rendered: $0.03 total

## Deviations
- ...

═══════════════════════════════════════════════════════════════════
NICHT IN DIESER SPEC
═══════════════════════════════════════════════════════════════════

- Live-Preview während Editing (D-Entscheidung)
- OKLCH-Gamut-Indicator (B-Entscheidung)
- Multi-User-Permissions
- Asset-Sharing zwischen Projects
- Versioning von Brand-Settings (Undo)
- Bulk-Upload (>1 Asset pro Operation)
- A/B-Testing
- Performance-Analytics
- Comparison-Grid Template (Spec 51a-template-2)
- Use-Case-Mapping Template (Spec 51a-template-3)
- Reel-Generation (Spec 51b)
- Instagram Graph API (Spec 51c)
