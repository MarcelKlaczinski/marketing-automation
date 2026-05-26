/**
 * Spec 65.8 — Inter Variable font loading for lifestyle-listicle.
 * Module-scope load; same setup as story-arc-clickbait + comparison-grid-3.
 */
import { loadFont } from "@remotion/google-fonts/Inter";

export const { fontFamily: FONT_FAMILY_INTER } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "latin-ext"],
});
