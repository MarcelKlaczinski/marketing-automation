# Spec 54l — DraftStep Structured Frontmatter for Tool Articles

## Problem

`DraftStep` emits a `FRONTMATTER_EXTRAS` block at the end of every article, but for tool-focused articles the block only contained `author`, `category`, `intentType`, `tags`, `faq`, `primaryTool`, and `bottomLinksVariant`. The fields needed by `single-tool-spotlight` — `pros`, `cons`, `features`, `useCases`, `pricingTier`, `priceFrom`, `rating` — were absent.

As a result, pipeline-generated tool articles (not Astro-imported) always failed the `single-tool-spotlight` eligibility check (`pros.length < 2`) and could never produce social posts. Only the ~108 Astro-imported articles had the structured data.

## Solution

Extended the `FRONTMATTER_EXTRAS` instructions in `DraftStep` to include a new **TOOL SPOTLIGHT FIELDS** section that the LLM emits when:
- `intentType` is one of `overview`, `features`, `review`, `pricing`, or `use-cases`
- The article focuses on a single named AI tool (`primaryTool` is set)
- The article content provides enough information to fill the fields meaningfully

### Fields added

| Field | Type | Format |
|-------|------|--------|
| `pros` | `Array<{ text: string }>` | 2–5 items, concrete advantages |
| `cons` | `Array<{ text: string }>` | 0–4 items, real limitations only |
| `features` | `string[]` | 0–6 key feature names (not sentences) |
| `useCases` | `string[]` | 0–4 short use case strings (2–4 words each) |
| `pricingTier` | `"free" \| "freemium" \| "paid" \| "enterprise"` | exact enum value |
| `priceFrom` | `number` | USD/EUR per month, 0 if free |
| `rating` | `number` | 0.0–5.0, one decimal place |

### Why these exact shapes

The shapes match what `getToolContext()` already reads from `frontmatterExtras`:
- `pros`/`cons` as `Array<{ text: string }>` — matches `normalizeProCons()` in `adapters/tool.ts`
- `useCases` as short strings — feeds slide 5 in `single-tool-spotlight` (2–4 words each for legibility)
- `pricingTier` as enum — exact values the `ToolContext` interface accepts

## Files Changed

- `packages/pipelines/src/article/steps/draft.ts` — added TOOL SPOTLIGHT FIELDS section to the FRONTMATTER_EXTRAS prompt instruction block (lines 147–163 new)

## What This Enables

After this spec, a tool article generated via the article pipeline has the structured data needed for `single-tool-spotlight` to pass eligibility — closing the gap between Astro-imported and pipeline-generated tool content. The "automated content operator" vision (generate article → auto-render social post) now works end-to-end for tool articles.

## Explicitly NOT in this Spec

- No changes to `getToolContext()`, `ToolExtras`, or `ToolContext` — the adapter already supported all fields
- No changes to `singleToolSpotlight.ts` eligibility logic
- No schema migration — `frontmatterExtras` is a JSONB column with no schema constraint
- No LLM prompt format changes (block format follows the same `<!-- FRONTMATTER_EXTRAS: {...} -->` pattern)
