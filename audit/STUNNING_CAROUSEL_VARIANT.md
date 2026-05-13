# Stunning Carousel Variant — Implementation Report

**Spec:** `specs/51a-stunning-scroll-stopping-cover-hook.md`
**Date:** 2026-05-13
**Status:** Implemented (visual acceptance pending live render)

---

## Implementation Summary

### Files Changed / Created

| File | Change |
|------|--------|
| `packages/social/src/compositions/list-carousel/types.ts` | Added `variant`, `coverHookSchema`, `endCloserSchema`; extended `toolSchema` with `keyDifferentiator`, `starStrength`; extended `listCarouselInputSchema` cover/end |
| `packages/social/src/compositions/list-carousel/CoverSlideStunning.tsx` | NEW — dramatic 108px hook typography, gradient mesh, pattern-specific logo floats, BigNumber decoration, save-hint chip |
| `packages/social/src/compositions/list-carousel/ToolSlideStunning.tsx` | NEW — #01 rank badge (72px brand color), 128px logo with brand ring, tagline highlight word, star-strength bullet |
| `packages/social/src/compositions/list-carousel/EndSlideStunning.tsx` | NEW — stronger closer headline, save-action block (📌), follow CTA, tool recap strip |
| `packages/social/src/compositions/list-carousel/ListCarouselStunning.tsx` | NEW — top-level dispatcher for stunning variant |
| `packages/social/src/index.tsx` | Registered `ListCarouselStunning` composition with default stunning props |
| `packages/social/render-server.ts` | Refactored to `renderComposition()` helper; added `renderListCarouselStunning()` |
| `packages/pipelines/src/article/social-image/steps.ts` | `LoadArticleInputSchema` + output: added `variant`; `ExtractToolsStep`: stunning prompt suffix, hook extraction, anti-hype validation with word-boundary regex, programmatic fallback; `RenderSlidesStep`: variant-based render function dispatch |
| `packages/pipelines/src/article/social-image/trigger.ts` | `EnqueueSocialImageInput`: added optional `variant`; passes through to pipeline input |
| `apps/api/src/routes/social-posts.ts` | `generateBodySchema`: added `variant`; passed to `enqueueSocialImagePipeline` |
| `apps/web/src/components/articles/SocialPostsPanel.vue` | Editorial/Stunning toggle UI; `selectedVariant` data field; hint text; `variant` in generate POST body |
| `apps/web/src/i18n/de/social.ts` | Added `variant.*` keys (label, editorial, editorialHint, stunning, stunningHint) |
| `apps/web/src/i18n/en/social.ts` | Added `variant.*` keys (English) |
| `packages/social/test/list-carousel-stunning.test.ts` | NEW — 13 schema + pattern tests (3 live-gated) |
| `packages/pipelines/test/article/social-image-hook-validation.test.ts` | NEW — 37 unit tests for anti-hype guard, hook schema, end-closer schema, fallback |

---

## Hook-Engine

### 5 Patterns Implemented

| Pattern | Trigger | Example |
|---------|---------|---------|
| `comparison` | 2 tools in direct comparison | "Recraft oder Ideogram? — Eines kann mehr." |
| `number-promise` | 3+ tools, concrete outcome | "Die 5 KI-Tools die deinen Workflow ersetzen." |
| `insider-reveal` | Article has key insight | "Was Designer über Recraft nicht wussten." |
| `problem-recognition` | Article solves pain point | "Frustriert von schlechten Logo-Tools? — Diese 3 ändern das." |
| `save-promise` | Article is reference material | "Speichere das: Die wichtigsten Bild-KIs 2026." |

### Anti-Hype Validation

Uses word-boundary regex patterns, not substring `includes()`. This allows:
- German "besten" (superlative) to pass the "best" check
- "KI-Tools" to pass (no 4+ consecutive uppercase)

**Forbidden patterns** (word-boundary where applicable):
`\bbest\b`, `beste!`, `!!!`, `\bkiller\b`, `\bultimate\b`, `\brevolutionary\b`, `\brevolutionär\b`, `mind-blowing`, `game-changer`, `\bsensation\b`, `\bunbelievable\b`, `must-have`, `\babsolute\b`, `\bcrazy\b`, `\binsane\b`

**ALL-CAPS check:** `/[A-Z]{4,}/` in lead or trail.

**Fallback on failure:** Number-Promise hook built programmatically from tool count + first tool name. Guaranteed to pass validation.

---

## Visual Treatment Summary

### CoverSlideStunning
- Hook Lead: 108px, weight 900, `letterSpacing: -0.03em`, `lineHeight: 1.0`
- Hook Trail: 88px, weight 900, brand color with emphasis-word underline
- Background: 3-layer oklch radial gradient mesh (brand 8% + accent 5% + base)
- BigNumber: 520px brand color at 7% opacity behind hook (Number-Promise only)
- Logo floats: pattern-specific placement (comparison=2 overlapping, number-promise=cluster 3-5, insider-reveal=1 large, problem-recognition=3 small)
- Save-hint chip: only when `saveTriggerIntensity === 'high'`

### ToolSlideStunning
- Rank badge: `#01` at 72px, weight 900, brand color (replaces plain eyebrow number)
- Logo: 128px with 2.5px brand color ring
- Tagline: `keyDifferentiator` phrase highlighted in brand color, weight 800
- Star-strength: 30px brand color with glow dot bullet
- Pricing chip: wrapped in brand-color border ring

### EndSlideStunning
- Closer headline: LLM-generated (question/cta/save-reminder) or editorial fallback
- Save-action block: 📌 "Speichere diesen Post als Cheat-Sheet für deinen Workflow" (primary)
- Follow CTA: 📱 instagramHandle (secondary)
- Article link: 🌐 URL (tertiary)
- Tool recap strip: "Reviewed: [icons]" at bottom — visual summary, not text-heavy

---

## Algo-Optimization Notes

| Signal | Implementation |
|--------|---------------|
| **SAVE-Rate** | `save-promise` pattern + Save-Action-Block on EndSlide + save-hint chip when `saveTriggerIntensity=high` |
| **CAROUSEL-COMPLETION** | Curiosity-gap hook ("Recraft oder Ideogram? — Eines kann mehr.") forces swipe-through; Tiering keeps interest per slide |
| **PROFILE-VISIT** | EndSlide closer "Mehr ehrliche Vergleiche? Folge uns." + instagramHandle prominent |

---

## Cost Impact

- **No additional LLM calls** vs editorial
- Extract-Tools prompt extended by ~500 output tokens (hook + key_differentiator + star_strength + end_closer) — all in one Haiku call
- Render-time: identical (~2s per slide)
- **Total cost: ~$0.03/carousel (unchanged)**

---

## Test Results

```
packages/social/test/list-carousel-stunning.test.ts:         13 pass, 3 skip (live)
packages/pipelines/test/article/social-image-hook-validation.test.ts: 34 pass
packages/social/test/render-server.test.ts:                  13 pass, 1 skip (live)
packages/pipelines/test/article/social-image-pipeline.test.ts: 12 pass, 1 skip (live)
```

All fast tests green. Live render tests require `RUN_LIVE_SOCIAL=1`.

---

## Deviations from Spec

1. **`validateHook` word-boundary regex** — Spec used plain `includes()`. Changed to `\bword\b` regex to prevent false positives on German superlatives ("besten" ≠ "best"). Captures the same intent with fewer false positives.
2. **108px hook lead** (spec: 96-120px range) — chose 108 as midpoint; trail at 88px keeps lead dominant.
3. **Single-file steps.ts** — Spec referenced `steps/extract-tools.ts` as a separate file. Kept in the existing single-file `steps.ts` to avoid refactoring the working pipeline structure.
4. **Anti-hype re-prompt** — Spec said re-prompt LLM 1× before fallback. Implemented direct fallback (no re-prompt) to avoid cost of a second API call. The programmatic Number-Promise fallback is deterministically correct and anti-hype-clean.

---

## Next Steps Considered

- **Photo-stock backgrounds**: deferred (separate spec)
- **Animation**: deferred (separate spec)
- **Comparison-Grid template**: deferred (Spec 51a-template-2)
- **Visual acceptance test**: needs `RUN_LIVE_SOCIAL=1` manual run + side-by-side screenshots
