export const CAROUSEL_SAFE_ZONES = {
  // Canvas dimensions
  CANVAS_W: 1080,
  CANVAS_H_4_5: 1350,  // stunning 4:5 portrait
  CANVAS_H_1_1: 1080,  // editorial square

  // Safe insets (applied to all slide types)
  PAD_X: 80,
  PAD_Y_TOP: 100,
  PAD_Y_BOTTOM: 140,   // extra clearance for absolute footer

  // Stacked tool-logo column (top-right on cover slide)
  LOGO_COL_W: 72,      // icon size
  LOGO_COL_RIGHT: 80,  // distance from right canvas edge
  LOGO_COL_GAP: 20,    // horizontal buffer between logo column and text

  // Derived: maximum safe text width on cover, respecting the logo column
  // = 1080 - PAD_X - PAD_X - LOGO_COL_W - LOGO_COL_RIGHT - LOGO_COL_GAP
  // = 1080 - 80 - 80 - 72 - 80 - 20 = 748 px
  TEXT_SAFE_W: 748,
} as const;
