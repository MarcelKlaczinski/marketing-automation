/**
 * Spec 65.8 — Inter Variable font loading for story-arc-clickbait.
 *
 * Module-scope load — Remotion pre-loads fonts before headless Chrome
 * renders. Calling `loadFont` inside a component body is too late and
 * produces blank/fallback text. Same setup as comparison-grid-3.
 *
 * latin-ext is required for German umlauts (ä ö ü ß Ä Ö Ü) since Family-B
 * narratives are first-person German prose for the Toolwiki tenant.
 */
import { loadFont } from "@remotion/google-fonts/Inter";

export const { fontFamily: FONT_FAMILY_INTER } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "latin-ext"],
});
