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

## Template Inventory (as of Spec 60.3)

| Key | Slides | Cover Signature | Eligible content |
|-----|--------|-----------------|-----------------|
| `comparison-grid-4` | **1 (single still)** | 4-up tool grid, top-right glow, 84px score | comparison articles, **exactly 4 tools**, `frontmatterExtras.tools[].score` required |
| `comparison-grid-3` | **1 (single still)** | 3-up auto-height card stack, bottom-left glow, 56px score, 2×2 pro/con bullets | comparison articles, **exactly 3 tools** (sliced in `buildInput`), `frontmatterExtras.tools` required |
| `single-tool-spotlight` | 3 (cover/body/end) | hero cover + tool deep-dive body | tools collection, has pros/features |
| `verdict-per-use-case` | dynamic (1+N+2) | use-case-prominent header | comparison articles with per-use-case verdicts |
| `pro-con-verdict` | 5 (4 if `includeEndSlide=false`) | diagonal split-screen green/red | tools collection, `frontmatterExtras.pros ≥ 3 AND cons ≥ 3` |

**`pro-con-verdict` cover:** Two halves divided by a diagonal SVG clipPath — left half tinted with `prosColor` (default oklch green), right half with `consColor` (default oklch red). Tool name overlays the split at the bottom. This is the only template with a split-screen cover and is visually distinct from all others in the Instagram grid.

**Both `comparison-grid-4` and `comparison-grid-3` are single-still templates** — one PNG per article, no dispatcher. Their render functions each call `renderStill()` once with `slideIndex: 0`. Both workers read `content.renderInput` snapshot from DB (Spec 58.2 pattern) — NOT the job data. Key visual differences: grid-4 has top-right glow + 84px score + right-anchored winner flag; grid-3 has bottom-left glow + 56px score + left-anchored winner flag + 2×2 pro/con bullet row per card.

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

## Gotchas

- **Font loading must be at module level** — call `loadFont()` from `@remotion/google-fonts/<Font>` at the top of the composition file (outside the component function). Remotion pre-loads fonts before headless Chrome renders; calling inside the component body is too late and produces blank/default font.

- **No web-safe fonts in headless Chrome** — Inter Variable, system-ui, and other common fonts are not available in Remotion's bundled Chromium. Always use a `@remotion/google-fonts/<Font>` package: `bun add @remotion/google-fonts --cwd packages/social`. Currently using `Inter Variable` (Spec 60.1+), replacing the legacy `SpaceGrotesk` used in pre-refresh templates

- **Tool icons are inline SVGs, not file paths** (Spec 52a) — `ToolIconImage` receives an `iconSvg` string (inline SVG from simple-icons/iconify/lobe-icons) or `initials`+`hue` for the avatar fallback. The old `iconUrl` file-path pattern and `resolveIconUrls()` pre-processing were removed. Never pass `file://` paths or emoji strings to `ToolIconImage`.

- **`getCompositions()` + override pattern, not `selectComposition()`** — use `getCompositions()` to get the registered composition, then spread your `inputProps` override when calling `renderStill()`. `selectComposition()` is deprecated in Remotion 4.

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

## Template Registry (Spec 54a)

Templates live in `src/templates/`. Each template is a plain TypeScript object (`TemplateDefinition`) with:
- `eligibility(article, discovery)` — pure predicate, no side effects
- `buildInput(article, discovery)` — **async** (may do DB lookups for tool references)
- `render(context)` — calls a `render-server.ts` function, returns `SlideOutput[]`
- `mockFixtures` — static fixtures for preview/testing

`bootstrapTemplates()` registers all templates at API startup (called in `apps/api/src/server.ts`).

**Brand token override pattern (Spec 54e)** — `RenderContext` now carries an optional `brandTokens?: BrandTokens` field. Every template `render()` that uses brand tokens **must** read `context.brandTokens ?? DEFAULT_BRAND_TOKENS` — never hardcode `DEFAULT_BRAND_TOKENS` directly. When the preview API receives a `projectId`, it calls `getBrandTokens(projectId)` from `apps/api/src/lib/brand-asset-service.ts` and passes the result in `renderContext.brandTokens`. Templates without brand-token support safely ignore the field.

Render output path: `/renders/<articleId>/<templateKey>/<locale>-<theme>/slide-NN.png` (written by `writeSlides` helper in `src/templates/lib/writeSlides.ts`).

## ToolIconImage (Spec 52a)

`src/shared/ToolIconImage.tsx` accepts:
- `iconSvg?: string` — inline SVG rendered via `dangerouslySetInnerHTML` (safe: content comes from controlled brand asset sources only)
- `initials?: string` + `hue?: number` — deterministic HSL gradient avatar fallback

The `emoji` prop was removed in Spec 52a. The component never renders emoji.

**DS component visual isolation in tests (Spec 60.1)** — when writing baselines for individual DS components (`<DsGlow>`, `<DsTop>`, `<DsFoot>`), do not register them as standalone Remotion compositions in `src/index.tsx`. Instead, render each component-in-context: DsGlow via a body slide (glow most prominent), DsTop via a cover slide (header row dominant), DsFoot via an end slide (footer is sole focal element). This is the approved isolation pattern for DS component baseline testing — it ensures components are tested in realistic context rather than artificial harness compositions.
