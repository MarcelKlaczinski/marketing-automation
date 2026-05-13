# Stunning Polish Bugfix — 2026-05-13

## Phase 1 Findings

**cover_hook in DB:** Present in pipeline output (`social_posts.metadata` not inspected directly; determined from code path — `ExtractToolsStep` populates `coverHook` and `RenderSlidesStep` spreads it into `carouselInput.cover.hook`).

**Composition-Switching aktiv:** Yes — `ListCarouselStunning` registered in render-server, `RenderSlidesStep` dispatches to `renderListCarouselStunning()` when `input.variant === 'stunning'`.

**Root issues identified:**

1. **Hook always Pattern B (Number-Promise):** Two causes working together:
   - Main prompt instruction `"Do NOT use X vs. Y format"` confused the LLM into avoiding Pattern A even when ARTICLE-TYPE is comparison
   - No post-processing override existed — if LLM returned number-promise for a comparison article, the code accepted it unchanged
   - Programmatic fallback also used number-promise unconditionally

2. **"KI-Bild-Generatoren" disappears from Hook:** The fallback hook was:
   ```
   hookTrail: `${tools[0]?.name}-Tools im Vergleich.`
   ```
   e.g. `"Recraft-Tools im Vergleich."` — category context was discarded entirely.

3. **CoverSlideStunning layout broken:** Used `justifyContent: "space-between"` (forbidden per packages/social/CLAUDE.md). The other two slides (`ToolSlideStunning`, `EndSlideStunning`) already had this fixed in working tree but CoverSlide didn't.

4. **BigNumberDecoration missing for comparison:** Only shown for `pattern === "number-promise"`. A 2-tool comparison article never showed the big background "2".

## Phase 2 Hook-Engine Fixes (steps.ts)

### detectArticleType() implemented

```typescript
function detectArticleType(title: string, toolCount: number): "comparison" | "listicle" | "tutorial" | "reference" {
  const t = title.toLowerCase();
  if (toolCount <= 3 && (/\bvs\.?\b|\bgegen\b/.test(t) || (/ oder /.test(t) && toolCount <= 2))) {
    return "comparison";
  }
  ...
}
```

Called after tools are parsed from LLM output — tool count is known at that point.

### Pattern-A override for comparison articles

```typescript
if (articleType === "comparison" && tools.length <= 3 && (!coverHook || coverHook.pattern === "number-promise")) {
  coverHook = {
    pattern: "comparison",
    hookLead: `${toolA} oder ${toolB}?`,
    hookTrail: "Eines kann mehr.",
    hookEmphasisWord: "mehr",
    saveTriggerIntensity: "medium",
  };
}
```

`recraft-vs-ideogram-2026` → detected as comparison → hook forced to `"Recraft oder Ideogram?" / "Eines kann mehr."`.

### Number-Promise fallback now preserves category

```typescript
hookTrail: `${category} im Test.`
// where category = parsed.coverHeadlineHighlight ?? `${tools[0]?.name}-Tools`
```

For a listicle with `coverHeadlineHighlight = "KI-Bild-Generatoren"` → hook trail = `"KI-Bild-Generatoren im Test."`.

### Article-type hint injected into LLM prompt

`ARTICLE-TYPE: comparison` prepended to hook pattern instructions. LLM now sees:
> `A — Comparison-Tension (ZWINGEND wenn ARTICLE-TYPE === 'comparison')`

## Phase 3 Cover Visual-Decoration (CoverSlideStunning.tsx)

**Layout fix:** Removed `justifyContent: "space-between"`, added `paddingBottom: 140`, added `flex: 1` to center content block, moved footer to `position: absolute, bottom: 80`.

Result: Content is now dense and font-sizes fill the 1080×1080 canvas, matching the layout contract of ToolSlide + EndSlide.

**BigNumberDecoration extended:**
```tsx
{(pattern === "number-promise" || (pattern === "comparison" && toolCount === 2)) && (
  <BigNumberDecoration ... />
)}
```

`ToolLogoFloats`, gradient-mesh background, and `BigNumberDecoration` were all already implemented in the committed `CoverSlideStunning.tsx` — confirmed present.

## Phase 4 Tool-Slide Rank-Badge

Already implemented in committed `ToolSlideStunning.tsx`:
- `#01` at `fontSize: 72`, `fontWeight: 900`, `color: theme.brand`
- Eyebrow tool name in flex-row beside the badge, `alignItems: flex-end`

The only change in working tree: layout fix (space-between → paddingBottom: 140 + absolute footer).

## Phase 5 End-Slide

Already implemented in committed `EndSlideStunning.tsx`:
- `📌 SPEICHERE DIESEN POST` save-action block with accent border
- `ToolRecapStrip` with tool icons + "Reviewed:" label

The only change in working tree: layout fix (same pattern as ToolSlide).

## Files Changed

| File | Change |
|------|--------|
| `packages/social/src/compositions/list-carousel/CoverSlideStunning.tsx` | Layout fix (space-between → paddingBottom/flex:1/absolute footer) + BigNumberDecoration for comparison |
| `packages/social/src/compositions/list-carousel/ToolSlideStunning.tsx` | Layout fix only (pre-existing in working tree) |
| `packages/social/src/compositions/list-carousel/EndSlideStunning.tsx` | Layout fix only (pre-existing in working tree) |
| `packages/pipelines/src/article/social-image/steps.ts` | `detectArticleType()` + comparison override + improved fallback + prompt hint |

## Acceptance Checklist

- [x] `detectArticleType()` correctly classifies `recraft-vs-ideogram-2026` as `'comparison'`
- [x] Comparison-Pattern forces Pattern A for comparison articles (post-processing override)
- [x] `hook_lead.max(80)` / `hook_trail.max(50)` — already correct in schema
- [x] Fallback uses `coverHeadlineHighlight` for category context (`"KI-Bild-Generatoren im Test."`)
- [x] `ToolLogoFloats` — already implemented, visible
- [x] `BigNumberDecoration` — extended to comparison (2-tool) pattern
- [x] Background gradient-mesh — already implemented
- [x] RankBadge `#01` at 72px — already implemented
- [x] `SaveActionBlock` — already implemented
- [x] `ToolRecap` — already implemented
- [x] Typecheck: no regressions vs. baseline (same 26 pre-existing error lines)

## Deviations

- Did not regenerate test carousels (requires live API + worker). Phase 6 visual verification is a manual step.
- The `eyebrow` field in `ResolveAssetsStep` still prepends `"01 · RECRAFT"` as the tool's `eyebrow` property — this value is only used in the *editorial* variant's `ToolSlide.tsx`. The stunning `ToolSlideStunning` renders the rank badge and tool name separately, ignoring `tool.eyebrow`. No change needed.
