# Spec 60 — Pre-Spec Design Audit

**Date:** 2026-05-19
**Auditor:** Claude Code (Spec 60 prep)
**Output consumers:** Marcel + Claude Chat (writing Spec 60.1)

## Input files found

**Design reference HTML (20 files, all at `social/design-reference/project/slides/`):**
- comparison-grid-3-dark.html, comparison-grid-3-light.html, comparison-grid-3-dark-en.html, comparison-grid-3-light-en.html
- comparison-grid-4-dark.html, comparison-grid-4-light.html, comparison-grid-4-dark-en.html, comparison-grid-4-light-en.html
- single-tool-spotlight-dark.html, single-tool-spotlight-light.html, single-tool-spotlight-dark-en.html, single-tool-spotlight-light-en.html
- verdict-per-use-case-dark.html, verdict-per-use-case-light.html, verdict-per-use-case-dark-en.html, verdict-per-use-case-light-en.html
- cover-dark.html, cover-light.html, cover-dark-en.html, cover-light-en.html (bonus — not in original spec)
- **pro-con-verdict: ALL MISSING** (see Section 10)

**CSS token file:** `social/design-reference/project/colors_and_type.css`

**Codebase files read:**
- `packages/social/src/templates/types.ts` — TemplateDefinition interface, ContentBounds, Bounds types
- `packages/social/src/templates/CLAUDE.md` — template authoring guide
- `packages/social/src/compositions/CLAUDE.md` — layout-shift-free convention
- `packages/social/src/compositions/_shared/getFontSize.ts` — discrete font buckets
- `packages/social/src/compositions/list-carousel/types.ts` — brandTokensSchema, ListCarouselInput
- `packages/social/src/compositions/list-carousel/safeZones.ts` — CAROUSEL_SAFE_ZONES
- `packages/social/src/compositions/pro-con-verdict/types.ts` — ProConVerdictInput
- `packages/social/src/compositions/verdict-cards/types.ts` — UseCaseVerdictInput
- `packages/social/src/compositions/single-tool-spotlight/types.ts` — SingleToolSpotlightInput
- `packages/social/src/lib/theme.ts` — getThemeTokens(), pricingColor()
- `packages/social/src/templates/definitions/comparisonGrid3.ts`
- `packages/social/src/templates/definitions/comparisonGrid4.ts`
- `packages/social/src/templates/definitions/verdictPerUseCase.ts`
- `packages/social/src/templates/definitions/singleToolSpotlight.ts`
- `packages/social/src/templates/definitions/proConVerdict.ts`
- `packages/social/src/templates/validateGenerated.ts`
- `packages/db/src/schema/projects.ts` — DB BrandTokens type + brand_tokens column
- `apps/web/src/components/settings/BrandTokensFormEditor.vue` — Settings UI fields

---

## TL;DR (3-5 bullets max)

- The HTML design files use `light-dark()` CSS + the `html.dark` class toggle for theming; the Remotion compositions use `getThemeTokens()` with a `theme: "dark" | "light"` param passed at render time — these two mechanisms are compatible in principle but need a mapping layer.
- The design system CSS defines `--brand-500` / `--brand-300` / `--accent-500` as oklch tokens; the codebase `brandTokensSchema` stores `colors.primary` and `colors.accent` as opaque strings — the new DS token names and the stored names do NOT match 1:1, and the DS color scale has more stops (50/100/300/500/700/900/950) than the schema exposes.
- `pro-con-verdict` is the ONLY template with a full Bounds + slotMap + validateAndReprompt wiring; all other templates declare empty `slotMap: {}` and delegate entirely to `generateContentWithGate()`, meaning no per-field reprompt feedback loop for those templates.
- All HTML files are 1080×1920 (9:16) — 570px taller than the composition canvas (1080×1350, 4:5). Every template needs a deliberate adaptation strategy; the comparison grids and verdict-per-use-case have content-dense body zones that will require reflow, not just crop.
- The DB `BrandTokens` type (in `packages/db`) and the Zod `brandTokensSchema` (in `packages/social`) have diverged: DB has extra typography fields (`fontFamilyOptions`, `eyebrowWeight`, `captionWeight`, etc.) that are absent from the Zod schema; Zod has extra fields added later (`surfaceSecondary`, `eyebrowColor`, `pricingFree/Freemium/Paid`, `prosColor`, `consColor`, `rankBadgeSize`, etc.) that are absent from the DB type. The DB type is the stored format; the Zod schema is the render-time contract — they are out of sync.

---

## 1. Current brand_tokens state

### 1A. Zod schema (`brandTokensSchema`)

**Location:** `packages/social/src/compositions/list-carousel/types.ts` lines 4–57

| Field | Type | Default | Where consumed |
|-------|------|---------|----------------|
| `colors.primary` | `string` | `oklch(64% 0.16 248)` | `theme.ts` → `getThemeTokens()` → bg/brand |
| `colors.primaryHue` | `number` | `248` | Not seen in compositions — may be unused |
| `colors.accent` | `string` | `oklch(72% 0.15 168)` | `theme.ts` → `getThemeTokens()` → accent |
| `colors.surface` | `string` | `#ffffff` | `getThemeTokens()` light mode bg |
| `colors.surfaceDark` | `string` | `oklch(16% 0.02 250)` | `getThemeTokens()` dark mode bg |
| `colors.ink` | `string` | `oklch(20% 0.025 250)` | `getThemeTokens()` light mode ink |
| `colors.inkMuted` | `string` | `oklch(45% 0.025 250)` | `getThemeTokens()` light mode inkMuted |
| `colors.wikiCream` | `string` | `#fef9ec` | Not visible in composition code reviewed |
| `colors.surfaceSecondary` | `string` | `oklch(22% 0.02 248)` | `getThemeTokens()` dark mode surface |
| `colors.eyebrowColor` | `string` | `oklch(85% 0.10 168)` | `getThemeTokens()` eyebrowColor (dark only; light uses primary) |
| `colors.pricingFree` | `string` | `#22c55e` | `theme.ts` → `pricingColor()` |
| `colors.pricingFreemium` | `string` | `#3b82f6` | `theme.ts` → `pricingColor()` |
| `colors.pricingPaid` | `string` | `#f59e0b` | `theme.ts` → `pricingColor()` |
| `colors.prosColor` | `string?` | none | `pro-con-verdict` — `resolveProsColor()` |
| `colors.consColor` | `string?` | none | `pro-con-verdict` — `resolveConsColor()` |
| `typography.fontFamily` | `string` | `Inter Variable, Inter, sans-serif` | Compositions via brandTokens prop |
| `typography.headingWeight` | `number` | `800` | Composition inline styles |
| `typography.bodyWeight` | `number` | `400` | Composition inline styles |
| `typography.eyebrowLetterSpacing` | `string` | `0.08em` | Eyebrow components |
| `typography.rankBadgeSize` | `number` | `72` | `list-carousel` rank badge |
| `typography.rankBadgeWeight` | `number` | `900` | `list-carousel` rank badge |
| `typography.rankBadgeLetterSpacing` | `string` | `-0.03em` | `list-carousel` rank badge |
| `typography.footerWebsiteSize` | `number` | `20` | BrandFooter |
| `typography.footerHandleSize` | `number` | `16` | BrandFooter |
| `typography.footerLabelSize` | `number` | `18` | BrandFooter |
| `typography.footerGap` | `number` | `2` | BrandFooter |
| `voice.locale` | `string` | `de-DE` | Not rendered, informational |
| `voice.addressForm` | `string` | `du` | Not rendered directly |
| `voice.forbiddenWords` | `string[]` | `[]` | `generateContentWithGate()` |
| `voice.signaturePhrases` | `string[]` | `[]` | `generateContentWithGate()` |
| `social.instagramHandle` | `string` | `@toolwiki.ai` | Footer, EndSlide |
| `social.websiteUrl` | `string` | `toolwiki.ai` | Footer, EndSlide, URLs |
| `social.logoAssetKey` | `string` | `main` | BrandLogo asset resolution |

### 1B. DB column (`packages/db/src/schema/projects.ts` line 76)

```
brandTokens: jsonb("brand_tokens").$type<BrandTokens>().notNull().default({})
```

**DB `BrandTokens` type** (line 171) has `colors` object with only: `primary`, `primaryHue`, `accent`, `surface`, `surfaceDark`, `ink`, `inkMuted`, `wikiCream`. Missing from DB type vs Zod schema: `surfaceSecondary`, `eyebrowColor`, `pricingFree/Freemium/Paid`, `prosColor`, `consColor`. The DB `typography` type has more fields than the Zod schema: `fontFamilyOptions`, `eyebrowWeight`, `captionWeight`, `eyebrowLetterSpacing`, `headingLetterSpacing`, `bodyLetterSpacing`, `headingSize`, `subheadSize`, `bodySize`, `eyebrowSize`, `headingLineHeight`, `bodyLineHeight`.

**Divergence summary:** DB type = old/wider typography, fewer color tokens. Zod schema = newer extended color tokens (pricingFree, prosColor, etc.), narrower typography. Neither is a superset of the other. The render path uses Zod schema defaults — the DB type mismatch is latent until a user tries to store the DB-only typography fields.

### 1C. Settings UI (`apps/web/src/components/settings/BrandTokensFormEditor.vue`)

The form editor exposes only: `primary`, `accent`, `surface` (3 color fields). Typography section shows `fontFamily` (select). Voice and social sections visible but only the form editor was partially read. The form UI covers only a subset of what `brandTokensSchema` supports.

---

## 2. colors_and_type.css extracted tokens

**Location:** `social/design-reference/project/colors_and_type.css`

### 2A. Color tokens (`:root`)

| Token | Value | Category |
|-------|-------|----------|
| `--brand-50` | `oklch(97% 0.018 248)` | Brand (hue 248°) |
| `--brand-100` | `oklch(94% 0.040 248)` | Brand |
| `--brand-300` | `oklch(80% 0.100 248)` | Brand |
| `--brand-500` | `oklch(64% 0.160 248)` | Brand (primary) |
| `--brand-700` | `oklch(48% 0.140 248)` | Brand |
| `--brand-900` | `oklch(32% 0.080 248)` | Brand |
| `--brand-950` | `oklch(22% 0.060 248)` | Brand |
| `--accent-500` | `oklch(72% 0.150 168)` | Accent (hue 168°, mint/cyan) |
| `--accent-600` | `oklch(64% 0.160 168)` | Accent |
| `--success` | `oklch(70% 0.160 145)` | Semantic |
| `--warn` | `oklch(78% 0.160 75)` | Semantic |
| `--danger` | `oklch(62% 0.200 28)` | Semantic |
| `--info` | `var(--brand-500)` | Semantic |

### 2B. Surface & ink tokens — light/dark via `light-dark()`

| Token | Light value | Dark value |
|-------|-------------|------------|
| `--surface` | `#ffffff` | `oklch(16% 0.02 250)` |
| `--surface-raised` | `oklch(99% 0.005 250)` | `oklch(20% 0.025 250)` |
| `--surface-sunken` | `oklch(97% 0.010 250)` | `oklch(13% 0.020 250)` |
| `--ink` | `oklch(20% 0.025 250)` | `oklch(95% 0.010 250)` |
| `--ink-muted` | `oklch(20% 0.025 250 / 0.70)` | `oklch(95% 0.010 250 / 0.65)` |
| `--border` | `oklch(92% 0.010 250)` | `oklch(28% 0.020 250)` |

**Dark mode activation:** `html.dark` class + `color-scheme: dark`. Default in HTML files is dark (`html.dark`). Light files remove the `dark` class.

### 2C. Typography tokens

| Token | Value |
|-------|-------|
| `--font-sans` | `"Inter var", "Inter Fallback", "Segoe UI", "Helvetica Neue", Arial, sans-serif` |
| `--font-mono` | `ui-monospace, "SF Mono", "JetBrains Mono", "Menlo", monospace` |
| `--fs-display` | `88px` |
| `--fs-h1` | `56px` |
| `--fs-h2` | `40px` |
| `--fs-h3` | `28px` |
| `--fs-body-lg` | `20px` |
| `--fs-body` | `16px` |
| `--fs-small` | `14px` |
| `--fs-micro` | `12px` |
| `--lh-tight` | `1.05` |
| `--lh-snug` | `1.2` |
| `--lh-normal` | `1.5` |
| `--tracking-tight` | `-0.02em` |
| `--tracking-cap` | `0.12em` |

### 2D. Spacing tokens

| Token | Value |
|-------|-------|
| `--s-1` | `4px` |
| `--s-2` | `8px` |
| `--s-3` | `12px` |
| `--s-4` | `16px` |
| `--s-5` | `24px` |
| `--s-6` | `32px` |
| `--s-7` | `64px` |
| `--s-8` | `96px` |

### 2E. Radius tokens

| Token | Value |
|-------|-------|
| `--r-xs` | `4px` |
| `--r-sm` | `8px` |
| `--r-md` | `16px` |
| `--r-lg` | `1rem` |
| `--r-pill` | `999px` |

### 2F. Shadow tokens

| Token | Value |
|-------|-------|
| `--shadow-1` | `0 1px 2px oklch(0% 0 0 / 0.06), 0 4px 12px oklch(0% 0 0 / 0.05)` |
| `--shadow-2` | `0 1px 0 oklch(0% 0 0 / 0.04), 0 16px 32px -12px oklch(0% 0 0 / 0.18)` |

---

## 3. HTML pattern analysis

### 3A. Cross-template constants

All four template HTML files (plus the bonus cover) share these patterns:

| Element | Value |
|---------|-------|
| Canvas size | `1080×1350px` |
| Canvas padding | `56px` all sides |
| Root layout | CSS Grid with `grid-template-rows`, last row = footer |
| Background glow | `::before` pseudo-element, `radial-gradient(closest-side, ...)`, `filter: blur(50-70px)` — position varies per template |
| Font stack | `var(--font-sans)` from CSS tokens |
| Eyebrow row (top) | `.eyebrow` div — `font-size: 17px`, `letter-spacing: 0.14em`, ALL-CAPS |
| Slide counter | `.num` or `.right` — mono font, `font-size: 17px`, `color: var(--ink-muted)` |
| Footer structure | `.foot` with flex space-between: logo left (44px height), CTA text right |
| Card border radius | `18px` consistently across tool cards (`.tcard`, `.blk`, `.score-blk`) |
| Winner badge | `.flag` pill — `var(--accent-500)` bg, `#06291f` text, `border-radius: 999px`, `font-size: 13px`, `letter-spacing: 0.14em` |
| Score numbers | Mono font, `font-feature-settings: "tnum"`, high negative `letter-spacing` |
| Light mode page bg | `#d8d6d0` (warm gray) |
| Dark mode page bg | `#050507` |

### 3B. Per-template signatures

| Template | Hero (H1) size | Background glow position | Body layout | Score presentation |
|----------|---------------|--------------------------|-------------|-------------------|
| `comparison-grid-4` | 60px, `line-height: 1.08`, `letter-spacing: -0.035em` | Top-right `inset: -240px -240px auto auto` | 4-row grid, each `150px` tall, 3-col (logo / mid / score) | Large mono `84px` score in right column |
| `comparison-grid-3` | 60px, same as grid-4 | Bottom-left `inset: auto auto -240px -240px` | 3-row auto grid with 2-col bullet rows inside each card | `56px` score (smaller than grid-4 to fit 3 cards) |
| `single-tool-spotlight` | `76px` tool name (not h1), `--4em letter-spacing` | Bottom-right `inset: auto -300px -300px auto` | 6-row grid: top / hero-tool / verdict-line / stats-row / body-grid / foot | `88px` score in dedicated score-blk, plus 2×2 facts grid |
| `verdict-per-use-case` | 60px, accent-colored `.em` span | Top-left `inset: -240px auto auto -240px` | List of `.uc` rows: index / label / winner-pill (flex) | No numeric score — winner pill with tool logo + name |
| `cover` (bonus) | `120px`, `letter-spacing: -0.045em` | DUAL glow: `::before` brand top-right, `::after` accent bottom-left | 6-row grid: top / cat-strip / hero / stats / logos / foot | 3-column stats bar with `48px` mono numbers |

### 3C. Light vs dark deltas

The dark/light difference is **purely CSS-variable driven**. The only structural HTML changes between light and dark pairs are:

1. `html` element: `class="dark"` removed for light
2. `body` background: `#050507` (dark) → `#d8d6d0` (light)
3. `data-screen-label` value on `.template`

All visual differences flow from `light-dark()` in CSS custom properties:
- `--surface`: `#ffffff` (light) vs `oklch(16% 0.02 250)` (dark)
- `--surface-raised`: near-white (light) vs dark near-black (dark)
- `--ink`: near-black (light) vs near-white (dark)
- `--ink-muted`: 70% opacity near-black (light) vs 65% opacity near-white (dark)
- `--border`: near-white-gray (light) vs dark gray (dark)

Light mode additions (via `html:not(.dark)` rules, present in all files):
- `.template` bg overridden to `oklch(99% 0.005 250)` (near-white with slight blue-gray tint)
- `.tcard`, `.blk`, `.score-blk`, `.facts` all gain `box-shadow: var(--shadow-1)` for depth
- Cover template: glow intensities adjusted (brand 42%→28%, accent 22%→16%)
- Cover `.update` badge: `color: var(--brand-700)` instead of `var(--brand-300)`

### 3D. DE vs EN variants

DE/EN variants are content-only changes — zero CSS/layout changes. Confirmed by `diff` comparison:

- `lang="de"` → `lang="en"` on `<html>`
- Eyebrow text: `"Vergleich · 4 Bildgeneratoren"` → `"Comparison · 4 image generators"`
- Date/URL: `"Stand 05/2026 · toolwiki.ai/bilder"` → `"As of 05/2026 · toolwiki.ai/images"`
- H1: German → English translation
- Winner badge: `"Testsieger"` → `"Top pick"`
- Footer CTA: `"Vollständiger Test →"` → `"Full review →"`
- URL slug: `toolwiki.ai/bilder` → `toolwiki.ai/images`

**Implication for Spec 60.1:** EN locale support requires only copy-string mapping, not layout branching.

---

## 4. brand_tokens gap analysis

### Gap A — Fields used in HTML/CSS but missing from brandTokensSchema

| DS token | Usage in HTML | brandTokensSchema equivalent | Gap type |
|----------|---------------|------------------------------|----------|
| `--brand-300` | `h1 .em` color, link hover | No `brand300` field — only `primary` (= brand-500) | MISSING: lighter accent stop |
| `--brand-700` | Cover update badge light mode | No `brand700` field | MISSING: darker accent stop |
| `--surface-raised` | Card backgrounds (`.tcard`, `.blk`) | No explicit token — `surface` + `surfaceDark` covers top-level only | MISSING: raised surface stop |
| `--surface-sunken` | Pill/chip backgrounds | Not present | MISSING |
| `--border` | Card borders, separator lines | No `border` token in schema | MISSING |
| `--shadow-1`, `--shadow-2` | Card shadows in light mode | No shadow tokens | MISSING |
| `--font-mono` | Score numbers, slide counters | No mono font token | MISSING |
| `--r-xs`…`--r-md` | Card radii (18px used) | No radius tokens | MISSING (hardcoded 18px in compositions) |
| Spacing scale `--s-*` | `row-gap`, `column-gap`, `padding` | No spacing tokens | MISSING (all hardcoded px in compositions) |

### Gap B — Fields in brandTokensSchema NOT used in HTML/CSS reference

| Schema field | Status |
|-------------|--------|
| `colors.wikiCream` | Not seen in HTML reference; may be unused |
| `colors.primaryHue` | Numeric hue for programmatic use, not a CSS var |
| `colors.pricingFree/Freemium/Paid` | Used in `pricingColor()` but no HTML reference |
| `colors.prosColor/consColor` | pro-con-verdict only, not in HTML (no HTML file exists) |
| `typography.rankBadgeSize/Weight/LetterSpacing` | list-carousel only, not in DS reference |
| `typography.footerWebsiteSize/HandleSize/LabelSize/Gap` | footer-specific sizing |
| `voice.*` | Not visual tokens — prompt/copy guidance |

### Gap C — Fields needing restructuring for multi-theme

The DS has a 7-stop brand scale and 2 accent stops; `brandTokensSchema` has only `primary` and `accent`. Multi-theme support requires either:
- Storing the full hue+lightness+chroma triple and deriving all stops at render time
- Adding explicit `brand300`, `brand500`, `brand700` fields

The DS surface tokens use 3 stops (`--surface`, `--surface-raised`, `--surface-sunken`) but the schema only distinguishes `surface` (light) vs `surfaceDark`. The raised/sunken stops are missing.

---

## 5. 9:16 → 4:5 adaptation per template

All HTML design files are `1080×1920px`. All compositions render at `1080×1350px`. Delta: **570px height** must be absorbed.

| Template | Strategy | Where 570px disappear | Key risk |
|----------|----------|----------------------|----------|
| `comparison-grid-4` | **Compress** | Cards in the 4-row `.stack` can shrink from `150px` each → ~`90-100px` each (saves ~200-240px); remaining 330px from reducing hero h1 margins + row-gap | Score numbers (84px) in each card fight space; may need to drop to 64-72px |
| `comparison-grid-3` | **Compress** | 3-card stack auto-height — bullets inside each card can compress; remove 2-col bullet grid in favor of 3 bullets max | Bullet rows per card are the main visual density; at 4:5 this template risks feeling cramped |
| `single-tool-spotlight` | **Reflow** | 6-row grid loses hero-tool row height (128px logo) or `stats-row` shrinks; `body-grid` (the 2-col blk layout) absorbs most of the cut | `stats-row` has a `88px` score — must either shrink or convert to inline stat-strip |
| `verdict-per-use-case` | **Crop** | Reduce from 7 visible `.uc` rows to 5-6; the list is scrollable in concept | List rows at `22px` label font need ~48px each min; 7 rows = ~336px + header + footer leaves little breathing room anyway |
| `pro-con-verdict` | **Compress** | NO HTML reference; from code: pros slide, cons slide are list-based — list items can compress | Diagonal split cover (composition-unique) — height reduction changes the SVG clipPath proportions |
| `cover` (bonus) | **Compress** | Hero h1 at `120px` is the dominant element; reduce to `88-96px` + remove one stats column or make stats more compact | Dual-glow effect needs recalibrating for 4:5 aspect |

**Note on CANVAS_H_4_5:** Compositions already use `1350` (CAROUSEL_SAFE_ZONES.CANVAS_H_4_5). The HTML design files are 9:16 mockups that represent a desired visual style, not the target pixel dimensions. Spec 60.1 must clarify whether to adapt each template to fit 1350px or whether some templates should be laid out fresh for 4:5 using the DS design language.

---

## 6. Multi-theme schema recommendation

### Candidates evaluated

**Candidate 1 — Single `theme: "dark" | "light"` enum + compute all DS tokens at render time from brandTokens.colors.primary + hue**

- Pro: simple storage, minimal schema change
- Con: requires computing 7 brand stops + 2 accent stops from hue; oklch math must happen in Node before render; primary stored as string means parsing needed
- Verdict: viable if a `deriveThemeTokensFromBrand(primary: string, theme: "dark"|"light") => ThemeTokens` helper is added

**Candidate 2 — Extend brandTokensSchema with explicit DS token names (`brand300`, `brand500`, `brand700`, `surfaceRaised`, `border`, etc.)**

- Pro: explicit, no math at render time, Settings UI can expose them
- Con: heavy schema migration; 15+ new fields; Settings UI becomes complex; most users only need to customize primary color
- Verdict: over-engineered for current scale

**Candidate 3 — Keep current schema, add `themeConfig: { dark: {...overrides}, light: {...overrides} }` nested block for per-theme overrides**

- Pro: backward compatible; only power users touch theme overrides
- Con: complex merge logic at render time; unclear which fields are theme-specific vs global

**Recommendation: Candidate 1** — but implement as two small additions:
1. Add `colors.brandHue: z.number().default(248)` and `colors.accentHue: z.number().default(168)` — all stops are derived from hue at render time
2. Add `colors.surfaceRaised: z.string().optional()` and `colors.border: z.string().optional()` — explicit overrides when brand color differs enough to need custom surface/border

**Rationale:** The DS uses a single `--brand-*` scale with one hue. `getThemeTokens()` already derives `brand` and `accent` from stored string. Adding hue numbers allows computing all 7 stops via `oklch(L% C brandHue)` without storing the full scale. This matches how the DS itself works (`hue 248°` is the single input). The Settings UI stays simple (one hue slider).

---

## 7. Per-render theme selection

### Q1: WHERE does theme choice live?

**Current state:** `theme: "dark" | "light"` is a field in the `POST /api/social-posts` request body (default: `"dark"`), stored on the `social_posts` table. Re-render reads `post.theme` from DB (`apps/api/src/routes/social-posts.ts` line 325).

**Recommendation:** Keep theme on the `social_posts` row — it was chosen at generation time and re-render preserves it. The theme is part of the render identity (same article can have a dark and a light version).

### Q2: HOW is theme set?

**Current state:** The trigger UI sends `theme` in the POST body. Default is `"dark"`. The batch re-render uses `post.theme` from DB.

**Recommendation:** The gallery/preview UI should let users pick theme before triggering (already a UI input). For automation/cron generation, add `socialRenderTheme` to project settings (defaulting to `"dark"`). The per-post stored `theme` remains authoritative for re-renders.

### Q3: WHAT happens on re-render?

**Current state:** `POST /:id/re-render` reads `post.theme` from the stored post record (line 325), passes it to the worker. Re-render uses CURRENT brand tokens but the SAME theme as the original render.

**Recommendation:** This is correct. Re-render should preserve the original theme unless explicitly overridden. Add an optional `?theme=light` query param to the re-render endpoint for deliberate theme switching.

---

## 8. 59.3.5 compatibility check

### 8A. comparison-grid-3 and comparison-grid-4

Both use `generateContentWithGate()` → `slotMap: {}` → no `getFontSize` assertions currently.

| Element | Risk | Proposed adaptation |
|---------|------|-------------------|
| Tagline (per tool) | Up to 120 chars (`tagline.max: 120`) — no bucket covers this; `slot-body` last entry is 280px but font is 32px, tagline should be larger | Add `"tool-tagline"` slot type: `[{ maxChars: 60, fontSize: 40 }, { maxChars: 120, fontSize: 32 }]` |
| Strengths items | Up to 60 chars — fits `list-item` bucket (36px for ≤40, 28px for ≤80) | Apply `list-item` slot to `strengths` items |
| Cover headline | Lead+highlight — no `getFontSize` in CoverSlideStunning; uses `computeHookFontSize()` continuous algorithm | Violates "no continuous scaling" rule in Spec 59.3.5; needs migration to bucket approach for Spec 60 |
| `slotMap: {}` | All three fields (`tagline`, `strengths`, bounds) are declared but not mapped | Populate slotMap once `getFontSize` is applied |

### 8B. verdict-per-use-case

| Element | Risk | Proposed adaptation |
|---------|------|-------------------|
| Use-case label (`.uc .label`) | `22px` in HTML, bounds: `useCase.max: 50`, `reason.max: 160` — reason not rendered in list view, only in per-verdict detail slide | Map `useCase` → `"slot-headline"` (48-64px) — HTML uses 22px which is smaller; need new `"list-label"` slot or accept mismatch |
| Winner name in pill | Hardcoded in composition, short — no LLM content | No change needed |
| `slotMap: {}` | As above | Populate after slot decision |

### 8C. single-tool-spotlight

| Element | Risk | Proposed adaptation |
|---------|------|-------------------|
| Tool name (`76px` in HTML) | Not LLM-produced — comes from `article.title`; not in bounds | No bounds change; but `getFontSize` could be applied for long names |
| Pros/cons items | `bounds.pros.perItemMaxChars: 80` — fits `list-item` bucket at 28px | Apply `list-item` to pros/cons items in StrengthsSlide, ConsSlide |
| `slotMap: {}` | pros/cons/features/useCases declared in bounds | Populate `pros`, `cons`, `features`, `useCases` → `"list-item"` |

### 8D. pro-con-verdict

| Element | Risk | Status |
|---------|------|--------|
| `verdictSnippet` | `max: 80` → `cover-snippet` bucket (44-56px) | DONE — slotMap correctly maps to `"cover-snippet"` |
| `whenToUse` / `whenToSkip` | `max: 280` → `slot-body` bucket (32px) | DONE — slotMap correctly maps to `"slot-body"` |
| `pros`/`cons` in composition `types.ts` | `min: 5, max: 120` in `ProConVerdictInput` — bounds say `max: 80` per item | MISMATCH: `proConVerdictInputSchema` allows 120 chars; `proConVerdictBounds.prosVisible.perItemMaxChars` is 80. The composition accepts wider input than the bounds document |

---

## 9. LLM Constraint Injection

### 9A. Current state per template

| Template | Mechanism | Prompt has hardcoded limits? | validateAndReprompt? |
|----------|-----------|------------------------------|---------------------|
| `comparison-grid-4` | `generateContentWithGate()` — produces hook+caption+hashtags only | No per-field limits in prompt (handled inside core) | No — `generateContentWithGate()` has its own internal retry |
| `comparison-grid-3` | Same as grid-4 | Same | No |
| `verdict-per-use-case` | `generateContentWithGate()` | Same | No |
| `single-tool-spotlight` | `generateContentWithGate()` | Same | No |
| `pro-con-verdict` | Custom LLM call + `validateAndReprompt()` | YES — prompt string references bounds: `"${proConVerdictBounds.verdictSnippet.min}–${proConVerdictBounds.verdictSnippet.max} chars"` | YES — `maxReprompts: 1` |

### 9B. Drift detection table

Only `pro-con-verdict` has both bounds objects AND prompt-string limits. Check for drift:

| Field | Bounds-object max | Prompt-string max | Drift? |
|-------|------------------|-------------------|--------|
| `verdict_snippet` | 80 | `${proConVerdictBounds.verdictSnippet.max}` → 80 (dynamic) | NO drift — template literal references bounds object |
| `when_to_use` | 280 | `${proConVerdictBounds.whenToUse.max}` → 280 (dynamic) | NO drift |
| `when_to_skip` | 280 | `${proConVerdictBounds.whenToSkip.max}` → 280 (dynamic) | NO drift |
| `caption_body` | 1800 | Not referenced in prompt string (just CTA instruction) | Minor: prompt says "3-5 sentences" but max is 1800 chars |

**Observation:** `pro-con-verdict` correctly uses `${proConVerdictBounds.field.max}` template literals in the prompt. This is the right pattern — bounds as single source of truth with dynamic prompt injection. The comparison-grid templates have NO per-field rendering bounds in their prompts at all (only `generateContentWithGate()` governs hook/caption/hashtags).

### 9C. Reprompt observations

`validateAndReprompt()` in `packages/social/src/templates/validateGenerated.ts`:

- Tracks attempts via a `for` loop counter (0 to `maxReprompts`)
- On failure: calls `reprompt(hints)` where hints are Zod error messages formatted for the LLM
- **No telemetry tracking** — no counter stored to DB, no log line emitted on reprompt fire, no `pino.warn` on failure path
- Falls through to `buildFallbackContent()` in the catch block — silently uses fallback
- Flag as **missing telemetry**: reprompt frequency is invisible. If the LLM consistently fails validation, we have no signal without telemetry.

### 9D. Bilingual implementation state

| Template | Locale param accepted? | Bilingual in prompt? | Bounds per locale? |
|----------|----------------------|---------------------|-------------------|
| `comparison-grid-3/4` | YES — `locale` passed to `generateContentWithGate()` | Handled inside `generateContentWithGate()` + `buildHashtagInstructions()` | No locale-specific bounds |
| `verdict-per-use-case` | YES — same | Same | No |
| `single-tool-spotlight` | YES — same | Same | No |
| `pro-con-verdict` | YES — `locale` passed to `generateContent()` | YES — `outputLang` variable: `"German output, du-form"` or `"English output"` inserted into user prompt | No — same bounds for both locales |

**Gap:** `pro-con-verdict` prompt says "German output, du-form" vs "English output" but `verdictSnippet.max: 80` applies to both. German compound words are shorter per idea but longer per word — the 80-char limit may be too tight for German. No locale-split bounds exist anywhere.

### 9E. Mechanic recommendation

**Recommendation: Mechanic B — `buildConstraintBlock()` utility function**

Rationale:
- Mechanic A (inline template literals like `${bounds.field.max} chars`) works but is copy-paste-prone and incompatible with bilingual notes
- Mechanic B centralizes constraint formatting in one place, allows locale-aware phrasing, can be updated once to fix all templates
- Mechanic C (Zod-generated constraint descriptions) would require running Zod introspection at prompt-build time — adds complexity for limited benefit

### 9F. buildConstraintBlock design sketch (Mechanic B)

```typescript
// packages/social/src/templates/lib/buildConstraintBlock.ts

import type { ContentBounds, FieldBound, ListBound } from "../types.ts";

export function buildConstraintBlock(
  bounds: ContentBounds,
  locale: "de" | "en",
  fieldsToInclude?: string[],
): string {
  const fields = fieldsToInclude ?? Object.keys(bounds);
  const lines = fields.map((key) => {
    const b = bounds[key];
    if (!b) return null;
    if ("perItemMaxChars" in b) {
      // ListBound
      return locale === "de"
        ? `- ${key}: max ${b.max} Einträge, jeder Eintrag max ${b.perItemMaxChars} Zeichen`
        : `- ${key}: max ${b.max} items, each item max ${b.perItemMaxChars} chars`;
    }
    // FieldBound
    const fb = b as FieldBound;
    return locale === "de"
      ? `- ${key}: ${fb.min}–${fb.max} Zeichen`
      : `- ${key}: ${fb.min}–${fb.max} chars`;
  }).filter(Boolean);

  const header = locale === "de"
    ? "ZEICHENLIMITS (strikt einhalten):"
    : "CHARACTER LIMITS (must be respected):";

  return `${header}\n${lines.join("\n")}`;
}
```

**Example output (DE):**
```
ZEICHENLIMITS (strikt einhalten):
- verdict_snippet: 20–80 Zeichen
- when_to_use: 30–280 Zeichen
- when_to_skip: 30–280 Zeichen
```

**Example output (EN):**
```
CHARACTER LIMITS (must be respected):
- verdict_snippet: 20–80 chars
- when_to_use: 30–280 chars
- when_to_skip: 30–280 chars
```

### 9G. Spec-placement recommendation

**Recommendation: Placement Z — new dedicated spec section**

The constraint injection mechanic is cross-template infrastructure. It should be specced in `specs/60.2-constraint-injection.md` (or similar), referenced from each per-template Spec 60.x file. This avoids duplicating the same mechanic description across 5 template specs and allows the utility to be upgraded independently.

---

## 10. Open questions for Marcel

1. **Should Spec 60 target 1080×1920 (9:16) or stay at 1080×1350 (4:5)?**
   The HTML design files are 9:16. All existing compositions are 4:5. If Spec 60 means "refresh the visual style to match the DS" the aspect ratio stays 4:5. If it means "implement the HTML files as Remotion comps" the aspect ratio changes. This changes the scope dramatically.
   _Default if no response: keep 4:5 (1080×1350); the HTML files are visual style references, not dimension specs._

2. **What font replaces SpaceGrotesk? The DS uses Inter Variable.**
   The compositions currently use `@remotion/google-fonts/SpaceGrotesk`. The HTML reference uses `"Inter var"` from `https://rsms.me/inter/inter.css`. Remotion needs the font loaded via `@remotion/google-fonts/Inter` or a self-hosted variant.
   _Default if no response: migrate to Inter Variable, add `bun add @remotion/google-fonts/Inter`._

3. **How should the cover slide (bonus HTML file) be treated?**
   A `cover` template key does not exist in `TemplateKey` union. The cover HTML is the most visually different design. Should Spec 60 introduce a standalone `cover` composition or redesign the existing `CoverSlideStunning.tsx`?
   _Default: redesign `CoverSlideStunning.tsx` only; do not add a new TemplateKey._

4. **What happens to `wikiCream` (`#fef9ec`)?**
   This value appears in `brandTokensSchema` but is not present in the new DS reference CSS. Is it still used anywhere? Should it be removed?
   _Default: keep but deprecate (add JSDoc comment); remove in Spec 61+._

5. **Should `brandTokensSchema` be updated to include DS token names (`brand300`, `brand700`, `surfaceRaised`, `border`)?**
   The gap analysis found that these DS-level tokens are not exposed as overridable brand tokens. They matter for multi-brand support (e.g. Bellemann with a different primary hue).
   _Default: add `colors.brandHue: z.number().default(248)` only; derive all stops at render time._

6. **What should happen to `pro-con-verdict` which has no HTML design reference?**
   The template's diagonal split-screen cover is unique to the codebase. Should Spec 60 define new HTML mockups for it, skip it, or treat it as out-of-scope?
   _Default: treat `pro-con-verdict` as out-of-scope for Spec 60 visual refresh; audit it separately._

7. **Is the reprompt telemetry gap a Spec 60 concern or a separate spec?**
   `validateAndReprompt()` fires silently with no log line or metric when a reprompt occurs or fails. Should Spec 60 address this or file as a separate observability task?
   _Default: out of scope for Spec 60; file as a separate task._

8. **The `pro-con-verdict` composition `types.ts` accepts `pros/cons` items up to 120 chars but `proConVerdictBounds.prosVisible.perItemMaxChars` is 80. Should this mismatch be fixed in Spec 60?**
   The input schema is wider than what the bounds document. Either the input schema needs to cap at 80, or the bounds need to increase to 120.
   _Default: fix input schema max to match bounds (80 chars) — layout correctness takes precedence._

9. **The Settings UI (`BrandTokensFormEditor.vue`) only exposes 3 color fields. Should Spec 60 expand it to expose the new DS tokens (`brandHue`, `accentHue`, etc.)?**
   More tokens → more Settings UI complexity → more fields admins can break.
   _Default: add `brandHue` as a hue-angle slider (0–360); keep accent derivation automatic._

---

## Appendix: file path inventory

### HTML design reference files
```
social/design-reference/project/slides/comparison-grid-3-dark.html
social/design-reference/project/slides/comparison-grid-3-light.html
social/design-reference/project/slides/comparison-grid-3-dark-en.html
social/design-reference/project/slides/comparison-grid-3-light-en.html
social/design-reference/project/slides/comparison-grid-4-dark.html
social/design-reference/project/slides/comparison-grid-4-light.html
social/design-reference/project/slides/comparison-grid-4-dark-en.html
social/design-reference/project/slides/comparison-grid-4-light-en.html
social/design-reference/project/slides/single-tool-spotlight-dark.html
social/design-reference/project/slides/single-tool-spotlight-light.html
social/design-reference/project/slides/single-tool-spotlight-dark-en.html
social/design-reference/project/slides/single-tool-spotlight-light-en.html
social/design-reference/project/slides/verdict-per-use-case-dark.html
social/design-reference/project/slides/verdict-per-use-case-light.html
social/design-reference/project/slides/verdict-per-use-case-dark-en.html
social/design-reference/project/slides/verdict-per-use-case-light-en.html
social/design-reference/project/slides/cover-dark.html
social/design-reference/project/slides/cover-light.html
social/design-reference/project/slides/cover-dark-en.html
social/design-reference/project/slides/cover-light-en.html
social/design-reference/project/colors_and_type.css
```

### Key codebase files
```
packages/social/src/templates/types.ts                          — TemplateDefinition, ContentBounds, FieldBound, ListBound
packages/social/src/templates/CLAUDE.md                         — template authoring guide
packages/social/src/compositions/CLAUDE.md                      — layout-shift-free convention
packages/social/src/compositions/_shared/getFontSize.ts         — discrete font buckets, BUCKETS, SlotType
packages/social/src/compositions/list-carousel/types.ts         — brandTokensSchema, BrandTokens, ListCarouselInput
packages/social/src/compositions/list-carousel/safeZones.ts     — CAROUSEL_SAFE_ZONES (1080×1350)
packages/social/src/compositions/list-carousel/CoverSlideStunning.tsx — computeHookFontSize (continuous, flagged)
packages/social/src/compositions/pro-con-verdict/types.ts       — ProConVerdictInput, bounds mismatch site
packages/social/src/compositions/verdict-cards/types.ts         — UseCaseVerdictInput
packages/social/src/compositions/single-tool-spotlight/types.ts — SingleToolSpotlightInput
packages/social/src/lib/theme.ts                                — getThemeTokens(), pricingColor()
packages/social/src/templates/definitions/comparisonGrid3.ts    — comparisonGrid3Bounds, generateContent
packages/social/src/templates/definitions/comparisonGrid4.ts    — comparisonGrid4Bounds, generateContent
packages/social/src/templates/definitions/verdictPerUseCase.ts  — verdictPerUseCaseBounds, generateContent
packages/social/src/templates/definitions/singleToolSpotlight.ts — singleToolSpotlightBounds, generateContent
packages/social/src/templates/definitions/proConVerdict.ts      — proConVerdictBounds, validateAndReprompt wiring
packages/social/src/templates/validateGenerated.ts              — validateAndReprompt(), no telemetry
packages/db/src/schema/projects.ts:76                           — brand_tokens DB column, BrandTokens DB type (line 171)
apps/web/src/components/settings/BrandTokensFormEditor.vue      — Settings UI (3 color fields exposed)
apps/api/src/routes/social-posts.ts:27                          — theme stored in social_posts, re-render reads from post
```
