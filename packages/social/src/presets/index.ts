/**
 * Spec 65.16 — Public surface for the visual-style preset catalog.
 *
 * Subpath: `@marketing-auto/social/presets`
 *
 * Consumers:
 *   - `packages/pipelines/src/article/social-image/nb2/orchestrator.ts` —
 *     calls `buildNB2Prompt` per slide.
 *   - `packages/social/src/compositions/_shared/family-b/*` — slide
 *     components consume `derivePresetEmotionalDsTokens` for per-preset
 *     typography + color rendering.
 *   - `apps/api/src/lib/recurring-content/resolve-image-style-preset.ts` —
 *     reads `PRESET_KEYS` + `DEFAULT_PRESET_KEY`.
 *   - `apps/web/src/...` — UI dropdown consumes `PRESET_CATALOG` for
 *     display names + descriptions.
 *
 * Fonts are loaded as a module-level side-effect when this barrel is
 * imported. Composition entry-points should `import "@marketing-auto/social/presets"`
 * (no named bindings) once at top of file to register fonts with Remotion.
 */

export {
  CONTENT_TYPE_PRESET_BIAS,
  DEFAULT_PRESET_KEY,
  GLOBAL_AVOID_PHRASES,
  isPresetKey,
  PRESET_CATALOG,
  PRESET_KEYS,
  SLIDE_ROLES,
  type PresetCatalogEntry,
  type PresetColorOverrides,
  type PresetKey,
  type PresetNb2Direction,
  type PresetTypographyOverrides,
  type SlideRole,
} from "./catalog.ts";

export {
  FONT_FAMILY_FRAUNCES,
  FONT_FAMILY_INTER,
  FONT_FAMILY_JETBRAINS_MONO,
  FONT_FAMILY_SPACE_GROTESK,
  resolveFontFamily,
} from "./fonts.ts";

export {
  buildNB2Prompt,
  type BuildNB2PromptInput,
  type BuildNB2PromptResult,
  type NB2HookContext,
} from "./nb2-prompts.ts";

export {
  derivePresetEmotionalDsTokens,
  type PresetEmotionalDsTokens,
} from "./preset-ds-tokens.ts";
