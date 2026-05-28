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
 * Slide-component-friendly token deriver. Returns `EmotionalDsTokens` when
 * no preset is active (legacy back-compat) OR `PresetEmotionalDsTokens`
 * when a preset is set. The discriminator is `"preset" in tokens`.
 *
 * Slide components call this unconditionally inside `useMemo`. When
 * `tokens.preset` is present, they read `tokens.preset.text.accent` etc.;
 * when absent, they fall back to `tokens.ink.base` (the pre-65.16 path).
 *
 * Pure function — no I/O.
 */
export function deriveTokensForRender(
  brandTokens: BrandTokens,
  theme: "dark" | "light",
  preset: PresetKey | null | undefined,
): EmotionalDsTokens | PresetEmotionalDsTokens {
  if (preset && PRESET_CATALOG[preset]) {
    return derivePresetEmotionalDsTokens(brandTokens, theme, preset);
  }
  return deriveEmotionalDsTokens(brandTokens, theme);
}

/**
 * Type guard for the discriminator. Use in slide components to narrow
 * the union returned by `deriveTokensForRender`.
 */
export function hasPresetTokens(
  tokens: EmotionalDsTokens | PresetEmotionalDsTokens,
): tokens is PresetEmotionalDsTokens {
  return "preset" in tokens;
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
    // Alias preset values into the LEGACY token slots that slide components
    // already read. This lets pre-65.16 slides pick up preset typography +
    // accent colors WITHOUT per-slide code changes — they keep reading
    // `tokens.typography.fontFamily` / `tokens.accent[500]` / `tokens.ink.base`,
    // and those values now come from the active preset. The `preset.*`
    // sub-object stays available for future per-slide branching that needs
    // the preset key explicitly (e.g. cover dot-grid only on dark-neon-grid).
    typography: {
      ...base.typography,
      fontFamily: resolveFontFamily(entry.typography.displayFontFamily),
      fontFamilyMono: resolveFontFamily(entry.typography.eyebrowFontFamily),
      eyebrowLetterSpacing: entry.typography.eyebrowLetterSpacing,
    },
    accent: {
      ...base.accent,
      500: entry.colors.textAccent,
    },
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
