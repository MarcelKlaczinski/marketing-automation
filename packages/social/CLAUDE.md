# packages/social — Remotion Compositions

## What this package does

Renders Instagram carousel slides as PNG via Remotion 4 (headless Chrome).
Entry: `render-server.ts` → `renderListCarousel()` returns `Buffer[]` (one per slide).
Compositions live in `src/compositions/<template-name>/`, shared primitives in `src/shared/`.

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
