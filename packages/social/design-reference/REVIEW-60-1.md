# 60.1 Post-Implementation Review

**Date:** 2026-05-19
**Reviewer:** Claude Code
**Purpose:** Validate 60.1 patterns before mechanical application in 60.2–60.5

## TL;DR (3 bullets)

- Pattern skeleton is solid and copy-paste-ready; dispatcher, DS consumption, dual-schema LLM flow, and `buildConstraintBlock` all implemented correctly
- Two gaps need fixing before 60.2: `headerNum` is computed in render() but never passed to `<DsTop num>` in BodySlide; DS component baselines (`__baselines__/ds-components/`) are not committed
- 60.2 can start immediately with those two fixes; nothing would cause a mid-session derail

---

## Pattern Audit Summary

| Task | Result | Notes |
|---|---|---|
| 1. Dispatcher reusability | ✅ | `computeSlideOrder()` is 8 lines; cover/body/end prop-passing is clear. Minor: body uses spread `{...props.body}` while cover/end use `content=` — not a blocker but future templates should pick one style |
| 2. DS component consumption | ✅ | All 3 slides call `deriveDsTokens(resolveBrandTokens(...), theme)` inside `useMemo`; `<DsGlow>` always first; content wrapped in `position:relative; zIndex:1` |
| 3. `<DsTop>`/`<DsFoot>` props used | ⚠️ | Cover uses all 4 DsTop props (`eyebrow`, `rightText`, `num`, `updateBadge`). **BodySlide only passes `eyebrow`+`rightText` — `num={props.headerNum}` is missing, so the date/header-num secondary line never renders on body slides.** `logoUrl`/`logoText` on DsFoot are unused by all slides (intentional — no logo PNG available at render time) |
| 4. `buildConstraintBlock` shape coverage | ✅ | All 5 shapes exercised: FieldBound, ListBound `{max, perItemMaxChars}`, ListBound `{countMin/countMax, each}`, count+children (`facts`), nested ContentBounds (`footer`, `tool`). Snapshot confirms shape 4 (`facts: exactly 4 / key / value`) is tested |
| 5. Dual-schema LLM flow | ✅ | `spotlightLlmResponseSchema` (snake_case) → `validateAndReprompt` → map to camelCase `SpotlightExtra` → return `_spotlight` extension. Transform happens after validation. `buildConstraintBlock` with `fields:` subset is injected into the prompt |
| 6. Cover-as-slide-variant | ✅ | `TemplateKey` has 8 values, no "cover". Worker switch unchanged. `CoverProps` lives in spotlight `types.ts` only |
| 7. Template-internal subcomponent boundary | ✅ | `shared/` has 5 files (HeroTool 63L, VerdictLine 75L, BodyGrid 150L, StatsRow, LivePill) all < 150 lines, all take `tokens: DsTokens`. CoverSlide defines its own inlines (Hero, ToolLogos, etc.) inside the file itself — no leakage to `ds-components/` |
| 8. Fixture coverage | ⚠️ | 3 fixtures with correct canonical keys, all have `input + generatedContent`. Composition fixtures defined separately. **edge-max strengths/weaknesses top out at ~51 chars against a 70-char max — not actually testing the overflow boundary** |
| 9. Visual baselines | ⚠️ | `test/__baselines__/single-tool-spotlight/` exists. **`test/__baselines__/ds-components/` is absent** — `visual-ds-components.test.ts` exists and references the script but no PNGs committed. Session 7 incomplete on this point |

---

## Blockers for 60.2 (if any)

**None that would block starting 60.2.** Both gaps below are in 60.1's own scope and should be fixed as a warm-up before writing 60.2 code.

---

## Recommended fixes before starting 60.2

1. **Fix `BodySlide` `<DsTop>` missing `num` prop** — `headerNum` is computed in `render()`, stored in `body.headerNum`, and passed through `SpotlightBodyProps`, but `BodySlide.tsx:67` only passes `eyebrow` + `rightText`. Add `num={props.headerNum}` to the `<DsTop>` call. Verify the date line renders visibly.

2. **Generate and commit DS component baselines** — run `RUN_VISUAL=1 bun test packages/social/test/visual-ds-components.test.ts` once with a clean Remotion bundle; commit the 11 PNGs to `test/__baselines__/ds-components/`. Until they exist, the visual-ds-components test always skips.

3. **Optional: push edge-max fixture strings to actual max** — update `edge-max` strengths/weaknesses to 68–70 chars each to confirm no clamp fires at the limit.

---

## Pattern transferability estimate

- **Files that copy verbatim**: `loadFonts.ts` (Inter Variable + latin-ext subset — project-wide convention)
- **Files that copy with rename/light edit**: `SingleToolSpotlight.tsx` dispatcher (structure identical; only slide names and conditionals change), `EndSlide.tsx` (CTA/logo slide is nearly identical across all templates — could become shared but isn't), `types.ts` structure (schemas change, patterns don't)
- **Files that are 100% template-specific**: all of `shared/` (HeroTool, VerdictLine, StatsRow, BodyGrid, LivePill are spotlight-only concepts), `CoverSlide.tsx` (layout, hero, stats grid, byline row are single-tool-specific)
- **Patterns that should be promoted before 60.2**: none — the `ds-components/` vs `shared/` boundary is correctly drawn. `EndSlide` is a candidate for shared extraction if all 5 templates confirm the same CTA shape, but that's a post-60.5 decision

**Mechanical estimate for 60.2 (comparison-grid-4)**: ~60% of effort is net-new composition (4-up grid layout, new `shared/` components like `ToolCard`, new `CoverSlide`). ~40% is straight copy: dispatcher pattern, `loadFonts.ts`, EndSlide shape, `types.ts` + `bounds` + `generatedSchema` structure, `validateAndReprompt` wiring, `buildConstraintBlock` call pattern.

---

## Surprises / unexpected findings

- **`hookOutput.pattern` is hardcoded `"negative_frame"` in both the primary path and fallback** — the LLM generates hook text freely but the pattern enum is never inferred from the response. This means the pattern metadata is meaningless for 60.1. Not a bug (the field is used by analytics, not rendering), but 60.2–60.5 should do the same rather than trying to infer it.

- **`_spotlight` extension pattern used instead of `_verdict`** — the CLAUDE.md template doc describes `_verdict` as the canonical extension key, but 60.1 uses `_spotlight`. Both work identically; the naming divergence is cosmetic but worth standardizing before 60.5.

- **Cover slide rendered only in `edge-max` composition fixture** — `characteristic` and `edge-min` composition fixtures have `cover: null`. The cover slide (the biggest visual addition in 60.1) isn't tested in the characteristic fixture. This means the visual baseline for the cover only covers the enterprise/long-text scenario.

- **`toolLogosCount` in `coverBounds` is `ListBound` with count range but no char bound** — structurally valid but semantically odd (it's counting logos, not characters). The snapshot correctly renders as `1–6 Einträge`. For 60.2–60.5 which use logo arrays differently, the same shape applies cleanly.
