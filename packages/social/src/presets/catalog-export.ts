/**
 * Spec 65.16 — Slim subpath for non-Remotion consumers.
 *
 * Subpath: `@marketing-auto/social/presets/catalog`
 *
 * Re-exports the JSX-free + Remotion-free surface so apps/api can resolve
 * `resolveImageStylePreset` / `buildNB2Prompt` without bundling
 * `@remotion/google-fonts` font-loading side-effects.
 *
 * Composition-side consumers (slide components, render-server) use the
 * full `@marketing-auto/social/presets` subpath which ALSO exports `fonts.ts`
 * and `preset-ds-tokens.ts` (both Remotion-dependent).
 *
 * Pattern mirror: `@marketing-auto/social/end-slide-components/types` (Spec
 * 65.11) — same JSX-free / heavy-import-free split.
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
  buildNB2Prompt,
  type BuildNB2PromptInput,
  type BuildNB2PromptResult,
  type NB2HookContext,
} from "./nb2-prompts.ts";
