/**
 * Spec 65.17 B2 — Inter Variable + JetBrains Mono module-load fonts.
 * Module-level side-effect so Remotion pre-registers fonts before the slide
 * renders. See `packages/social/CLAUDE.md` "Font loading must be at module level".
 */
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

loadInter("normal", { weights: ["400", "500", "600", "700", "800", "900"] });
loadMono("normal", { weights: ["500", "700"] });
