/**
 * Spec 65.16 — Per-preset font loading for Remotion.
 *
 * Module-scope `loadFont()` calls — Remotion pre-loads fonts before
 * headless Chrome renders. Per the existing `loadFonts.ts` convention
 * (story-arc-clickbait, comparison-grid-3, etc.) this file must be
 * imported as a side-effect from the composition entry-point so the
 * fonts register before any slide component mounts.
 *
 * Two font sources:
 *
 *   1. **`@remotion/google-fonts`** — official Remotion package with
 *      pre-bundled WOFF2 + delayRender/continueRender hooks. Used for
 *      Inter Variable (body) + Fraunces (light-editorial serif).
 *
 *   2. **Fontshare CDN via `<link>` + browser `FontFace` (Spec 65.16
 *      V1.7 #4)** — Clash Display + Cabinet Grotesk + Satoshi aren't
 *      available in `@remotion/google-fonts`, so we inject the
 *      Fontshare CSS API URL at module load + delay Remotion's render
 *      until `document.fonts.ready` resolves. Same delayRender pattern
 *      that `@remotion/google-fonts` uses internally.
 *
 * `latin-ext` is required for German umlauts (ä ö ü ß Ä Ö Ü) since
 * Family-B narratives are first-person German prose for Toolwiki.
 */
import { loadFont as loadFraunces } from "@remotion/google-fonts/Fraunces";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadJetBrainsMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadSpaceGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { continueRender, delayRender } from "remotion";

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

// ─── Fontshare CDN fonts (Spec 65.16 V1.7 #4) ─────────────────────────────────
//
// Clash Display / Cabinet Grotesk / Satoshi aren't in `@remotion/google-fonts`.
// Load via Fontshare's CSS API + browser FontFace API + Remotion's
// delayRender/continueRender so the renderer waits for the fonts before
// committing the first frame. Same pattern @remotion/google-fonts uses
// internally; we just point at Fontshare instead of fonts.googleapis.com.
//
// Module-level — fires exactly once per process when this file is first
// imported. Guarded against non-browser environments (Bun tests, SSR) so
// the import doesn't crash where `document` is undefined.

export const FONT_FAMILY_CLASH_DISPLAY = "Clash Display";
export const FONT_FAMILY_CABINET_GROTESK = "Cabinet Grotesk";
export const FONT_FAMILY_SATOSHI = "Satoshi";

const FONTSHARE_CSS_URL =
  "https://api.fontshare.com/v2/css?" +
  [
    "f[]=clash-display@400,700,800",
    "f[]=cabinet-grotesk@400,500,700,800",
    "f[]=satoshi@400,500,700,900",
  ].join("&") +
  "&display=swap";

function loadFontshareFonts(): void {
  if (typeof document === "undefined") return; // SSR / Bun tests — skip

  // Idempotent — re-importing this module never duplicates the link tag.
  const FONTSHARE_LINK_ID = "spec-65-16-fontshare-link";
  if (document.getElementById(FONTSHARE_LINK_ID) !== null) return;

  const handle = delayRender("Loading Fontshare display fonts (Spec 65.16 V1.7 #4)");

  const link = document.createElement("link");
  link.id = FONTSHARE_LINK_ID;
  link.rel = "stylesheet";
  link.href = FONTSHARE_CSS_URL;
  link.onload = () => {
    // Wait for browser to actually decode the WOFF2 + register the family.
    // `document.fonts.ready` resolves after every pending font in the
    // FontFaceSet finishes loading (or fails). Then it's safe to render.
    void document.fonts.ready.then(() => {
      continueRender(handle);
    });
  };
  link.onerror = () => {
    // Fall through gracefully — slides will use the CSS-stack fallback
    // (Inter Variable). Better to render with the wrong font than to hang
    // Remotion indefinitely on a CDN outage.
    continueRender(handle);
  };
  document.head.appendChild(link);
}

loadFontshareFonts();

// ─── Family-name → loaded-family lookup ───────────────────────────────────────

/**
 * Lookup mapping the literal name from `PRESET_CATALOG.typography.*FontFamily`
 * back to the loaded `fontFamily` string. Slide components consume
 * `resolveFontFamily(catalog.typography.displayFontFamily)` to get the
 * actual font-family value to apply via inline style.
 *
 * For Google Fonts (via `@remotion/google-fonts`), the loaded family is
 * the family name as registered by the package (`FONT_FAMILY_INTER` etc.).
 *
 * For Fontshare fonts, the loaded family is the literal CSS family name
 * registered by Fontshare's `@font-face` rules — same string as the
 * catalog uses ("Clash Display" / "Cabinet Grotesk" / "Satoshi").
 */
const FONT_FAMILY_MAP: Record<string, string> = {
  "Inter Variable": FONT_FAMILY_INTER,
  "Inter": FONT_FAMILY_INTER,
  "Fraunces": FONT_FAMILY_FRAUNCES,
  "JetBrains Mono": FONT_FAMILY_JETBRAINS_MONO,
  "Space Grotesk": FONT_FAMILY_SPACE_GROTESK,
  // Fontshare (Spec 65.16 V1.7 #4) — literal CSS family name preserved.
  "Clash Display": FONT_FAMILY_CLASH_DISPLAY,
  "Cabinet Grotesk": FONT_FAMILY_CABINET_GROTESK,
  "Satoshi": FONT_FAMILY_SATOSHI,
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
