# packages/social — Remotion Compositions

## What this package does

Renders Instagram carousel slides as PNG via Remotion 4 (headless Chrome).
Entry: `render-server.ts` → `renderListCarousel()` returns `Buffer[]` (one per slide).
Compositions live in `src/compositions/<template-name>/`, shared primitives in `src/shared/`.

## Gotchas

- **Font loading must be at module level** — call `loadFont()` from `@remotion/google-fonts/<Font>` at the top of the composition file (outside the component function). Remotion pre-loads fonts before headless Chrome renders; calling inside the component body is too late and produces blank/default font.

- **No web-safe fonts in headless Chrome** — Inter Variable, system-ui, and other common fonts are not available in Remotion's bundled Chromium. Always use a `@remotion/google-fonts/<Font>` package: `bun add @remotion/google-fonts --cwd packages/social`. Currently using `SpaceGrotesk`.

- **Local file paths must be base64-encoded before render** — Remotion's dev server serves from `localhost:3000`, so `file://` URLs and absolute FS paths are unreachable from inside the bundle. `render-server.ts` runs `resolveIconUrls()` before calling `renderStill()`: reads each local PNG, converts to `data:image/png;base64,...`. Never pass `file://` prefixed paths to composition props.

- **`getCompositions()` + override pattern, not `selectComposition()`** — use `getCompositions()` to get the registered composition, then spread your `inputProps` override when calling `renderStill()`. `selectComposition()` is deprecated in Remotion 4.

- **oklch transparency** — use `color-mix(in oklch, <color> <pct>%, transparent)` for all alpha overlays. Appending hex alpha digits to oklch strings (e.g. `oklch(...)33`) is invalid CSS and Chromium silently drops the rule.

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

## Adding a new composition

1. Create `src/compositions/<name>/` with `types.ts` (Zod schema) + slide components.
2. Register it in `src/index.tsx` with `<Composition id="..." ... />`.
3. Add a `render<Name>()` function in `render-server.ts` following the same pattern as `renderListCarousel()`.
4. Add a pipeline step that calls the new render function.
