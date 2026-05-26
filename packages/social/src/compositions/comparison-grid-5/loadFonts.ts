import { loadFont } from "@remotion/google-fonts/Inter";

// Spec 65.7 — Family A multi-slide carousels share the same Inter Variable load.
export const { fontFamily: FONT_FAMILY_INTER } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin", "latin-ext"],
});
