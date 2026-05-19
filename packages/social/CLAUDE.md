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

## What this package does

Renders Instagram carousel slides as PNG via Remotion 4 (headless Chrome).
Entry: `render-server.ts` → `renderListCarousel()` returns `Buffer[]` (one per slide).
Compositions live in `src/compositions/<template-name>/`, shared primitives in `src/shared/`.

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

- **No web-safe fonts in headless Chrome** — Inter Variable, system-ui, and other common fonts are not available in Remotion's bundled Chromium. Always use a `@remotion/google-fonts/<Font>` package: `bun add @remotion/google-fonts --cwd packages/social`. Currently using `SpaceGrotesk`.

- **Tool icons are inline SVGs, not file paths** (Spec 52a) — `ToolIconImage` receives an `iconSvg` string (inline SVG from simple-icons/iconify/lobe-icons) or `initials`+`hue` for the avatar fallback. The old `iconUrl` file-path pattern and `resolveIconUrls()` pre-processing were removed. Never pass `file://` paths or emoji strings to `ToolIconImage`.

- **`getCompositions()` + override pattern, not `selectComposition()`** — use `getCompositions()` to get the registered composition, then spread your `inputProps` override when calling `renderStill()`. `selectComposition()` is deprecated in Remotion 4.

- **oklch transparency** — use `color-mix(in oklch, <color> <pct>%, transparent)` for all alpha overlays. Appending hex alpha digits to oklch strings (e.g. `oklch(...)33`) is invalid CSS and Chromium silently drops the rule.

- **Visual hierarchy on list items** — for ordered lists (strengths, pros, use-cases), apply decreasing opacity to simulate the depth that stagger animation creates in web UI. Pattern: `opacity: Math.max(0.65, 1 - i * 0.12)` on each list item. The clamp at `0.65` ensures no item becomes unreadable. The "star" first item always stays at full opacity since it's pulled out separately.

- **`transition` in inline styles is a no-op** — Remotion renders static PNGs via `renderStill()`. CSS `transition` properties in inline styles are silently ignored. For visual state differences (e.g. active progress dot vs. inactive), use shape/size/color differences directly rather than transitions. See `UseCaseVerdictSlide.tsx` for the progress-dot pattern.

- **Fixed-height slide layout — do NOT use `justifyContent: "space-between"`** — in a 1080×1080 slide, `space-between` distributes dead space between sections when content is short. Instead: set `paddingBottom: 140` on the outer container, give the main content block `flex: 1` so it fills all remaining space, and position the footer with `position: "absolute", bottom: 72`. This keeps content dense and fonts large regardless of how much text there is.

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
