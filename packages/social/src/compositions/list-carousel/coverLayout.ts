export const COVER_LAYOUT_V2 = {
  // Frame
  paddingX: 80,
  paddingY: 100,

  // Eyebrow
  eyebrowY: 140,
  eyebrowFontSize: 24,
  eyebrowLetterSpacing: 3,
  eyebrowFontWeight: 600,

  // Tool-logos top-right
  toolLogoSize: 72,
  toolLogoTop: 100,
  toolLogoRight: 80,
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

  // BigNumber (massive background anchor, behind content)
  bigNumberFontSize: 720,
  bigNumberFontWeight: 900,
  bigNumberLeft: 40,
  bigNumberBottom: 200,
  bigNumberOpacityDark: 0.13,
  bigNumberOpacityLight: 0.08,

  // Footer
  footerY: 1240,
  footerDividerY: 1180,
  footerHandleFontSize: 26,
  footerSubFontSize: 22,
  footerPageIndicatorFontSize: 22,
} as const;
