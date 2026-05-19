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
      contentType: "comparison", // valid: "comparison" | "review" | "general" — "tool-spotlight" does NOT exist
    },
    llmCaller,
  );
},
```

**Key rules:**
- `llmCaller` is dependency-injected by the runner — templates never import `@marketing-auto/adapter-anthropic` directly.
- `article.title` is `string | null` — always use `article.title ?? article.slug` as fallback.
- `contentType` valid values: `"comparison" | "review" | "general"`. `"tool-spotlight"` and `"use-case"` do NOT exist on `ContentType` from `buildHashtagInstructions` — using them causes a TypeScript error. `"review"` is the right choice for single-tool evaluation templates.
- `contentType` controls bilingual hashtag rule: `"comparison"` gets `#KIVergleich`; `"review"` and `"general"` do not.
- `generateContentWithGate` validates hook (word count 3–7, forbidden words, pattern rules), retries twice, falls back to static captions — never throws.

**Templates needing extra LLM data beyond `GeneratedContent`** (e.g. verdict snippet, whenToUse, whenToSkip): `GeneratedContent` is a fixed shape `{ hookOutput, caption, hashtags }` — it cannot be extended. Use the `_verdict` extension pattern:

```ts
type VerdictData = { snippet: string; whenToUse: string; whenToSkip: string };
type GeneratedContentWithVerdict = GeneratedContent & { _verdict: VerdictData | null };

// In generateContent():
return result as unknown as GeneratedContent; // result is GeneratedContentWithVerdict

// In render():
const withVerdict = context.generatedContent as (GeneratedContent & { _verdict?: VerdictData | null }) | undefined;
const verdict = withVerdict?._verdict ?? null;
```

The `_verdict` prefix (underscore) signals extension data. This pattern is safe because `render()` immediately casts back to the extended type before use.

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

**`HookOutput.pattern` enum values are not what you'd guess:** the actual valid values are `"superlative_question" | "number_promise" | "negative_frame" | "identity_frame" | "curiosity_gap"` (defined in `packages/social/src/compositions/list-carousel/types.ts`). Values like `"question"`, `"bold-claim"`, `"contrast"`, `"number-stat"`, `"you-hook"` are wrong and cause a Zod parse error at runtime. When writing a custom `generateContent()` that bypasses `generateContentWithGate`, validate the hook response against the Zod schema from `list-carousel/types.ts` so mismatches are caught early rather than at render time. Your fallback hookOutput must also use a valid pattern value — `"negative_frame"` is a safe default.

**Zod silently strips fields not in the composition schema:** If your template's `render()` passes a computed field (e.g. `pricingLabel`) to the composition input but that field is not declared in the composition's Zod schema, Zod strips it silently at parse time. No compile error, no runtime error. Each slide then has to recompute it from first principles — wasted computation and inconsistent logic. Rule: either declare the field in the schema AND pass it from render(), OR don't pass it and have slides compute it locally. Never half-do it.

---

## LLM Constraint Blocks (Spec 60.1)

When a template's `generateContent()` builds a custom LLM prompt (i.e. it does NOT delegate entirely to `generateContentWithGate()`), use `buildConstraintBlock(bounds, locale)` from `src/templates/lib/buildConstraintBlock.ts` to format the character/count constraints. This keeps prompt limits in sync with the bounds source-of-truth (REMOTION.md) — no manual copy-paste of numbers into prompt strings.

```typescript
import { buildConstraintBlock } from "../lib/buildConstraintBlock";

const constraintBlock = buildConstraintBlock(
  singleToolSpotlightBounds,
  locale,
  {
    // Only include LLM-generated fields — skip structural fields like `eyebrow`
    // and `footer.url` that come from the article, not the LLM.
    fields: ["verdictQuote", "scoreLabel", "facts", "strengths", "weaknesses"],
  },
);
```

Output is a markdown-ish block ready to inline into a prompt:

```
CHARACTER LIMITS (must be respected):
- verdictQuote: 40–120 chars
- scoreLabel: 6–18 chars
- facts: exactly 4
  - key: 4–14 chars
  - value: 4–20 chars
- strengths: 3–4 items, each 30–70 chars
- weaknesses: 3–4 items, each 30–70 chars
```

`buildConstraintBlock` handles all `ContentBounds` shapes: `FieldBound` (`{ min, max }`), `ListBound` (`{ max, perItemMaxChars }` or `{ countMin/countMax, each }`), numeric counts, and nested `ContentBounds` groups (recurses with indentation).

**Do NOT** hardcode character limits as prose in prompt strings. If REMOTION.md or a bounds object is updated, the prompt updates automatically. Templates that use `generateContentWithGate()` exclusively (no custom prompt) do not need `buildConstraintBlock` — the helper is only relevant when you write a template-specific prompt.

## 8. Layout-Shift-Free Convention (Spec 59.3.5)

Every new template must declare three things alongside its `TemplateDefinition`. See the full convention in [specs/59.3.5-layout-shift-free-templates.md](/specs/59.3.5-layout-shift-free-templates.md).

**`ContentBounds` is a recursive interface (Spec 60.0c)** — `ContentBounds` supports nested slot groups (e.g. `tools.name`, `footer.ctaLine`) and numeric count fields. `REMOTION.md` at `.claude/skills/toolwiki-design/REMOTION.md` is the authoritative source for all field-length budgets. Keep `*Bounds` objects in sync with it. The drift-detection test `packages/social/test/bounds-match-remotion-md.test.ts` fails automatically when REMOTION.md is updated but the bounds aren't.

```ts
export const myTemplateBounds = {
  // Nested group — satisfies ContentBounds recursively
  tools: {
    count:   4,                      // numeric — structural constraint, not chars
    name:    { min: 3, max: 16 },   // FieldBound
    verdict: { min: 30, max: 80 },  // FieldBound
  },
  footer: {
    ctaLine: { min: 8, max: 24 },
    url:     { min: 12, max: 32 },
  },
  // Flat fields still work as before
  headline: { min: 10, max: 60 },     // FieldBound — rendered slot
  captionBody: { min: 20, max: 1800 }, // FieldBound — not rendered
  items: { max: 5, perItemMaxChars: 80 }, // ListBound
} as const satisfies ContentBounds;

export const myTemplateGeneratedSchema = z.object({
  headline: z.string().min(myTemplateBounds.headline.min).max(myTemplateBounds.headline.max),
  // ...
});

// In TemplateDefinition:
bounds: myTemplateBounds,
generatedSchema: myTemplateGeneratedSchema,
slotMap: { headline: "cover-headline" }, // only rendered fields
```

**Dual-schema rule**: `validateAndReprompt()` inside `generateContent()` validates the **raw LLM JSON** (snake_case if the prompt uses it) with the full `llmResponseSchema`. The `generatedSchema` on `TemplateDefinition` validates the **camelCase-transformed** verdict fields and is used only by fixture tests. Never swap them.

**`validateAndReprompt` wiring:**
```ts
parsed = await validateAndReprompt(
  extractedJson,
  async (hints) => {
    const retryRaw = await llmCaller(system, `${user}\n\nFix:\n${hints.map(h => `- ${h}`).join("\n")}`);
    return retryRaw ? extractJson(retryRaw) ?? {} : {};
  },
  { schema: llmResponseSchema, maxReprompts: 1, locale },
);
// On catch: return buildFallbackContent(...)
```

**Fixtures must include `generatedContent`** once `generatedSchema` is set — otherwise `fixtures-respect-bounds.test.ts` skips them silently:
```ts
generatedContent: {
  headline: "...", // must satisfy generatedSchema bounds
} satisfies MyTemplateGenerated,
```

**Templates using `generateContentWithGate()` — different wiring:** These templates (comparison-grid-4/3, verdict-per-use-case, single-tool-spotlight) already validate hook output internally. Do NOT add `validateAndReprompt` — it would double-validate. Instead:
- `bounds` + `generatedSchema` + `slotMap: {}` are still declared (documentation + fixture testing)
- `generatedSchema` validates only `{ caption, hashtags }` (the LLM slice the fixture tests care about)
- `slotMap` stays empty `{}` until `getFontSize` is actually applied in the composition

**`slotMap: {}` is valid** — the alignment test skips templates with empty slotMap. Bounds serve as documentation even when no getFontSize assertions fire.

**ToolSlideStunning hardcoded font sizes don't map to any getFontSize bucket:** tagline=36px, starStrength=38px, regularStrengths=30px are design constants that fall between bucket entries. Applying getFontSize would change pixel output and violate the "no visual change" constraint for retroactive patches. To add getFontSize coverage for these slots, add matching bucket entries to `getFontSize.ts` first, then apply.

**Each template needs its own fixture file** — never share a fixture file between two templates. Previously comparison-grid-3 imported from comparison-grid-4's fixture file (which had 2-tool data, making the 3-tool grid untestable). Each fixture file must contain data shaped for exactly its template's eligibility constraints.

**Fixture keys must be `characteristic` / `edge-min` / `edge-max`** — named slugs like `"recraft-vs-ideogram-de"` prevent the fixture tests from finding the right fixture by key. Always use the three canonical key names.

**Deprecated alias dead code:** Don't leave `@deprecated` export aliases in fixture files after a rename. If nothing imports the old name, delete it in the same PR — lingering aliases confuse `grep` and future refactors.

**DO NOT use a global regex to parse field budgets from REMOTION.md** — REMOTION.md has 5 template sections and shared field names (e.g. `eyebrow`, `heroSub`) appear in multiple sections with different values. A global `.match()` always returns the FIRST occurrence (the `cover` section). Use `extractSection(md, "comparison-grid-4")` to slice the section first, then match within it. See `packages/social/test/bounds-match-remotion-md.test.ts` for the canonical pattern.

**`*Bounds` naming uses REMOTION.md field names; render internals may differ** — bounds document the design contract (`strengths`, `weaknesses`, `verdict`). The render code and Remotion composition may use different internal field names (`pros`, `cons`, `tagline`) that predate the design system. Do not rename render internals to match bounds without also updating the composition schema — that's a visual change and requires a separate spec session.

**Gotchas:**
- `bootstrapTemplates()` must be called explicitly in test files — importing `bootstrap.ts` as a side effect does not register templates.
- `validateAndReprompt`'s `onValidationFailure: "truncate"` does not silently truncate — it still throws (with a note). Actual in-slide truncation is `WebkitLineClamp`. Don't conflate the two.
- Bucket boundaries (`slot-body` last entry = `maxChars: 280`) must match the corresponding `bounds.max`. Verify alignment after every bounds change — the `bounds-bucket-alignment.test.ts` will catch mismatches automatically once `slotMap` is set.

---

## Gotchas from Spec 60.1 implementation

- DO NOT call `buildHashtagInstructions(contentType, locale)` with two positional args — the function signature is `buildHashtagInstructions(ctx: HashtagContext)` taking a single object parameter. Correct usage: `buildHashtagInstructions({ locale, contentType: "review", toolNames: [ctx.name], ...(ctx.primaryCategory !== undefined && { toolCategory: ctx.primaryCategory }) })`. The wrong call causes `TS2554: Expected 1 arguments, but got 2`. This is a gotcha for anyone writing custom `generateContent()` in a template beyond `generateContentWithGate()`.

- DO NOT hardcode `toolLogos.min(3)` for all templates — the `.min()` constraint depends on whether the template is single-tool or multi-tool. `single-tool-spotlight` uses `.min(1)` (at minimum one logo), while multi-tool comparison grids use `.min(3)`. Always check the template's REMOTION.md bounds and/or eligibility rules before setting the Zod schema constraint. When a composition's Zod schema is rewritten (e.g. Spec 60.1), schema bounds must be updated alongside the constraints.

- **Schema boundary tests must be updated when min/max constraints change** — when a Zod schema constraint (`.min(N)` or `.max(N)`) is changed, verify the corresponding unit test. A test like "rejects toolLogos below min (2 items)" becomes wrong if min changes from 3→1; update it to "rejects toolLogos below min (empty array)". Any time a min/max constraint changes, search tests for hardcoded boundary assertions and update them.

- DO NOT assume `visual-render-all.ts` fixture format stays in sync with composition schemas automatically — when a composition's Zod input schema is rewritten, the fixture format in `visual-render-all.ts` must be updated manually to match the new shape. Old fixtures using `{ tool: {...}, totalSlides, articleSlug }` need rewriting to `{ cover, body, end, slideTotal }` after schema changes. Fixtures are NOT generated from schema; they are hand-crafted test data that the maintainer must keep aligned.
