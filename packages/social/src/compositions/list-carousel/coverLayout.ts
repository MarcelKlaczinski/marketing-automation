import { CAROUSEL_SAFE_ZONES as SZ } from "./safeZones.ts";

export const COVER_LAYOUT_V2 = {
  // Frame — sourced from shared safe-zone constants
  paddingX: SZ.PAD_X,
  paddingY: SZ.PAD_Y_TOP,

  // Maximum text width on cover: canvas minus both horizontal insets and logo column
  textSafeWidth: SZ.TEXT_SAFE_W,

  // Eyebrow
  eyebrowY: 140,
  eyebrowFontSize: 24,
  eyebrowLetterSpacing: 3,
  eyebrowFontWeight: 600,

  // Tool-logos top-right — sourced from safe-zone constants
  toolLogoSize: SZ.LOGO_COL_W,
  toolLogoTop: SZ.PAD_Y_TOP,
  toolLogoRight: SZ.LOGO_COL_RIGHT,
  toolLogoGap: 16,

  // Hook (3 phrase-based lines)
  hookStartY: 280,
  hookFontSize: 108,
  hookLineHeight: 1.05,
  hookLineGap: 12,
  hookFontWeight: 800,
  highlightFontWeight: 900,

  // Subline
  sublineY: 720,
  sublineFontSize: 28,
  sublineFontWeight: 400,

  // Promise-Block
  promiseBlockY: 800,
  promiseBlockBarWidth: 8,
  promiseBlockBarHeight: 140,
  promiseBlockTextLeft: 28,
  promiseLineFontSize: 34,
  promiseLineFontWeight: 700,
  promiseLineGap: 8,

  // BigNumber (background anchor, sits behind subline-area not promise-block)
  bigNumberFontSize: 560,
  bigNumberFontWeight: 900,
  bigNumberLeft: 40,
  bigNumberTop: 360,
  bigNumberOpacityDark: 0.10,
  bigNumberOpacityLight: 0.06,

  // Footer
  footerY: 1240,
  footerDividerY: 1180,
  footerHandleFontSize: 26,
  footerSubFontSize: 22,
  footerPageIndicatorFontSize: 22,
} as const;
