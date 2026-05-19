import { loadFont } from "@remotion/google-fonts/Inter";

// Must be called at module scope — Remotion pre-loads fonts before headless Chrome renders.
// latin-ext required for German umlauts (ä ö ü ß Ä Ö Ü).
export const { fontFamily: FONT_FAMILY_INTER } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin", "latin-ext"],
});
