# Template Authoring Guide

How to build a new Remotion carousel template in this package. Written after building `single-tool-spotlight` alongside the two reference templates (`comparison-stunning`, `use-case-verdict-per-tool`).

---

## 1. Brand anchors — reuse, never invent

**Single sources of truth:**

| What | File | Rule |
|------|------|------|
| Theme colors (bg, ink, brand, accent, inkMuted) | `src/lib/theme.ts` → `getThemeTokens()` | Never hardcode hex. Every color comes from here. |
| Canvas dimensions + safe insets | `src/compositions/list-carousel/safeZones.ts` → `CAROUSEL_SAFE_ZONES` | Use `SZ.CANVAS_W`, `SZ.CANVAS_H_4_5`, `SZ.PAD_X`, `SZ.PAD_Y_TOP`, `SZ.PAD_Y_BOTTOM`. |
| Font | `@remotion/google-fonts/SpaceGrotesk`, `loadFont()` at module level | Call outside the component function — Remotion pre-loads before Chrome renders. |
| Typography scale | Derived from existing slides: eyebrow 17–20px / body 24–30px / headline 72–96px / hook 96+ | No freely invented font sizes. |

**Reusable primitives** (import directly, don't reimplement):

| Primitive | Location |
|-----------|----------|
| `<ToolIconImage>` | `src/shared/ToolIconImage.tsx` — renders SVG or colored initials avatar |
| `<PricingChip>` | `src/shared/PricingChip.tsx` |
| `<BrandFooter>` | `src/shared/BrandLogo.tsx` |
| `<Eyebrow>` | `src/shared/Eyebrow.tsx` |
| `<BackgroundLayer>` | `src/shared/BackgroundLayer.tsx` |

**Forbidden drift:** no new hex values, no `#rrggbb` literals outside `theme.ts`, no `display: flex` + `-webkit-box` on the same element (breaks flex child alignment, use an inner wrapper for `-webkit-line-clamp`).

---

## 2. Tool logo & icon handling

Resolution chain (highest priority first):
1. `articles.frontmatterExtras.iconSvg/iconInitials/iconHue` — set during Astro import or DraftStep
2. `project_brand_assets` DB table — populated by `resolveToolIcon()` pipeline (lobe-icons / simple-icons cached here); queried by `buildToolLookup()` for tools that had no icon in frontmatterExtras
3. `KNOWN_TOOL_ICONS` dictionary in `src/templates/adapters/toolLookup.ts` — hardcoded geometric SVG fallbacks for common tools (Cursor, Windsurf, Codeium, Gamma, etc.)
4. Deterministic colored initials avatar — `ToolIconImage` always renders something

`buildToolLookup()` implements all four tiers in order; `getToolContext()` (single-article) applies tiers 1 and 3.

For **single-article** lookups (not comparison): use `getToolContext()` from `adapters/tool.ts` — it applies `KNOWN_TOOL_ICONS` fallback automatically.

For **multi-tool** lookups (comparison templates): use `buildToolLookup(slugs, locale, projectId)` — goes through the full DB resolution chain.

Pass icon props conditionally:
```tsx
<ToolIconImage
  {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
  {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
  hue={tool.iconHue ?? 220}
  size={80}
/>
```

**`ToolIconImage` gradient fix:** the `hue` fallback uses `linear-gradient(135deg, ...)` — do NOT change it to `radial-gradient(135deg at ...)`, that syntax is invalid CSS and Chromium silently renders it as gray.

---

## 3. The template contract

Every template is a `TemplateDefinition<TInput>` object:

```ts
export const myTemplate: TemplateDefinition<MyContext> = {
  key: "my-template",          // must be in TemplateKey union in types.ts
  displayName: "...",
  description: "...",
  defaultSlideCount: 4,
  estimatedCostUsd: 0.006,
  outputFormat: "carousel",
  compatibleChannels: ["instagram"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "tool-spotlight",
    estimatedEngagementTier: "medium",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },
  eligibility,                 // pure, no async, no DB
  generateHook,                // required — see below
  buildInput,                  // async — DB lookups allowed
  render,                      // async — calls render-server.ts via dynamic import
  mockFixtures,
};
```

**`generateContent()` is required on every template (Spec 54h/54i).** Returns `{ hookOutput, caption, hashtags }` from a single LLM call. Implement via `generateContentWithGate()` from `@marketing-auto/core`:

```ts
import { generateContentWithGate, inferArticleType, selectPattern } from "@marketing-auto/core";

generateContent: async (article, input, locale, llmCaller) => {
  const ctx = input as MyContext;
  const toolNames = ctx.tools.map(t => t.name);
  const articleType = inferArticleType(article.title ?? article.slug, toolNames.length);
  const pattern = selectPattern(article.id, articleType);
  return generateContentWithGate(
    { id: article.id, title: article.title ?? article.slug, toolCount: toolNames.length, toolNames },
    pattern,
    {
      articleTitle: article.title ?? article.slug,
      toolNames,
      primaryKeyword: toolNames.join(" vs. "),
      locale,
      articleSlug: article.slug,
      contentType: "comparison", // or "tool-spotlight" | "use-case"
    },
    llmCaller,
  );
},
```

**Key rules:**
- `llmCaller` is dependency-injected by the runner — templates never import `@marketing-auto/adapter-anthropic` directly.
- `article.title` is `string | null` — always use `article.title ?? article.slug` as fallback.
- `contentType` controls bilingual hashtag rule: `comparison`/`use-case` get `#KIVergleich`; `tool-spotlight` does not.
- `generateContentWithGate` validates hook (word count 3–7, forbidden words, pattern rules), retries twice, falls back to static captions — never throws.

**In `render()`:** use `context.generatedContent?.caption ?? fallbackCaption(...)` — keep a private `fallbackCaption` function as safety net but never call it as the primary path.

**All prompts must be in English** — output language is specified inline in the prompt ("German output, du-form"). See `packages/core/src/social-hooks/hookPrompt.ts`.

**Schema fields** (`outputFormat`, `compatibleChannels`, `generationClass`, `plannerMeta`) are required. TypeScript enforces at build time.

**`TemplateKey` union** is in `src/templates/types.ts`. Add your key there first — if it's missing, the discovery pipeline filters it as a hallucination and the template is never surfaced.

**`eligibility`** is a hard gate, not a score. Return `{ eligible: false, reason, requirements }` for every condition that would produce a broken layout. Check: collection, required fields, `minItems`/`maxItems` bounds for arrays that drive slide count.

**`buildInput` is async** because `buildToolLookup()` queries the DB (icon cache, tool metadata). If you only need article frontmatter and no external data, you can return synchronously inside an async function — but keep the signature async.

**`render`** calls Remotion via dynamic import to avoid bundling the renderer into non-render contexts:
```ts
const socialModule = await import("../../../render-server.ts") as unknown as {
  renderMyTemplate: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
};
```
The `../../../` path is from `src/templates/definitions/` up to `packages/social/render-server.ts`.

**Register in `bootstrap.ts`** — templates not registered there are invisible to the API.

**Slide count math:** must satisfy `minSlides ≤ defaultSlideCount ≤ maxSlides ≤ 10` (Instagram limit). Dynamic slide counts (e.g. +1 if `useCases.length >= 3`) must all be within bounds.

---

## 4. Theme parity

Every slide must render cleanly in both `dark` and `light`.

- `light` = white (`#ffffff`), not cream — `getThemeTokens(undefined, "light")` returns `bg: "#ffffff"`
- Never hardcode a background color. Use `theme.bg`, `theme.surface`, `theme.ink` etc.
- Transparency: use `color-mix(in oklch, ${theme.brand} 15%, transparent)` — appending hex alpha to oklch strings (e.g. `oklch(...)33`) is invalid and Chromium silently drops the rule.

---

## 5. Adding a new composition

1. Create `src/compositions/<name>/types.ts` with a Zod schema + `z.infer<>` type
2. Create slide components in `src/compositions/<name>/` — one file per slide type
3. Create `src/compositions/<name>/<Name>Composition.tsx` — top-level that dispatches by `slideIndex`
4. Add `export async function render<Name>(input: MyInput): Promise<RenderResult>` to `render-server.ts`
5. Register `<Composition id="<Name>" ... />` in `src/index.tsx`
6. Create `src/templates/definitions/<name>.ts`
7. Create `src/templates/definitions/fixtures/<name>.fixtures.ts` (min + max + characteristic)
8. Register in `src/templates/bootstrap.ts`

---

## 6. Mock fixtures — required, not optional

Three fixtures per template:

| Name | Purpose |
|------|---------|
| `characteristic` | A real-world-like tool/article with full content — proves the happy path |
| `edge-min` | Exactly at `minItems` for every array field — proves the layout doesn't look empty |
| `edge-max` | At `maxItems` for every field, longest allowed text strings — proves no overflow/clipping |

If `edge-min` looks sparse or `edge-max` clips text, the layout is not production-ready.

---

## 7. Known gotchas

**`exactOptionalPropertyTypes`:** Drizzle `.$type<T>()` columns and Zod-inferred types with `field?: string | undefined` are structurally incompatible. Always import column types from `@marketing-auto/db`, not locally.

**drizzle-orm imports:** Import `and`, `eq`, `inArray` etc. from `@marketing-auto/db`, not from `drizzle-orm` directly — each workspace package may have its own drizzle version causing type incompatibilities. Exception: `render-server.ts` and slide components have no drizzle imports.

**Font loading must be at module level:** `loadFont()` from `@remotion/google-fonts/SpaceGrotesk` must be called outside the component function. Calling it inside causes blank/fallback fonts in headless Chrome.

**`getCompositions()` + override pattern:** use `getCompositions()` to get the registered composition, then spread `inputProps` when calling `renderStill()`. Do not use `selectComposition()` — deprecated in Remotion 4.

**`radial-gradient(135deg at ...)` is invalid CSS:** that angle syntax is for `linear-gradient`. Chromium silently renders it as a flat gray. Use `linear-gradient(135deg, ...)` or `radial-gradient(circle at X% Y%, ...)`.

**No new Remotion compositions without registering in `src/index.tsx`:** `getCompositions()` in `render-server.ts` finds compositions from the bundle — if it's not registered in `index.tsx`, `renderStill` throws `composition not found`.

**`display: flex` + `-webkit-line-clamp`:** `-webkit-line-clamp` requires `display: -webkit-box` which overrides `display: flex`. Wrap text that needs clamping in a separate inner element.

**`color-mix` fallback in oklch:** Chromium's headless renderer handles `color-mix(in oklch, ...)` correctly since Chrome 111+. Remotion 4.x ships Chromium 112+, so this is safe.

**`DEFAULT_BRAND_TOKENS` is mandatory in every template `render()`:** Every template that reads `brandTokens` must write `const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;` where `DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({})`. Never use `context.brandTokens?.social.websiteUrl ?? "fallback"` inline — that bypasses the structured token system and was caught as a review violation in Spec 54f.

**Zod silently strips fields not in the composition schema:** If your template's `render()` passes a computed field (e.g. `pricingLabel`) to the composition input but that field is not declared in the composition's Zod schema, Zod strips it silently at parse time. No compile error, no runtime error. Each slide then has to recompute it from first principles — wasted computation and inconsistent logic. Rule: either declare the field in the schema AND pass it from render(), OR don't pass it and have slides compute it locally. Never half-do it.
