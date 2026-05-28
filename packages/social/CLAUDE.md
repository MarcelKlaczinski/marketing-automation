# packages/social — Remotion Compositions

## Template Naming Convention

Template keys describe **format/structure**, not **aspiration**. Use kebab-case.

Patterns:
- `<format>-<modifier>` — e.g., `comparison-grid-4`, `news-slide`
- `<role>-per-<unit>` — e.g., `verdict-per-use-case`
- `<scope>-<format>` — e.g., `single-tool-spotlight`

Avoid:
- Aspirational adjectives: stunning, amazing, perfect, beautiful
- Trend-coupled words: "2024", "modern", "latest"
- Version numbers in the key (use variants via modifier instead)

Display names (i18n labels) can be human-friendly; keys must be semantic.

## BrandTokens Schema (Spec 60.0)

`brandTokensSchema` and `BrandTokens` have moved to `@marketing-auto/shared/brand-tokens`. Import from there in new code:

```typescript
import { brandTokensSchema, type BrandTokens, DEFAULT_BRAND_TOKENS } from "@marketing-auto/shared/brand-tokens";
```

`packages/social/src/compositions/list-carousel/types.ts` re-exports them for back-compat. The `packages/social/src/lib/index.ts` re-export also resolves to shared. `packages/social/src/brand-tokens/index.ts` also exports `deriveDsTokens` and `DsTokens` (Spec 60.0b).

**DS token derivation (Spec 60.0b)** — new visual-refreshed compositions (60.1+) derive the full render-time token set via:

```typescript
import { deriveDsTokens, type DsTokens } from "../brand-tokens/derive";
// or via barrel:
import { deriveDsTokens } from "@marketing-auto/social/brand-tokens";

const tokens = deriveDsTokens(brandTokens, theme); // pure, call inside useMemo
```

`DsTokens` contains: 7 brand stops, 2 accent stops, surface/border/ink, semantic colors, shadows (light only), pricing colors, and typography. Do NOT reach into `brandTokens` directly in slide components — call `deriveDsTokens` once and pass `tokens` down. See `src/ds-components/CLAUDE.md` for the three shared components that consume it.

## What this package does

Renders Instagram carousel slides as PNG via Remotion 4 (headless Chrome).
Entry: `render-server.ts` → `renderListCarousel()` returns `Buffer[]` (one per slide).
Compositions live in `src/compositions/<template-name>/`, shared primitives in `src/shared/`.

## Reference template: single-tool-spotlight (Spec 60.1)

For new visual-refreshed templates, look at `src/compositions/single-tool-spotlight/` as the canonical pattern:
- One composition file per slide-type (`CoverSlide.tsx` / `BodySlide.tsx` / `EndSlide.tsx`)
- Top-level dispatcher (`SingleToolSpotlight.tsx`) switches on `slideIndex`
- `deriveDsTokens()` called once at the top of each slide component, memoized via `useMemo`
- `<DsGlow>` / `<DsTop>` / `<DsFoot>` consumed for shared visual elements
- Template-internal subcomponents (`HeroTool`, `VerdictLine`, etc.) live in `shared/` inside the composition folder
- Inter Variable font loaded at module scope in `loadFonts.ts` via `@remotion/google-fonts/Inter`
- LLM prompt uses `buildConstraintBlock(bounds, locale)` from `src/templates/lib/buildConstraintBlock.ts` for character limits

The `resolveBrandTokens(unknown) → BrandTokens` helper is at `src/lib/brand-tokens.ts` — use it at the top of every slide component to convert the loosely-typed `brandTokens?: unknown` from the input schema into a typed `BrandTokens` before passing to `deriveDsTokens`.

## Template Inventory (as of Spec 65.7)

| Key | Slides | Cover Signature | Eligible content |
|-----|--------|-----------------|-----------------|
| `comparison-grid-4` | **1 (single still)** | 4-up tool grid, top-right glow, 84px score | comparison articles, **exactly 4 tools**, `domainExtras.tools[].score` required |
| `comparison-grid-3` | **7 (carousel — Spec 65.7)** | Cover → Compare-Header → 3 Tools → Verdict → End | comparison articles, **≥3 tools**, `domainExtras.tools` |
| `comparison-grid-5` | **9 (carousel — Spec 65.7)** | Cover → Compare-Header → 5 Tools → Verdict → End | comparison articles, **≥5 tools**, `domainExtras.tools` |
| `verdict-per-use-case` | **1 (single still)** | 5–7 flat use-case rows, **top-left glow, accent-500** (only template), winner pill | comparison articles, ≥3 tools + ≥5 `domainExtras.useCaseVerdicts` |
| `single-tool-spotlight` | 3 (cover/body/end) | hero cover + tool deep-dive body | tools collection, has pros/features |
| `pro-con-verdict` | 5 (4 if `includeEndSlide=false`) | diagonal split-screen green/red | tools collection, `domainExtras.pros ≥ 3 AND cons ≥ 3` |
| `head-to-head-vs` | **6 (carousel — Spec 65.7)** | Cover → Tool A → Tool B → Side-by-side compare → Verdict → End | comparison articles, **exactly 2 tools** |
| `head-to-head-deep-dive` | **9 (carousel — Spec 65.7)** | Cover → A overview → A features → B overview → B features → Pricing → Use-cases → Verdict → End | comparison articles, **exactly 2 tools**, optional `extendedPros`/`extendedCons` |

**Spec 65.7 Family A multi-slide carousels** (the four highlighted rows) — `comparison-grid-3` replaces the pre-65.7 single-still (single-still pattern is preserved by `comparison-grid-4`, which stays untouched). All four share slide components from `comparison-grid-3/slides/` (Cover, CompareHeader, Tool, Verdict, End); `head-to-head-vs` adds `SideBySideSlide` and `head-to-head-deep-dive` adds `PricingCompareSlide` + `UseCaseCompareSlide`. Bi-theme works via `deriveDsTokens(brandTokens, theme)` — there is no separate CSS-var system. Per-tool brand colors come from `tool_brand_assets` (Spec 65.2) via `FamilyATool.{primaryColor, secondaryColor, tertiaryColor}`. LLM cover-headline + verdict-reasoning travel via per-template `_<tplKey>Extra` extension payloads on `GeneratedContent` (Spec 60.1 pattern).

**`pro-con-verdict` cover:** Two halves divided by a diagonal SVG clipPath — left half tinted with `prosColor` (default oklch green), right half with `consColor` (default oklch red). Tool name overlays the split at the bottom. This is the only template with a split-screen cover and is visually distinct from all others in the Instagram grid.

**Single-still vs carousel split:** `comparison-grid-4` and `verdict-per-use-case` stay single-still (one PNG, no dispatcher, `renderStill` once at `slideIndex: 0`). All four Family A templates from 65.7 are multi-slide carousels — their render-server functions loop `renderStill` across `slideTotal` PNGs via the shared `renderMultiSlideComposition` helper. Workers read `content.renderInput` snapshot from DB (Spec 58.2 pattern) regardless of single-still vs carousel.

## Variant History (Spec 57.1)

The `editorial` variant was removed in Spec 57.1. All list-carousel templates now use the `stunning` variant only. The `variant` field remains in `listCarouselInputSchema` for potential future extension but accepts only `'stunning'`. Files deleted: `ListCarousel.tsx`, `CoverSlide.tsx`, `ToolSlide.tsx`, `EndSlide.tsx` (all editorial). Migration 0047 backfills existing `social_posts.locale` rows to `'de-DE'` (NOT NULL).

## Caption + Hashtag Generation (Spec 57.4)

Caption and hashtags are **NOT** generated in this package. They are produced by `GenerateCaptionStep` in `packages/pipelines/src/article/social-image/steps.ts` — a single Sonnet 4.6 JSON call that returns `{ caption: string, hashtags: string[] }`.

The hashtag prompt rules live in `packages/core/src/social-hashtags/buildHashtagInstructions.ts` — edit there, not in pipeline step code. The function is shared with the discovery worker (`hookPrompt.ts`).

Key rules enforced by the Zod schema and prompt:
- Exactly 7 tags (schema accepts 5-10 to accommodate LLM variance)
- No hyphens (`#KITools` not `#KI-Tools`) — enforced by `/^#[^\s\-#]+$/u` regex
- No year tags (`#KI2026`) — prompt-only rule
- Bilingual DE+EN mix regardless of article locale
- Anchor tags adapt to content type: comparison articles get `#KIVergleich`/`#AIComparison`, others get `#KIFürBusiness`/`#AIForBusiness`

If the LLM fails twice (malformed JSON or schema validation), the step falls back to 7 generic hardcoded tags and sets `social_posts.content.warnings = ['hashtag_generation_fallback']`.

## Template Override System (Spec 57.3)

Project-scoped overrides let admins customize copy strings, layout toggles, and eligibility gates per template without forking template code.

**Schema location:** `src/templates/overrides/<templateKey>.overrides.ts` — one file per template (or per shared schema). Exported from `src/templates/overrides/index.ts` as the `@marketing-auto/social/templates/overrides` subpath.

**Pattern for adding overrides to a new template:**
1. Create `src/templates/overrides/<name>.overrides.ts` with a `z.object({...}).strip()` schema — `.strip()` is required for schema evolution safety. All nested objects must have `.default({})` so `schema.parse({})` returns a fully-populated object.
2. Add to `OVERRIDE_TEMPLATE_KEYS` and the `getOverrideSchema()` switch in `index.ts`.
3. Add `overrides?: <Schema>.optional()` to the composition's input schema (`types.ts`).
4. In the composition, resolve via `const overrides = input.overrides ?? schema.parse({})`. Never hardcode locale strings — read from `overrides.copy.*` with `isDE ? copy.field.de : copy.field.en`.
5. In `RenderSlidesStep`: call `fetchTemplateOverrides(projectId, templateKey)` from `@marketing-auto/db`, then `mergeOverrides(schema, row?.values)`. Fire-and-forget `markTemplateOverrideUsed()` (no await — must not block render).

**`mergeOverrides` is just `schema.parse(storedValues ?? {})`** — Zod's `.default({})` on nested objects fills in all missing keys. No custom merge logic needed.

**`markTemplateOverrideUsed` is an approximated write** — only fires when `lastUsedAt` is null or older than 1 hour to avoid write contention from parallel pipeline runs. It's a no-op when no row exists.

**`locale` field required on composition inputSchema** — when a composition uses locale-aware override strings, add `locale: z.enum(["de", "en"]).default("de")` to the composition's input schema. `listCarouselInputSchema` had this field missing before Spec 57.3.

**Dynamic import in pipeline step** — import `getOverrideSchema`/`mergeOverrides` from `@marketing-auto/social/templates/overrides` directly (not dynamic import needed; dynamic import was considered but the package is already on the dependency graph).

**`isOverrideTemplateKey` guard required when templateKey is `string`** — `getOverrideSchema(key)` expects `OverrideTemplateKey` (a narrow literal union). When the key comes from user input or pipeline input (typed as `string`), TypeScript rejects the call. Use `isOverrideTemplateKey(key)` from the same import before calling `getOverrideSchema`: `const overrides = isOverrideTemplateKey(key) ? mergeOverrides(getOverrideSchema(key), row?.values) : (row?.values ?? {})`. See `RenderSlidesStep.execute()` (Spec 60.6) for the canonical pattern.

## Gotchas

- **Font loading must be at module level** — call `loadFont()` from `@remotion/google-fonts/<Font>` at the top of the composition file (outside the component function). Remotion pre-loads fonts before headless Chrome renders; calling inside the component body is too late and produces blank/default font.

- **No web-safe fonts in headless Chrome** — Inter Variable, system-ui, and other common fonts are not available in Remotion's bundled Chromium. Always use a `@remotion/google-fonts/<Font>` package: `bun add @remotion/google-fonts --cwd packages/social`. Currently using `Inter Variable` (Spec 60.1+), replacing the legacy `SpaceGrotesk` used in pre-refresh templates

- **Tool icons are inline SVGs, not file paths** (Spec 52a) — `ToolIconImage` receives an `iconSvg` string (inline SVG from simple-icons/iconify/lobe-icons) or `initials`+`hue` for the avatar fallback. The old `iconUrl` file-path pattern and `resolveIconUrls()` pre-processing were removed. Never pass `file://` paths or emoji strings to `ToolIconImage`.

- **`getCompositions()` + override pattern, not `selectComposition()`** — use `getCompositions()` to get the registered composition, then spread your `inputProps` override when calling `renderStill()`. `selectComposition()` is deprecated in Remotion 4.

- **`ToolIconImage` has no `borderRadius` prop** — the component auto-calculates border-radius from `size` (`size * 0.22` for SVG icons, `"50%"` for the initials avatar). Do not pass `borderRadius` as a prop — it silently does nothing as it's not in the component's type. If a template spec mentions a specific border-radius (e.g. "10px"), note that the component will approximate it based on size.

- **`DsGlow` uses `color: "brand" | "accent"`, not `colorToken`** — when spec docs or design notes reference a `colorToken` prop, the actual implementation uses `color`. `color="accent"` selects `tokens.accent[500]`; `color="brand"` selects `tokens.brand[500]`. Check `src/ds-components/DsGlow.tsx` before adding a new prop — it may already exist under a different name.

- **New single-still templates: composition id must be kebab-case** — `comparison-grid-3`, `comparison-grid-4`, and `verdict-per-use-case` all use kebab-case composition IDs (matching `TemplateKey`). `SingleToolSpotlight` and `ProConVerdict` use PascalCase IDs (legacy). Do NOT use PascalCase IDs for new single-still templates — the worker lookup uses the `TemplateKey` string directly as the composition ID.

- **`ContentBounds` in a new composition's `types.ts` must match REMOTION.md exactly** — `bounds-match-remotion-md.test.ts` reads REMOTION.md directly and asserts that `*Bounds` objects match the values there. If a spec document and REMOTION.md disagree on a bound value, REMOTION.md wins. Check REMOTION.md before setting bounds in `types.ts`.

- **oklch transparency** — use `color-mix(in oklch, <color> <pct>%, transparent)` for all alpha overlays. Appending hex alpha digits to oklch strings (e.g. `oklch(...)33`) is invalid CSS and Chromium silently drops the rule. **The Claude Design HTML exports use `oklab` in some color-mix calls — always translate to `oklch` when porting to Remotion.** Both work in browser but `oklch` is the project standard and matches DsTokens color space.

- **Visual hierarchy on list items** — for ordered lists (strengths, pros, use-cases), apply decreasing opacity to simulate the depth that stagger animation creates in web UI. Pattern: `opacity: Math.max(0.65, 1 - i * 0.12)` on each list item. The clamp at `0.65` ensures no item becomes unreadable. The "star" first item always stays at full opacity since it's pulled out separately.

- **`transition` in inline styles is a no-op** — Remotion renders static PNGs via `renderStill()`. CSS `transition` properties in inline styles are silently ignored. For visual state differences (e.g. active progress dot vs. inactive), use shape/size/color differences directly rather than transitions. See `UseCaseVerdictSlide.tsx` for the progress-dot pattern.

- **Fixed-height slide layout — do NOT use `justifyContent: "space-between"`** — in a 1080×1080 slide, `space-between` distributes dead space between sections when content is short. Instead: set `paddingBottom: 140` on the outer container, give the main content block `flex: 1` so it fills all remaining space, and position the footer with `position: "absolute", bottom: 72`. This keeps content dense and fonts large regardless of how much text there is.

- **`prosColor`/`consColor` live at `brandTokens.colors.prosColor` / `brandTokens.colors.consColor`** — NOT at top-level `brandTokens.prosColor`. The `pro-con-verdict` template introduced these optional keys as part of the nested `colors` object inside `brandTokensSchema`. `resolveProsColor(brandTokens)` reads `brandTokens?.colors?.prosColor`. If you add new per-template semantic color keys, follow this same nesting pattern.

- **Override copy strings in each slide component, not in the dispatcher** — `pro-con-verdict` slides each call `proConVerdictOverridesSchema.parse(input.overrides ?? {})` directly rather than receiving parsed copy strings as props. This keeps slides self-contained and avoids prop type changes when new copy fields are added. Follow this pattern for future templates: parse overrides at component level, not in the top-level dispatcher (`ProConVerdict.tsx`).

- **`plannerMeta.contentType` vs `buildHashtagInstructions` ContentType are different enums** — `plannerMeta.contentType` (in `TemplateDefinition`) accepts `"comparison" | "tool-spotlight" | "use-case" | "news" | "concept"`. The `ContentType` argument to `buildHashtagInstructions()` (in `packages/core`) accepts `"comparison" | "review" | "general"`. These are entirely separate. Use `contentType: "review"` in `buildHashtagInstructions()` for single-tool evaluation templates; use `contentType: "tool-spotlight"` in `plannerMeta`.

- **`fileURLToPath` is in `node:url`, not `node:path` in Bun** — Bun throws `SyntaxError: Export named 'fileURLToPath' not found in module 'node:path'` if you import it from `node:path`. Always: `import { fileURLToPath } from "node:url"`.

- **Heterogeneous `TemplateDefinition<T>[]` arrays need an explicit cast** — TypeScript infers a union like `TemplateDefinition<A> | TemplateDefinition<B>` from a mixed array, which breaks generic calls (`register<T>(t)`, `assertFixtures(t)`). Cast the whole array once: `const templates = [...] as unknown as TemplateDefinition<unknown>[];`. Add a comment justifying the cast (e.g. "only reads non-generic fields").

- **`resolveBrandTokens()` must be called at the top of every DS-refreshed slide component** (Spec 60.1+) — compositions receive `brandTokens?: unknown` from the input schema. Call `resolveBrandTokens(brandTokens)` from `src/lib/brand-tokens.ts` immediately at the start of each slide component to convert it to a typed `BrandTokens` with defaults applied. Pass the result to `deriveDsTokens(tokens, theme)` immediately after. Pattern: `const tokens = useMemo(() => deriveDsTokens(resolveBrandTokens(brandTokens), theme), [brandTokens, theme])`.

- **`loadFonts.ts` must be imported as a side-effect, not a named import** (Spec 60.1+) — font loading happens once at module load time via `loadFont()` from `@remotion/google-fonts/Inter`. In the composition's main file (e.g., `SingleToolSpotlight.tsx`), import it with `import "./loadFonts.ts"` (no named bindings). This ensures Remotion registers Inter before any slide component renders. Calling `loadFont()` inside the component body is too late and produces blank fonts.

## Visual test harness (Spec 59.3.5)

```bash
bun run test:visual          # diff renders against baselines in test/__baselines__/; exit 1 on >0.1% diff
bun run test:visual:update   # re-render all and overwrite baselines
RUN_VISUAL=1 bun test packages/social/test/visual.test.ts  # same via bun:test (CI gate)
```

The harness script (`scripts/visual-render-all.ts`) renders all 5 templates × 3 fixtures × 2 themes directly via `render-server.ts` functions (not `template.render()`) to avoid needing mock `Article` DB rows. 160 slide PNGs total. Baselines are gitignored (`/packages/social/test/__baselines__/`) — generated on first run by `test:visual`.

## Composition structure

```
src/compositions/list-carousel/
  ListCarousel.tsx   — top-level composition, dispatches to slide components
  CoverSlide.tsx
  ToolSlide.tsx
  EndSlide.tsx
  types.ts           — Zod input schema (ListCarouselInput)
```

`ListCarousel` receives `slideIndex` in `inputProps` and renders the correct slide. The pipeline renders each slide index separately via `renderStill()`.

- **drizzle-orm imports inside this package must come from `@marketing-auto/db`** — `packages/social` has its own `drizzle-orm` in `node_modules` (different version than `packages/db`). Importing `and`, `eq`, `inArray` etc. directly from `drizzle-orm` causes TypeScript type-incompatibility errors (`Type 'Column<...>' is not assignable`). Always import drizzle operators from `@marketing-auto/db`: `import { and, eq, inArray } from "@marketing-auto/db"`. The tsconfig `paths` map overrides the version for type-checking; the re-export in `@marketing-auto/db/src/index.ts` is the canonical source.

- **Remove `rootDir` from tsconfig when `noEmit: true`** — setting `"rootDir": "."` blocks cross-workspace imports (e.g. importing from `@marketing-auto/db`) even with `noEmit: true`. Since `rootDir` only matters for emit, just remove it from the tsconfig entirely.

- **Dynamic import pattern for render-server calls from API** — to avoid Remotion being bundled into the API startup context, call render-server functions via dynamic import with a double-cast:
  ```typescript
  const mod = (await import("@marketing-auto/social")) as unknown as {
    renderUseCaseVerdictCarousel: (input: UseCaseVerdictInput) => Promise<RenderResult>;
  };
  ```

## Adding a new composition

1. Create `src/compositions/<name>/` with `types.ts` (Zod schema) + slide components.
2. Register it in `src/index.tsx` with `<Composition id="..." ... />`.
3. Add a `render<Name>()` function in `render-server.ts` following the same pattern as `renderListCarousel()`.
4. Create a `TemplateDefinition` in `src/templates/definitions/<name>.ts` and register it in `src/templates/bootstrap.ts`.
5. Add the new `templateKey` to `TemplateKey` in `src/templates/types.ts` AND to `EXPECTED_SHIPPED_KEYS` in `test/templates/template-registry-coverage.test.ts`.
6. Add the key to `FAMILY_A_TEMPLATE_KEYS` or `FAMILY_B_TEMPLATE_KEYS` + add a render-fn dispatch branch in `apps/api/src/workers/social-render.worker.ts` (Spec 65.7-followup + Memory D30).

## DsBrandStamp watermark overlay (Spec 65.15)

`src/compositions/_shared/DsBrandStamp.tsx` is the canonical pattern for any future slide-overlay component (campaign tags, QR codes, watermarks, "sponsored by" badges). Shape:

- `position: absolute` at a corner (default bottom-right 48px), `zIndex: 100`, `pointerEvents: "none"` so it never intercepts events.
- Graceful-null: returns `null` (not a broken-image) when the asset URL is missing. Required so projects without the asset configured don't break renders.
- Prop type uses **explicit `| undefined`** under `exactOptionalPropertyTypes`: `logoUrl?: string | null | undefined`. Callers spread `...(value !== null && { logoUrl: value })` and TS rejects without the explicit modifier.
- Consumed at **9 inject sites** (one per Cover + End surface across both families) — never at the worker or render-server layer. The worker's snapshot-spread carries the field through automatically because nothing filters fields out.

**Family-B `SlideComposition` cover-only gate (Spec 65.15)** — the `cover` variant stamps; the `editorial` variant (used for HotTake / TopPick body slides in opinion-recommendation) shares the same composition impl but explicitly skips the stamp via `variant === "cover"` check before the Fragment-wrapped return. If you add a new variant that should ALSO get a stamp, add it to the gate check, not to the dispatcher.

**Theme-variant asset fallback chain (Marcel-Decision Q2 — Spec 65.15)** — when an asset is keyed by `<base>-<theme>` (e.g. `main-light` / `main-dark`), the resolver MUST fall back through three tiers: `<base>-<theme>` → `<base>` → `<base>-<oppositeTheme>`. The third tier handles "Marcel uploaded only ONE variant" — that variant works for both themes. Two-tier chains (`<key>-<theme>` → `<key>` only) ship a real bug if the base key is absent. Pattern lives in `packages/pipelines/src/_lib/resolve-logo-url.ts` + `apps/api/src/lib/brand-asset-service.ts:resolveLogoUrl`.

**`SettingsBrandAssetsPage.vue` slot keys MUST match `brandTokens.social.<X>AssetKey` schema defaults** — `brandTokens.social.logoAssetKey` defaults to `"main"`, so the UI slot for the logo uploads with `assetKey="main"` (NOT `assetKey="logo"`). Pre-Spec-65.15 the UI used `key: "logo"` and uploads never resolved at render time. When introducing a new brand-asset type with a new `XxxAssetKey` schema field, ensure the UI slot list, the schema default, and the resolver lookup all agree on the literal value.

## V1-cut template variants (Spec 65.cleanup)

Templates that were planned in Spec 65.4/65.7 but V1-cut (ship as ONE template + config-knob instead of N variants) are kept in the `TemplateKey` union with a parallel `DeprecatedTemplateKey` union in `src/templates/types.ts`. Current V1-cut set (all Family-B `-dramatic` / `-minimal` variants):

- `opinion-recommendation-dramatic`, `opinion-recommendation-minimal` → `opinion-recommendation` + `toneIntensity` config
- `story-arc-clickbait-dramatic`, `story-arc-clickbait-minimal` → `story-arc-clickbait` + `toneIntensity` config
- `lifestyle-listicle-dramatic`, `lifestyle-listicle-minimal` → `lifestyle-listicle` + `toneIntensity` config

`ShippedTemplateKey = Exclude<TemplateKey, DeprecatedTemplateKey | UnsupportedTemplateKey>` is the canonical "what's actually shippable" type. Two-layer drift protection:

1. **Compile-time** — the exhaustivity guard in `apps/api/src/workers/social-render.worker.ts` excludes all four categories (Family-A, Family-B, Unsupported, Deprecated). Adding a new value to `TemplateKey` without a home triggers `TS2344: Type 'X' does not satisfy the constraint 'never'.`
2. **Runtime** — `test/templates/template-registry-coverage.test.ts` walks `templateRegistry.list()` post-bootstrap and asserts (a) every `EXPECTED_SHIPPED_KEYS` member is registered, (b) no `DeprecatedTemplateKey` or `UnsupportedTemplateKey` value is registered, (c) registry size matches `EXPECTED_SHIPPED_KEYS.length` exactly.

**If engagement data justifies splitting a single template back into variants** (un-deprecating), move the literal from `DeprecatedTemplateKey` to `FAMILY_B_TEMPLATE_KEYS`, add a dispatch branch in the worker, register the new `TemplateDefinition` in `bootstrap.ts`, and add the key to `EXPECTED_SHIPPED_KEYS`. The type-system + test pair guides the refactor — TypeScript surfaces the missing dispatch, the test surfaces the missing registration.

## Template Registry (Spec 54a)

Templates live in `src/templates/`. Each template is a plain TypeScript object (`TemplateDefinition`) with:
- `eligibility(article, discovery)` — pure predicate, no side effects
- `buildInput(article, discovery)` — **async** (may do DB lookups for tool references)
- `render(context)` — calls a `render-server.ts` function, returns `SlideOutput[]`
- `mockFixtures` — static fixtures for preview/testing

`bootstrapTemplates()` registers all templates at API startup (called in `apps/api/src/server.ts`).

**Brand token override pattern (Spec 54e)** — `RenderContext` now carries an optional `brandTokens?: BrandTokens` field. Every template `render()` that uses brand tokens **must** read `context.brandTokens ?? DEFAULT_BRAND_TOKENS` — never hardcode `DEFAULT_BRAND_TOKENS` directly. When the preview API receives a `projectId`, it calls `getBrandTokens(projectId)` from `apps/api/src/lib/brand-asset-service.ts` and passes the result in `renderContext.brandTokens`. Templates without brand-token support safely ignore the field.

Render output path: `/renders/<articleId>/<templateKey>/<locale>-<theme>/slide-NN.png` (written by `writeSlides` helper in `src/templates/lib/writeSlides.ts`).

**`buildToolLookup` auto-resolves missing icons (Spec 63.X)** — when a slug exists as a `collection='tools'` article but has neither inline `domainExtras.iconSvg/iconInitials` nor a cached `project_brand_assets` row, `buildToolLookup` now calls `resolveToolIcon(projectId, slug)` from `@marketing-auto/pipelines/icon-resolver` (subpath export) to walk the simple-icons → iconify → lobe-icons → deterministic-avatar chain. The resolved icon is written back to `project_brand_assets` so the next render hits the cache. Before this fix, missing icons fell straight through to `KNOWN_TOOL_ICONS` (initials+hue only, no brand logo) — `gemini` for instance had a perfectly good simple-icons entry but never got resolved because no upstream pipeline triggered the chain for that slug. The lazy dynamic import (`await import("@marketing-auto/pipelines/icon-resolver")`) keeps the heavy pipelines bundle off the test-time path and matches the existing `@marketing-auto/db` import pattern in the same file. Failures inside the Promise.all are swallowed per-slug; the slide falls through to `KNOWN_TOOL_ICONS` as before. Note the dep direction: `social → pipelines` (peerDep) is acyclic because pipelines does NOT import from social.

## ToolIconImage (Spec 52a)

`src/shared/ToolIconImage.tsx` accepts:
- `iconSvg?: string` — inline SVG rendered via `dangerouslySetInnerHTML` (safe: content comes from controlled brand asset sources only)
- `initials?: string` + `hue?: number` — deterministic HSL gradient avatar fallback

The `emoji` prop was removed in Spec 52a. The component never renders emoji.

**DS component visual isolation in tests (Spec 60.1)** — when writing baselines for individual DS components (`<DsGlow>`, `<DsTop>`, `<DsFoot>`), do not register them as standalone Remotion compositions in `src/index.tsx`. Instead, render each component-in-context: DsGlow via a body slide (glow most prominent), DsTop via a cover slide (header row dominant), DsFoot via an end slide (footer is sole focal element). This is the approved isolation pattern for DS component baseline testing — it ensures components are tested in realistic context rather than artificial harness compositions.

## End-Slide Components (Spec 65.9)

`src/end-slide-components/` is the V1 pluggable end-slide layer consumed by Theme 65 carousels as their final frame. Public subpath: `@marketing-auto/social/end-slide-components`.

**7 v1 types** (see `EndSlideData` discriminated union + `END_SLIDE_TYPES` const in `types.ts`): `follow-cta`, `comment-to-get`, `link-in-bio`, `tag-friend`, `save-share-cta`, `swipe-up`, `quote-action`. Each has a per-type Zod schema collected in `END_SLIDE_CONFIG_SCHEMAS` for runtime validation of the loosely-typed `end_slide_definitions.config` jsonb column.

**Component shape:**
- `HostSlide.tsx` — discriminated-union dispatcher. Switches on `data.type` with an exhaustive `never`-check default branch: adding a new type without extending the switch is a compile-time error.
- `shared/EndSlideBase.tsx` — themed `AbsoluteFill` with `DsGlow` corner (configurable corner + brand/accent tint). Uses a **render-prop children** pattern (`children: ReactNode | (tokens) => ReactNode`) so concrete slides receive the derived `DsTokens` without re-calling `deriveDsTokens`. The base owns `surface.base` / `ink.base` / `typography.fontFamily` so all 7 types share visual DNA.
- 7 concrete slides (`FollowCtaSlide.tsx`, `CommentToGetSlide.tsx`, …) — each consumes `EndSlideBase` with its preset glow corner + color, then renders its config via the render-prop children.

**Adding a new end-slide type** (V1.5+ — keep the surface narrow for V1):
1. Extend `END_SLIDE_TYPES` tuple + add the per-type interface to `EndSlideData` union + add a Zod schema + register in `END_SLIDE_CONFIG_SCHEMAS`.
2. Add the concrete `<Name>Slide.tsx` consuming `EndSlideBase`.
3. Add a new `case` to `HostSlide` — TS catches the missing case via the `never`-check.
4. Export from `index.ts` barrel.
5. Seed at least one active row in a follow-up migration so projects can pick it via the LRU selector.

**Consumed by:**
- 65.7 carousel templates: render `<HostSlide data={...} theme={...} locale={...} brandTokens={...} />` as their last frame.
- 65.5 brief-generators: 65.9 selector (`apps/api/.../shared/select-end-slide.ts`) populates `recurringMetadata.formatConfig.selectedEndSlide` for the renderer to read.

## Photographic subsystem (Spec 65.8 — in progress, Day 1 landed)

`src/photographic/` is the cross-provider image-search + LLM-curation + R2 stage-cache layer that powers Family-B carousels' photographic backgrounds. Public subpath: `@marketing-auto/social/photographic`.

**Day-1 surface (this commit)**:
- `types.ts` — `ProviderSearchResult` cross-provider normalized shape + `License` Zod schema + `FamilyBImageEntry` (the jsonb row persisted at `articles.domain_extras.familyBImages[]`).
- `providers/{pexels,unsplash,pixabay}.ts` — per-provider mappers wrapping the corresponding `@marketing-auto/adapter-{provider}` clients with `Promise.allSettled` so a single failed query doesn't drop the rest.
- `providers/index.ts` — `searchAllProviders(creds, {queries, perQuery})` fan-out + `(provider, providerId)` dedup. Providers with null credentials are skipped silently — Marcel may disable one without redeploying.
- `license-tracker.ts` — `requiresAttribution(provider)` predicate (Unsplash-only) + pure `buildCaptionAttribution(images)` that produces the "📸 Photos: …" suffix the Instagram caption-builder appends. Dedups by photographer+provider, skips Pixabay (license doesn't require credit), folds Pexels credits in optionally.
- `r2-image-cache.ts` — `stageProviderImage()` routes provider bytes through `convertImageToWebp` (Pattern 119 — never `putObject` directly for images). Fires `triggerUnsplashDownload()` best-effort when the picked image came from Unsplash, per their API guidelines. Throws on conversion / network failure so callers can fall back to gradient slides (Risk §10 graceful-degradation).
- `findCachedEntryForSlide(entries, slideIndex)` — pure lookup helper. Consumers (re-render endpoint, pipeline orchestrator) call this first to decide whether to re-stage.

**Cache-key strategy**: rather than asking `convertImageToWebp` for a deterministic R2 key (it always generates a UUID), let the adapter pick the UUID and remember the resulting key in `articles.domain_extras.familyBImages[]` jsonb indexed by `slideIndex`. Re-renders look up the array first; cache-miss triggers a fresh provider search + LLM-pick + stage.

**Day-2 surface (LLM helpers + orchestrator) lives in `packages/pipelines/src/article/social-image/photographic/`** — NOT in this package. Reason: the helpers call `anthropic.messages()` via `@marketing-auto/adapter-anthropic`, which has no business being a transitive dep of `social` (templates render synchronously inside Remotion and must not pull LLM deps). The orchestrator imports from `@marketing-auto/social/photographic` (this package's leaf subsystem, no upward edges) for providers + license-tracker + R2 stage-cache. **Dep-direction exception**: `pipelines → social/photographic` is added as a workspace dep (single-direction, static); the runtime graph stays acyclic because `social/photographic` only imports from adapters + shared. The existing `social/templates → pipelines/icon-resolver` lazy dynamic-import stays intact.

**Day-2+ surface that lives elsewhere**:
- `pipelines/src/article/social-image/photographic/generate-query-keywords.ts` — Haiku 4.5 + jsonMode + Zod soft-fail to text-derived defaults.
- `pipelines/src/article/social-image/photographic/pick-image-llm.ts` — Sonnet 4.6 vision-pick via `userImages: [...]` content blocks (Spec 65.8 adapter extension). Manual JSON extraction from `result.raw` because Sonnet rejects assistant prefill. Caps candidates at 10 to keep vision-token cost predictable.
- `pipelines/src/article/social-image/photographic/orchestrator.ts` — `getImagesForSlides(input)` chains cache-lookup → query-keywords → parallel-search → vision-pick → R2-stage per slide. Soft-fails ONE slide on any step failure (gradient fallback at render).

**Day-3 surface (this commit) — story-arc-clickbait V1**:
- `src/compositions/story-arc-clickbait/` — 7-slide narrative carousel. Cover uses pre-rendered hook (no LLM), slides 1-5 render narrative beats via the shared `SlideComposition` with the `immersive` variant (gradient-only fallback when `images=[]`), slide 6 is the end-slide (HostSlide opt-in via `endSlideData` OR `InlineEndSlide`). Reusable `NarrativeSlide` component covers all 5 beats with the same shape (beat text + optional inline tool mention chip).
- `src/compositions/story-arc-clickbait/narrative-prompt.ts` — single-Sonnet-call prompt builder + `validateStoryArcNarrative` (variable-verbatim refinement, Pattern §3.3 Option γ — every beat must mention at least one hook variable verbatim, case-insensitive word-boundary check) + `buildStoryArcRetrySuffix` for the 1× retry-on-validation-fail pattern.
- `src/templates/definitions/storyArcClickbait.ts` — TemplateDefinition. `generateContent` does ONE Sonnet call with tagged-block output (5 `## beatName` headers + `<CAPTION>` + `<HASHTAGS>` in one shot — Sonnet rejects `jsonMode` so we parse tagged blocks via `parseTaggedBlock`). Eligibility requires `collection='recurring_content'` + `domainExtras.recurring.formatConfig.hookData` set by Spec 65.5 brief-generator. `mockFixtures` has the canonical 3 (characteristic / edge-min / edge-max).
- `_shared/family-b/RenderEndSlide.tsx` — Family-B end-slide dispatcher (Spec 65.10 HostSlide opt-in OR pluggable `InlineEndSlide` component). Each Family-B template passes its own inline component; the dispatcher handles the schema-parse + branch. Distinct from family-a's RenderEndSlide which hard-couples to comparison-grid-3's inline EndSlide.

**`_storyArcExtra` extension pattern** — `GeneratedContent` is a fixed `{hookOutput, caption, hashtags}` shape. Family-B narrative is the equivalent of Family-A's `_grid3Extra` / `_verdict` extras: `generateContent` returns `GeneratedContent & { _storyArcExtra: StoryArcNarrative }`, render() casts back to read it (`context.generatedContent as GeneratedContent & { _storyArcExtra?: StoryArcNarrative } | undefined`). When the LLM output is malformed and the retry also fails, `render()` falls through to `buildFallbackNarrative(ctx.hook)` — the template never throws.

**Sonnet tagged-block output convention** — Family-B's `generateContent` issues ONE Sonnet call producing all of: 5 narrative beats (via `## setup`/`## conflict`/etc. headers parsed by `splitNarrativeByBeats`), `<CAPTION>` block, `<HASHTAGS>` block. Sonnet 4.6 + Opus 4.7 reject assistant prefill so `jsonMode: true` is forbidden — tagged blocks are the canonical Sonnet-with-multi-field output pattern (matches `LocalizeArticleStep` / Spec 64.4 translation flow). Each block has its own parser; missing blocks fall back to deterministic defaults.

**Provider credentials live in the vault** (Spec 64.20 pattern). Service names: `pexels` / `unsplash` / `pixabay`. Required keys: `api_key` / `access_key` / `api_key`. Marcel enters them via `/settings/credentials`; the verify button per provider runs `verifyPexels/Unsplash/Pixabay` from each adapter package against a known search query. Boot-time smoke check: `bun --filter @marketing-auto/api verify-image-providers` exits 0 when all 3 verify.

**Free-tier API convention** — Pexels/Unsplash/Pixabay are free-tier providers, so the calls deliberately do NOT go through `cost-tracker`. This matches Reddit / ProductHunt / HackerNews / vendor-rss adapters; the cost-tracker exists for budget enforcement on paid APIs (Anthropic, Replicate, DataForSEO, Voyage, Nano Banana). Spec §4 budgets €0.00 for provider calls and ~€0.20-0.25 total per render comes entirely from the LLM steps (query-keywords + vision-pick + narrative).

## Visual-Style Preset Catalog (Spec 65.16)

`src/presets/` is the catalog of signature visual-languages applied to Family-B Cover + emotion-heavy slides when the project routes through Nano Banana 2. Three V1.6 presets — `dark-neon-grid` / `light-editorial` / `blue-tech-gradient` — each defined as one `PresetCatalogEntry` (colors + typography + NB2-prompt direction).

**Two subpaths, JSX-free split:**

- `@marketing-auto/social/presets` — full surface, includes `fonts.ts` which calls `loadFont()` at module level. Composition-side consumers only (slide components).
- `@marketing-auto/social/presets/catalog` — slim re-export of `catalog.ts` + `nb2-prompts.ts` (pure, no Remotion side-effects). Used by `apps/api` (resolveImageStylePreset helper) + `packages/pipelines` (NB2 orchestrator + StageFamilyBImagesStep). Same pattern as the `end-slide-components/types` split (Spec 65.11).

**Adding a new preset** (e.g. BK Solar `warm-solar-gold`):
1. Add the key to `PRESET_KEYS` const tuple in `catalog.ts`.
2. Add a `PresetCatalogEntry` to `PRESET_CATALOG` with distinct color + typography + nb2 direction (per design-skill "vary aesthetics, never converge").
3. Write a migration that DROPs + recreates BOTH CHECK constraints with the widened set: `projects.social_image_style_preset` + `recurring_content_definitions.social_image_style_preset_override`. Mirror migration 0130's shape.
4. Mirror the widening on the Drizzle `$type<>()` unions for both columns.
5. Widen the Zod `.enum(...)` in `apps/api/src/routes/projects.ts` `updateProjectSchema.socialImageStylePreset` + the `apps/web/src/composables/useSettingsProjectPage.ts` `ImageStylePreset` field union + the `RecurringDefaultsSection` `PRESET_OPTIONS` array + i18n keys (DE+EN) under `settings.recurringDefaults.imageStylePreset.options.<key>.{label,description}`.
6. If the preset needs a NEW distinctive font, verify it ships in `@remotion/google-fonts/` BEFORE adding to typography overrides — Fontshare fonts (Clash Display / Cabinet Grotesk / Satoshi) are NOT in the package and would require WOFF2 hosting. V1.6 deliberately limited itself to Fraunces / JetBrainsMono / SpaceGrotesk / Inter Variable — all verified in the dist/esm/ listing.

**NB2 prompt assembly** (pure `buildNB2Prompt(input)` in `presets/nb2-prompts.ts`) — Gemini Image API has NO `negativePrompt` field (verified live, Memory D18). Anti-AI-slop avoidance is folded into the positive prompt as an `AVOID: NOT <phrase>, NOT <phrase>` block at the end. Same constraint applies to aspect-ratio: `"vertical 4:5 (portrait)"` is baked into prompt prose, NOT delivered via a request-body field (the `aspectRatio` field on `GenerateImageInput` is audit-only). When adding new generative-image features, follow this "fold into positive prompt" pattern unless the underlying API actually accepts a negative-prompt parameter.

**`license.provider` was widened** from `("pexels"|"unsplash"|"pixabay")` to include `"nano-banana-2"` so the NB2-generated `FamilyBImageEntry` can fit the existing `domain_extras.familyBImages[]` cache without a parallel schema. `buildCaptionAttribution` skips `nano-banana-2` for credit lines (same posture as `pixabay` — no human photographer, no attribution required). Adding a new image provider that doesn't carry photographer credit follows the same path: widen the enum + add a skip branch in `buildCaptionAttribution`.
