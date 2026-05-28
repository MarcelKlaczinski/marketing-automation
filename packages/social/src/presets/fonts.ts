/**
 * Spec 65.16 — Per-preset Google Font loading for Remotion.
 *
 * Module-scope `loadFont()` calls — Remotion pre-loads fonts before
 * headless Chrome renders. Per the existing `loadFonts.ts` convention
 * (story-arc-clickbait, comparison-grid-3, etc.) this file must be
 * imported as a side-effect from the composition entry-point so the
 * fonts register before any slide component mounts.
 *
 * All fonts here are verified available in `@remotion/google-fonts/`
 * (V1.6 design decision per Spec 65.16 §3.7 — Fontshare fonts like
 * Clash Display / Cabinet Grotesk would require WOFF2 hosting which
 * scope-creeps V1.6; we use weight + casing + letter-spacing for
 * preset distinction instead). Per-preset distinctiveness still holds
 * because the NB2 IMAGE is the dominant visual element + Fraunces
 * (serif) vs Space Grotesk (geometric sans) vs JetBrains Mono are
 * structurally different enough.
 *
 * `latin-ext` is required for German umlauts (ä ö ü ß Ä Ö Ü) since
 * Family-B narratives are first-person German prose for Toolwiki.
 */
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";

/**
 * Inter Variable — body text + dark-neon display.
 * Re-uses the same load as Family-B compositions (idempotent).
 */
export const { fontFamily: FONT_FAMILY_INTER } = loadInter("normal", {
  weights: ["400", "500", "600", "700", "800", "900"],
  subsets: ["latin", "latin-ext"],
});

/**
 * Fraunces — serif display for `light-editorial` preset.
 * Opsz variable axis used at the slide-rendering layer via CSS
 * `font-optical-sizing: auto`.
 */
export const { fontFamily: FONT_FAMILY_FRAUNCES } = loadFraunces("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin", "latin-ext"],
});

/**
 * JetBrains Mono — eyebrow / kicker mono for `dark-neon-grid` preset.
 */
export const { fontFamily: FONT_FAMILY_JETBRAINS_MONO } = loadJetBrainsMono("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin", "latin-ext"],
});

/**
 * Space Grotesk — display + eyebrow for `blue-tech-gradient` preset.
 */
export const { fontFamily: FONT_FAMILY_SPACE_GROTESK } = loadSpaceGrotesk("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin", "latin-ext"],
});

/**
 * Lookup mapping the literal name from `PRESET_CATALOG.typography.*FontFamily`
 * back to the Remotion-loaded `fontFamily` string. Slide components consume
 * `resolveFontFamily(catalog.typography.displayFontFamily)` to get the
 * actual font-family value to apply via inline style.
 *
 * The catalog uses display-friendly names like "Inter Variable" / "Fraunces"
 * to keep the catalog readable; this map translates to the loaded family
 * (which may be the same string for Inter — `@remotion/google-fonts/Inter`
 * registers as "Inter").
 */
const FONT_FAMILY_MAP: Record<string, string> = {
  "Inter Variable": FONT_FAMILY_INTER,
  "Inter": FONT_FAMILY_INTER,
  "Fraunces": FONT_FAMILY_FRAUNCES,
  "JetBrains Mono": FONT_FAMILY_JETBRAINS_MONO,
  "Space Grotesk": FONT_FAMILY_SPACE_GROTESK,
};

/**
 * Translate a display-name from the catalog to the actual loaded family.
 * Falls back to Inter when an unknown name appears (defensive — should
 * never trigger in production because catalog values come from a closed
 * literal-string set).
 */
export function resolveFontFamily(displayName: string): string {
  return FONT_FAMILY_MAP[displayName] ?? FONT_FAMILY_INTER;
}
