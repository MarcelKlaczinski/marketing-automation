/**
 * Spec 65.8 — Inter Variable font loading for opinion-recommendation.
 * Module-scope load; same setup as the other Family-B compositions.
 */
import { loadFont } from "@remotion/google-fonts/Inter";

export const { fontFamily: FONT_FAMILY_INTER } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "latin-ext"],
});
