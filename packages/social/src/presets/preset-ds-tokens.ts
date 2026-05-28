/**
 * Spec 65.16 — Per-preset DS-token overrides on top of EmotionalDsTokens.
 *
 * Family-B slide components (CoverSlide, NarrativeSlide etc.) consume
 * `derivePresetEmotionalDsTokens(brandTokens, theme, preset)` instead of
 * the raw `deriveEmotionalDsTokens(brandTokens, theme)`. The preset variant
 * layers the per-preset color + typography overrides on top — so the same
 * BrandTokens produce visually distinct output depending on the active
 * preset.
 *
 * Token-cascade order (later wins):
 *   1. `deriveEmotionalDsTokens(brandTokens, theme)`  — base
 *   2. `PRESET_CATALOG[preset].colors`                — preset colors
 *   3. `PRESET_CATALOG[preset].typography`            — preset typography
 *
 * Per [packages/social/src/compositions/CLAUDE.md] — call inside `useMemo`
 * in slide components for re-render stability.
 */
import type { BrandTokens } from "@marketing-auto/shared/brand-tokens";
import {
  deriveEmotionalDsTokens,
  type EmotionalDsTokens,
} from "../compositions/_shared/family-b/ds-tokens-emotional.ts";
import { PRESET_CATALOG, type PresetKey } from "./catalog.ts";
import { resolveFontFamily } from "./fonts.ts";

/**
 * Extended token set adding per-preset typography slots. Slide components
 * consume `tokens.preset.display.*` / `tokens.preset.body.*` / `tokens.preset.eyebrow.*`
 * directly, alongside the existing `tokens.emotion.*` / `tokens.image.*`.
 *
 * `preset.key` is exposed so slide components can branch on preset for
 * the rare composition tweak that needs more than typography (e.g. cover
 * dot-grid background only on dark-neon-grid).
 */
export interface PresetEmotionalDsTokens extends EmotionalDsTokens {
  preset: {
    key: PresetKey;
    /** Text colors — slide components prefer these over `tokens.ink.*` when a preset is active. */
    text: {
      primary: string;
      accent: string;
    };
    display: {
      fontFamily: string;
      weight: string;
      letterSpacing: string;
      textTransform: "none" | "uppercase";
    };
    body: {
      fontFamily: string;
      weight: string;
    };
    eyebrow: {
      fontFamily: string;
      letterSpacing: string;
    };
  };
}

/**
 * Derive emotional DS-tokens with preset overrides applied. Pure function —
 * call inside `useMemo` in slide components.
 */
export function derivePresetEmotionalDsTokens(
  brandTokens: BrandTokens,
  theme: "dark" | "light",
  preset: PresetKey,
): PresetEmotionalDsTokens {
  const base = deriveEmotionalDsTokens(brandTokens, theme);
  const entry = PRESET_CATALOG[preset];

  return {
    ...base,
    // Override emotion + image surface colors with preset values
    emotion: {
      ...base.emotion,
      surface: entry.colors.emotionSurface,
      imageOverlay: entry.colors.emotionImageOverlay,
    },
    image: {
      ...base.image,
      gradientOverlay: entry.colors.imageOverlayGradient,
    },
    // Override base ink only (preserve `muted` cascade). Accent text lives
    // on `preset.text.accent` because `DsTokens.ink` is `{base, muted}` —
    // it has no `accent` slot.
    ink: {
      ...base.ink,
      base: entry.colors.textPrimary,
    },
    preset: {
      key: preset,
      text: {
        primary: entry.colors.textPrimary,
        accent: entry.colors.textAccent,
      },
      display: {
        fontFamily: resolveFontFamily(entry.typography.displayFontFamily),
        weight: entry.typography.displayWeight,
        letterSpacing: entry.typography.displayLetterSpacing,
        textTransform: entry.typography.displayTextTransform,
      },
      body: {
        fontFamily: resolveFontFamily(entry.typography.bodyFontFamily),
        weight: entry.typography.bodyWeight,
      },
      eyebrow: {
        fontFamily: resolveFontFamily(entry.typography.eyebrowFontFamily),
        letterSpacing: entry.typography.eyebrowLetterSpacing,
      },
    },
  };
}
