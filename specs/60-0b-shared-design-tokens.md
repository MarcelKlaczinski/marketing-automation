# Spec 60.0b — Shared DS Components Library

**Theme:** 60 (Design System Visual Refresh)
**Status:** Draft
**Estimated effort:** 1.5 days (~10-12 focused hours across 4 sessions)
**Prerequisite:** Spec 60.0 (brand_tokens schema sync) shipped
**Successor:** Spec 60.1 — single-tool-spotlight Visual Refresh

---

## Goal

Build the shared component library and utility functions that all 5 visual-refresh template specs (60.1-60.5) will consume. After 60.0b lands:

- A `deriveDsTokens(brandTokens, theme)` function exposes the full DS token set (brand stops, accent stops, surface/ink, semantic colors) computed from the schema's `brandHue`/`accentHue` + theme parameter
- Five shared React components built and tested: `<DsBackgroundGlow>`, `<DsEyebrow>`, `<DsFooter>`, `<DsWinnerBadge>`, `<DsScoreNumber>`
- Each component renders correctly at 1080×1350 (4:5) using the Spec 59.3.5 layout-shift-free patterns
- Components are isolated, fixture-tested, and ready for consumption in Spec 60.1+

Spec 60.1 (single-tool-spotlight visual refresh) is the first consumer; it should be able to compose these shared parts and focus only on its template-specific layout.

## What this is NOT

- Not a template implementation — no template visual change in 60.0b alone
- Not a Settings UI change
- Not 9:16 support — these components target 4:5 only; 9:16 variants come later
- Not a font change — `loadFont()` migration from SpaceGrotesk to Inter Variable happens in Spec 60.1 (first template that needs it). Spec 60.0b uses whatever the existing fontFamily already loads; the new Inter font dependency is added in 60.1 with the first composition that uses it.
- Not a refactor of existing compositions — `BrandFooter`, `Eyebrow`, etc. that exist today remain untouched. The new `Ds*` components are alternatives consumed by the refreshed templates; old components are deleted after all templates have migrated (60.5 cleanup).

---

## Sections

- **Section A**: `deriveDsTokens(brandTokens, theme)` — the central token derivation function
- **Section B**: `<DsBackgroundGlow>` — the radial-gradient + blur pattern
- **Section C**: `<DsEyebrow>` — the top eyebrow row + slide counter
- **Section D**: `<DsFooter>` — the bottom logo + CTA row
- **Section E**: `<DsWinnerBadge>` — the accent-colored pill
- **Section F**: `<DsScoreNumber>` — the mono score number
- **Section G**: Fixtures + tests
- **Section H**: CLAUDE.md convention

---

## Section A — `deriveDsTokens(brandTokens, theme)`

### A.1 Principle

A single function takes the project's `brandTokens` (per Spec 60.0 schema) and a `theme: "dark" | "light"`, and returns the full DS token set that compositions consume. Compositions never reach into `brandTokens.colors.brandHue` directly — they consume the derived tokens.

This isolates the **derivation logic** (oklch math, light/dark resolution, fallback chains) in one place. Every composition gets the same tokens for the same input.

### A.2 File location

```
packages/social/src/brand-tokens/derive.ts
```

(Per Spec 60.0 Section E.2: the schema lives in `packages/shared/brand-tokens/`; the derivation lives in `packages/social/` because it's a render-time concern.)

### A.3 The function signature

```typescript
import type { BrandTokens } from "@marketing-auto/shared/brand-tokens";

export interface DsTokens {
  brand: {
    50: string;
    100: string;
    300: string;
    500: string;   // = primary
    700: string;
    900: string;
    950: string;
  };
  accent: {
    500: string;   // = accent
    600: string;
  };
  surface: {
    base: string;       // background
    raised: string;     // cards, blocks
    sunken: string;     // chip backgrounds, deeper hierarchy
  };
  border: string;
  ink: {
    base: string;       // primary text
    muted: string;      // secondary text
  };
  semantic: {
    success: string;
    warn: string;
    danger: string;
    info: string;
  };
  shadows: {
    sm: string;
    md: string;
  };
  pricing: {
    free: string;
    freemium: string;
    paid: string;
  };
  typography: {
    fontFamily: string;
    fontFamilyMono: string;
    headingWeight: number;
    bodyWeight: number;
    eyebrowLetterSpacing: string;
  };
}

export function deriveDsTokens(
  brandTokens: BrandTokens,
  theme: "dark" | "light",
): DsTokens;
```

### A.4 Derivation rules per token group

**Brand scale** — derived from `brandHue` using fixed lightness/chroma stops matching the DS:

```typescript
function deriveBrandScale(hue: number): DsTokens["brand"] {
  return {
    50:  `oklch(97% 0.018 ${hue})`,
    100: `oklch(94% 0.040 ${hue})`,
    300: `oklch(80% 0.100 ${hue})`,
    500: `oklch(64% 0.160 ${hue})`,   // = primary
    700: `oklch(48% 0.140 ${hue})`,
    900: `oklch(32% 0.080 ${hue})`,
    950: `oklch(22% 0.060 ${hue})`,
  };
}
```

Values copied directly from `colors_and_type.css` (Audit Section 2A). If `brandTokens.colors.brandHue` is absent (shouldn't be post-migration; safety only), fall back to 248.

**Accent scale** — same pattern with `accentHue`:

```typescript
function deriveAccentScale(hue: number): DsTokens["accent"] {
  return {
    500: `oklch(72% 0.150 ${hue})`,
    600: `oklch(64% 0.160 ${hue})`,
  };
}
```

**Surface** — theme-conditional, with optional overrides from `brandTokens`:

```typescript
function deriveSurface(brandTokens: BrandTokens, theme: "dark" | "light"): DsTokens["surface"] {
  if (theme === "dark") {
    return {
      base: brandTokens.colors.surfaceDark,
      raised: brandTokens.colors.surfaceRaisedDark ?? "oklch(20% 0.025 250)",
      sunken: brandTokens.colors.surfaceSunkenDark ?? "oklch(13% 0.020 250)",
    };
  }
  return {
    base: brandTokens.colors.surface,
    raised: brandTokens.colors.surfaceRaised ?? "oklch(99% 0.005 250)",
    sunken: brandTokens.colors.surfaceSunken ?? "oklch(97% 0.010 250)",
  };
}
```

The fallbacks are the DS reference values. If a project sets `surfaceRaised` explicitly, it wins.

**Border** — theme-conditional, default values from DS:

```typescript
function deriveBorder(brandTokens: BrandTokens, theme: "dark" | "light"): string {
  if (theme === "dark") {
    return brandTokens.colors.borderDark ?? "oklch(28% 0.020 250)";
  }
  return brandTokens.colors.border ?? "oklch(92% 0.010 250)";
}
```

**Ink** — theme-conditional, from DS reference:

```typescript
function deriveInk(_brandTokens: BrandTokens, theme: "dark" | "light"): DsTokens["ink"] {
  if (theme === "dark") {
    return {
      base: "oklch(95% 0.010 250)",
      muted: "oklch(95% 0.010 250 / 0.65)",
    };
  }
  return {
    base: "oklch(20% 0.025 250)",
    muted: "oklch(20% 0.025 250 / 0.70)",
  };
}
```

Note: `brandTokens.colors.ink` and `inkMuted` exist in the schema (per Spec 60.0). The above ignores them and uses DS values, because the DS specifies ink as theme-derived, not brand-specific. A future iteration could honor explicit `brandTokens.colors.ink` overrides if a project demands them; for now, theme-driven only.

**Decision**: ignore the stored `ink`/`inkMuted` fields at derive time. They remain in the schema for back-compat with existing compositions that consume them directly via `getThemeTokens()`. The new `Ds*` components use only `deriveDsTokens()`.

**Semantic colors** — DS constants, theme-invariant:

```typescript
const SEMANTIC: DsTokens["semantic"] = {
  success: "oklch(70% 0.160 145)",
  warn:    "oklch(78% 0.160 75)",
  danger:  "oklch(62% 0.200 28)",
  info:    "oklch(64% 0.160 248)",   // = brand-500 default; updated below if brandHue differs
};
```

Then: `info` is updated to match `brand.500` for the project (so `info` color follows brand hue).

**Shadows** — DS constants, used only in light theme per HTML audit (3C):

```typescript
function deriveShadows(theme: "dark" | "light"): DsTokens["shadows"] {
  if (theme === "dark") {
    return { sm: "none", md: "none" };  // no shadows in dark theme per DS
  }
  return {
    sm: "0 1px 2px oklch(0% 0 0 / 0.06), 0 4px 12px oklch(0% 0 0 / 0.05)",
    md: "0 1px 0 oklch(0% 0 0 / 0.04), 0 16px 32px -12px oklch(0% 0 0 / 0.18)",
  };
}
```

**Pricing** — from `brandTokens.colors`:

```typescript
function derivePricing(brandTokens: BrandTokens): DsTokens["pricing"] {
  return {
    free: brandTokens.colors.pricingFree,
    freemium: brandTokens.colors.pricingFreemium,
    paid: brandTokens.colors.pricingPaid,
  };
}
```

**Typography** — passthrough from brandTokens:

```typescript
function deriveTypography(brandTokens: BrandTokens): DsTokens["typography"] {
  return {
    fontFamily: brandTokens.typography.fontFamily,
    fontFamilyMono: brandTokens.typography.fontFamilyMono,
    headingWeight: brandTokens.typography.headingWeight,
    bodyWeight: brandTokens.typography.bodyWeight,
    eyebrowLetterSpacing: brandTokens.typography.eyebrowLetterSpacing,
  };
}
```

### A.5 The full function

```typescript
export function deriveDsTokens(
  brandTokens: BrandTokens,
  theme: "dark" | "light",
): DsTokens {
  const brand = deriveBrandScale(brandTokens.colors.brandHue ?? 248);
  const accent = deriveAccentScale(brandTokens.colors.accentHue ?? 168);

  return {
    brand,
    accent,
    surface: deriveSurface(brandTokens, theme),
    border: deriveBorder(brandTokens, theme),
    ink: deriveInk(brandTokens, theme),
    semantic: {
      ...SEMANTIC,
      info: brand[500],   // info follows brand hue
    },
    shadows: deriveShadows(theme),
    pricing: derivePricing(brandTokens),
    typography: deriveTypography(brandTokens),
  };
}
```

### A.6 Memoization

The function is pure; same input → same output. For perf, callers can memoize per (project, theme) — but in Remotion's render context, each slide render is a fresh call, so a `useMemo` in the composition is sufficient. No global cache needed.

### A.7 Discovered During Implementation

_(Filled by implementer.)_

---

## Section B — `<DsBackgroundGlow>`

### B.1 What it is

The radial-gradient + blur pattern that appears in every template HTML file as a `::before` pseudo-element. Different templates position it differently (top-right for comparison-grid-4, bottom-left for comparison-grid-3, bottom-right for single-tool-spotlight, top-left for verdict-per-use-case, dual for cover — per Audit Section 3B).

### B.2 Component signature

```typescript
import type { DsTokens } from "../brand-tokens/derive";

export type GlowCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface DsBackgroundGlowProps {
  tokens: DsTokens;
  theme: "dark" | "light";
  corner: GlowCorner;
  color: "brand" | "accent";
  /** Override the default 240px inset. */
  inset?: number;
  /** Override the default 50px blur. */
  blur?: number;
  /** Override the alpha (DS uses 0.42 dark / 0.28 light for brand). */
  alpha?: number;
}

export const DsBackgroundGlow: React.FC<DsBackgroundGlowProps>;
```

### B.3 Implementation

```tsx
import React from "react";
import type { DsBackgroundGlowProps } from "./types";

const DEFAULT_INSET = 240;
const DEFAULT_BLUR = 50;

const DEFAULT_ALPHA: Record<"brand" | "accent", Record<"dark" | "light", number>> = {
  brand: { dark: 0.42, light: 0.28 },
  accent: { dark: 0.22, light: 0.16 },
};

export const DsBackgroundGlow: React.FC<DsBackgroundGlowProps> = ({
  tokens,
  theme,
  corner,
  color,
  inset = DEFAULT_INSET,
  blur = DEFAULT_BLUR,
  alpha,
}) => {
  const effectiveAlpha = alpha ?? DEFAULT_ALPHA[color][theme];
  const colorValue = color === "brand" ? tokens.brand[500] : tokens.accent[500];

  // Resolve corner to inset properties
  const insetStyle: React.CSSProperties = {};
  if (corner.startsWith("top")) insetStyle.top = -inset;
  if (corner.startsWith("bottom")) insetStyle.bottom = -inset;
  if (corner.endsWith("left")) insetStyle.left = -inset;
  if (corner.endsWith("right")) insetStyle.right = -inset;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        width: 720,
        height: 720,
        ...insetStyle,
        background: `radial-gradient(closest-side, ${withAlpha(colorValue, effectiveAlpha)}, transparent 75%)`,
        filter: `blur(${blur}px)`,
        pointerEvents: "none",
      }}
    />
  );
};

function withAlpha(oklchValue: string, alpha: number): string {
  // Convert "oklch(L% C H)" → "oklch(L% C H / alpha)"
  // Quick implementation; production should use a robust oklch parser.
  if (oklchValue.includes("/")) return oklchValue;  // already has alpha
  return oklchValue.replace(/\)$/, ` / ${alpha})`);
}
```

### B.4 Layout-shift safety (per Spec 59.3.5)

`position: absolute` + fixed-px inset values + fixed 720×720 size = layout-shift-free. The glow lives outside the document flow; surrounding content is unaffected.

### B.5 Dual-glow support (for cover slide)

The cover composition uses two glows (one brand top-right, one accent bottom-left per Audit 3B). Two `<DsBackgroundGlow>` instances composed:

```tsx
<DsBackgroundGlow tokens={tokens} theme={theme} corner="top-right" color="brand" />
<DsBackgroundGlow tokens={tokens} theme={theme} corner="bottom-left" color="accent" />
```

### B.6 Discovered During Implementation

_(Filled by implementer.)_

---

## Section C — `<DsEyebrow>`

### C.1 What it is

The top eyebrow row shared by all templates. Contains the slide category label (ALL-CAPS, letter-spaced) on the left and the slide counter (mono font) on the right, separated by a flex space-between.

Per Audit 3A: `font-size: 17px`, `letter-spacing: 0.14em`, ALL-CAPS for the eyebrow text; mono font + `font-size: 17px` for the counter.

### C.2 Component signature

```typescript
export interface DsEyebrowProps {
  tokens: DsTokens;
  /** ALL-CAPS label, e.g. "VERGLEICH · 4 BILDGENERATOREN" */
  label: string;
  /** Slide counter, e.g. "01 / 06" or "1 / 5" */
  counter?: string;
  /** Color override; defaults to ink.muted */
  color?: string;
}

export const DsEyebrow: React.FC<DsEyebrowProps>;
```

### C.3 Implementation

```tsx
import { getFontSize } from "../compositions/_shared/getFontSize";

export const DsEyebrow: React.FC<DsEyebrowProps> = ({ tokens, label, counter, color }) => {
  const bucket = getFontSize(label, "eyebrow");
  const textColor = color ?? tokens.ink.muted;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        height: 60,                    // fixed row height per Spec 59.3.5 C.2
      }}
    >
      <span
        style={{
          fontSize: bucket.fontSize,
          fontFamily: tokens.typography.fontFamily,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: textColor,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {counter && (
        <span
          style={{
            fontSize: bucket.fontSize,
            fontFamily: tokens.typography.fontFamilyMono,
            fontFeatureSettings: '"tnum"',
            color: textColor,
          }}
        >
          {counter}
        </span>
      )}
    </div>
  );
};
```

### C.4 Why `height: 60` (not auto)

Per Spec 59.3.5 Section C — every container in a composition root grid has a fixed height. `60px` accommodates the 17px-equivalent font in the `eyebrow` bucket with comfortable padding. Surrounding grid layout is unaffected by label content length (truncated via `ellipsis`).

### C.5 Slot type alignment

`getFontSize(label, "eyebrow")` uses the existing `eyebrow` slot type from Spec 59.3.5 Section B.2 — `maxChars: 30, fontSize: 24`. The DS HTML uses 17px, smaller than our bucket's 24px. **Decision**: keep the 24px bucket; the DS 17px is for 9:16 mockups which have more vertical space. For 4:5 with less vertical room, slightly larger text reads better.

If the implementer disagrees during 60.0b implementation, adjust the `eyebrow` bucket — but document it in `Discovered During Implementation`.

### C.6 Discovered During Implementation

_(Filled by implementer.)_

---

## Section D — `<DsFooter>`

### D.1 What it is

The bottom footer row shared by all templates. Logo on the left (44px height per Audit 3A), CTA text on the right (e.g. "Vollständiger Test →" / "Full review →"). Flex space-between layout.

### D.2 Component signature

```typescript
export interface DsFooterProps {
  tokens: DsTokens;
  /** Logo URL from brandTokens or article-specific override */
  logoUrl?: string;
  /** Logo display name fallback if logoUrl is absent */
  logoText?: string;
  /** CTA text on the right, e.g. "Full review →" */
  cta: string;
  /** Color override; defaults to ink.base for CTA, ink.muted for separator */
  color?: string;
}

export const DsFooter: React.FC<DsFooterProps>;
```

### D.3 Implementation

```tsx
import { Img } from "remotion";

const FOOTER_HEIGHT = 80;     // fixed
const LOGO_HEIGHT = 44;       // per Audit 3A

export const DsFooter: React.FC<DsFooterProps> = ({ tokens, logoUrl, logoText, cta, color }) => {
  const textColor = color ?? tokens.ink.base;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        height: FOOTER_HEIGHT,
        borderTop: `1px solid ${tokens.border}`,
        paddingTop: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {logoUrl ? (
          <Img src={logoUrl} style={{ height: LOGO_HEIGHT, width: "auto" }} />
        ) : logoText ? (
          <span
            style={{
              fontFamily: tokens.typography.fontFamily,
              fontWeight: tokens.typography.headingWeight,
              fontSize: 28,
              color: textColor,
            }}
          >
            {logoText}
          </span>
        ) : null}
      </div>
      <span
        style={{
          fontFamily: tokens.typography.fontFamily,
          fontWeight: 600,
          fontSize: 20,
          color: textColor,
        }}
      >
        {cta}
      </span>
    </div>
  );
};
```

### D.4 Truncation behavior

CTA text is bounded by Spec 59.3.5 `cover-snippet` or similar bucket via the consuming composition's bounds. If overlong, the composition truncates before passing to `<DsFooter>`. The footer itself does not enforce bounds — too contextual.

### D.5 Discovered During Implementation

_(Filled by implementer.)_

---

## Section E — `<DsWinnerBadge>`

### E.1 What it is

The accent-colored pill that marks winners (used in comparison-grid + verdict-per-use-case). Per Audit 3A: `var(--accent-500)` background, `#06291f` text (dark on light accent — fixed regardless of theme because accent is mid-tone), `border-radius: 999px`, `font-size: 13px`, `letter-spacing: 0.14em`.

### E.2 Component signature

```typescript
export interface DsWinnerBadgeProps {
  tokens: DsTokens;
  /** Label text, e.g. "Testsieger" / "Top pick" */
  label: string;
  /** Optional icon URL (e.g. winner tool logo) */
  iconUrl?: string;
}

export const DsWinnerBadge: React.FC<DsWinnerBadgeProps>;
```

### E.3 Implementation

```tsx
import { Img } from "remotion";

const BADGE_DARK_TEXT = "#06291f";  // fixed per DS, theme-invariant
const BADGE_HEIGHT = 36;

export const DsWinnerBadge: React.FC<DsWinnerBadgeProps> = ({ tokens, label, iconUrl }) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: BADGE_HEIGHT,
        paddingLeft: iconUrl ? 6 : 14,
        paddingRight: 14,
        borderRadius: 999,
        background: tokens.accent[500],
      }}
    >
      {iconUrl && (
        <Img src={iconUrl} style={{ height: 24, width: 24, borderRadius: 4 }} />
      )}
      <span
        style={{
          fontFamily: tokens.typography.fontFamily,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: BADGE_DARK_TEXT,
        }}
      >
        {label}
      </span>
    </div>
  );
};
```

### E.4 Why text color is hardcoded `#06291f`

Per Audit 3A, the DS uses a fixed dark text on the accent pill regardless of theme. This is a contrast-preservation decision in the DS — the accent is bright enough that dark text always reads. Spec 60.0b honors that decision; if a project's `accentHue` is so different that dark text doesn't read, that's a project-config issue, not a component issue.

### E.5 Discovered During Implementation

_(Filled by implementer.)_

---

## Section F — `<DsScoreNumber>`

### F.1 What it is

The large mono score number used in comparison-grid + single-tool-spotlight. Per Audit 3B: `84px` in grid-4, `56px` in grid-3, `88px` in single-tool-spotlight. Mono font, `font-feature-settings: "tnum"`, high negative `letter-spacing`.

### F.2 Component signature

```typescript
export interface DsScoreNumberProps {
  tokens: DsTokens;
  /** Score value, 0-100. Integers preferred. */
  value: number;
  /** Visual size: large for spotlight (88), medium for grid-4 (84), small for grid-3 (56). */
  size?: "small" | "medium" | "large";
  /** Optional /100 suffix; default false. */
  showOutOf?: boolean;
  /** Color override; defaults to ink.base */
  color?: string;
}

export const DsScoreNumber: React.FC<DsScoreNumberProps>;
```

### F.3 Implementation

```tsx
const SIZE_MAP: Record<"small" | "medium" | "large", number> = {
  small: 56,
  medium: 84,
  large: 88,
};

export const DsScoreNumber: React.FC<DsScoreNumberProps> = ({
  tokens,
  value,
  size = "medium",
  showOutOf = false,
  color,
}) => {
  const fontSize = SIZE_MAP[size];
  const textColor = color ?? tokens.ink.base;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        fontFamily: tokens.typography.fontFamilyMono,
        fontFeatureSettings: '"tnum"',
        fontWeight: 700,
        letterSpacing: "-0.04em",
        color: textColor,
      }}
    >
      <span style={{ fontSize, lineHeight: 1 }}>{value}</span>
      {showOutOf && (
        <span style={{ fontSize: fontSize * 0.4, opacity: 0.6 }}>/100</span>
      )}
    </div>
  );
};
```

### F.4 Why not in the bucket table

The score-number sizes (56, 84, 88) don't match any existing `getFontSize` bucket because they're font-size-by-template-context, not by content length. The number itself is always 1-3 chars — irrelevant to scaling.

**Decision**: keep the score-number sizes as a separate `SIZE_MAP` outside the bucket table. The bucket table is for content-driven scaling; score numbers are layout-driven scaling.

### F.5 Discovered During Implementation

_(Filled by implementer.)_

---

## Section G — Fixtures + Tests

### G.1 Fixture file

```typescript
// packages/social/src/brand-tokens/derive.fixtures.ts

import type { BrandTokens } from "@marketing-auto/shared/brand-tokens";

export const toolwikiBrandTokens: BrandTokens = {
  colors: {
    primary: "oklch(64% 0.16 248)",
    brandHue: 248,
    accent: "oklch(72% 0.15 168)",
    accentHue: 168,
    surface: "#ffffff",
    surfaceDark: "oklch(16% 0.02 250)",
    ink: "oklch(20% 0.025 250)",
    inkMuted: "oklch(45% 0.025 250)",
    pricingFree: "#22c55e",
    pricingFreemium: "#3b82f6",
    pricingPaid: "#f59e0b",
  },
  typography: {
    fontFamily: "Inter Variable, Inter, sans-serif",
    fontFamilyMono: "ui-monospace, 'SF Mono', Menlo, monospace",
    headingWeight: 800,
    bodyWeight: 400,
    eyebrowLetterSpacing: "0.08em",
    rankBadgeSize: 72,
    rankBadgeWeight: 900,
    rankBadgeLetterSpacing: "-0.03em",
    footerWebsiteSize: 20,
    footerHandleSize: 16,
    footerLabelSize: 18,
    footerGap: 2,
  },
  voice: { locale: "de-DE", addressForm: "du", forbiddenWords: [], signaturePhrases: [] },
  social: { instagramHandle: "@toolwiki.ai", websiteUrl: "toolwiki.ai", logoAssetKey: "main" },
};

// Edge fixture: project with custom brandHue and explicit surfaceRaised
export const customBrandTokens: BrandTokens = {
  ...toolwikiBrandTokens,
  colors: {
    ...toolwikiBrandTokens.colors,
    brandHue: 12,                                  // orange
    accentHue: 200,                                // cyan
    surfaceRaised: "oklch(95% 0.02 12)",           // explicit override
    border: "oklch(80% 0.02 12)",
  },
};

// Edge fixture: minimal project, all defaults
export const minimalBrandTokens: BrandTokens = {
  colors: {
    primary: "oklch(64% 0.16 248)",
    brandHue: 248,
    accent: "oklch(72% 0.15 168)",
    accentHue: 168,
    surface: "#ffffff",
    surfaceDark: "oklch(16% 0.02 250)",
    ink: "oklch(20% 0.025 250)",
    inkMuted: "oklch(45% 0.025 250)",
    pricingFree: "#22c55e",
    pricingFreemium: "#3b82f6",
    pricingPaid: "#f59e0b",
  },
  typography: {
    fontFamily: "Inter Variable, Inter, sans-serif",
    fontFamilyMono: "ui-monospace, Menlo, monospace",
    headingWeight: 800,
    bodyWeight: 400,
    eyebrowLetterSpacing: "0.08em",
    rankBadgeSize: 72,
    rankBadgeWeight: 900,
    rankBadgeLetterSpacing: "-0.03em",
    footerWebsiteSize: 20,
    footerHandleSize: 16,
    footerLabelSize: 18,
    footerGap: 2,
  },
  voice: { locale: "de-DE", addressForm: "du", forbiddenWords: [], signaturePhrases: [] },
  social: { instagramHandle: "@x", websiteUrl: "x.com", logoAssetKey: "main" },
};
```

### G.2 Unit tests — deriveDsTokens

```typescript
// packages/social/test/derive-ds-tokens.test.ts

import { describe, it, expect } from "vitest";
import { deriveDsTokens } from "../src/brand-tokens/derive";
import { toolwikiBrandTokens, customBrandTokens, minimalBrandTokens } from "../src/brand-tokens/derive.fixtures";

describe("deriveDsTokens", () => {
  describe("brand scale", () => {
    it("derives 7 stops with the project's brandHue", () => {
      const tokens = deriveDsTokens(toolwikiBrandTokens, "dark");
      expect(tokens.brand[500]).toBe("oklch(64% 0.160 248)");
      expect(tokens.brand[300]).toBe("oklch(80% 0.100 248)");
      expect(tokens.brand[700]).toBe("oklch(48% 0.140 248)");
    });

    it("respects a custom brandHue", () => {
      const tokens = deriveDsTokens(customBrandTokens, "dark");
      expect(tokens.brand[500]).toBe("oklch(64% 0.160 12)");
    });
  });

  describe("theme switching", () => {
    it("surface.base differs between dark and light", () => {
      const dark = deriveDsTokens(toolwikiBrandTokens, "dark");
      const light = deriveDsTokens(toolwikiBrandTokens, "light");
      expect(dark.surface.base).toBe(toolwikiBrandTokens.colors.surfaceDark);
      expect(light.surface.base).toBe(toolwikiBrandTokens.colors.surface);
    });

    it("ink.base differs between dark and light", () => {
      const dark = deriveDsTokens(toolwikiBrandTokens, "dark");
      const light = deriveDsTokens(toolwikiBrandTokens, "light");
      expect(dark.ink.base).not.toBe(light.ink.base);
    });

    it("shadows only present in light theme", () => {
      const dark = deriveDsTokens(toolwikiBrandTokens, "dark");
      const light = deriveDsTokens(toolwikiBrandTokens, "light");
      expect(dark.shadows.sm).toBe("none");
      expect(light.shadows.sm).toContain("oklch");
    });
  });

  describe("surfaceRaised override", () => {
    it("uses brandTokens.colors.surfaceRaised when set", () => {
      const tokens = deriveDsTokens(customBrandTokens, "light");
      expect(tokens.surface.raised).toBe("oklch(95% 0.02 12)");
    });

    it("falls back to DS default when not set", () => {
      const tokens = deriveDsTokens(toolwikiBrandTokens, "light");
      expect(tokens.surface.raised).toBe("oklch(99% 0.005 250)");
    });
  });

  describe("info follows brand", () => {
    it("info color = brand.500 for toolwiki", () => {
      const tokens = deriveDsTokens(toolwikiBrandTokens, "dark");
      expect(tokens.semantic.info).toBe(tokens.brand[500]);
    });

    it("info color updates when brandHue changes", () => {
      const tokens = deriveDsTokens(customBrandTokens, "dark");
      expect(tokens.semantic.info).toBe("oklch(64% 0.160 12)");
    });
  });

  describe("purity", () => {
    it("same input produces same output", () => {
      const a = deriveDsTokens(toolwikiBrandTokens, "dark");
      const b = deriveDsTokens(toolwikiBrandTokens, "dark");
      expect(a).toEqual(b);
    });

    it("does not mutate input", () => {
      const snapshot = JSON.parse(JSON.stringify(toolwikiBrandTokens));
      deriveDsTokens(toolwikiBrandTokens, "dark");
      expect(toolwikiBrandTokens).toEqual(snapshot);
    });
  });
});
```

### G.3 Visual fixtures + snapshot test

Each `Ds*` component gets a tiny composition harness that renders it standalone, against the 3 fixtures (toolwiki / custom / minimal), in both themes. PNG output is committed and visual-diffed in CI (per Spec 59.3.5 Section D).

```
packages/social/test/visual/ds-components/
  ds-background-glow/
    toolwiki-dark-top-right-brand.png
    toolwiki-light-top-right-brand.png
    custom-dark-bottom-left-accent.png
    ...
  ds-eyebrow/
    toolwiki-dark.png
    toolwiki-light.png
    long-label-truncated.png
    ...
  ds-footer/
    toolwiki-dark.png
    minimal-no-logo.png
    ...
  ds-winner-badge/
    toolwiki-dark.png
    custom-orange-accent.png
    ...
  ds-score-number/
    small.png
    medium.png
    large.png
    with-out-of.png
```

The visual harness uses the Spec 59.3.5 Section D pattern (Remotion `renderStill` + pixelmatch). Threshold 0.1%.

### G.4 Discovered During Implementation

_(Filled by implementer.)_

---

## Section H — CLAUDE.md Convention

### H.1 Update `packages/social/src/compositions/CLAUDE.md`

Add a new section "Shared DS Components" listing the 5 `Ds*` components, their purpose, and the canonical import pattern:

```typescript
import { DsBackgroundGlow, DsEyebrow, DsFooter, DsWinnerBadge, DsScoreNumber } from "@/social/ds-components";
import { deriveDsTokens } from "@/social/brand-tokens/derive";

const MyComposition: React.FC<Props> = ({ brandTokens, theme, ... }) => {
  const tokens = useMemo(() => deriveDsTokens(brandTokens, theme), [brandTokens, theme]);
  return (
    <AbsoluteFill style={{ background: tokens.surface.base }}>
      <DsBackgroundGlow tokens={tokens} theme={theme} corner="top-right" color="brand" />
      <div style={{ display: "grid", gridTemplateRows: "60px 1fr 80px", padding: 56 }}>
        <DsEyebrow tokens={tokens} label="VERGLEICH · 4 TOOLS" counter="01 / 06" />
        {/* ...slide body... */}
        <DsFooter tokens={tokens} logoUrl="..." cta="Vollständiger Test →" />
      </div>
    </AbsoluteFill>
  );
};
```

### H.2 New file: `packages/social/src/ds-components/CLAUDE.md`

Brief guide:
- "DS Components are render-time UI primitives for the visual-refresh templates"
- "Every component consumes `tokens: DsTokens` from `deriveDsTokens(brandTokens, theme)`"
- "Every component is layout-shift-safe per Spec 59.3.5"
- "Adding a new DS component: write the component file, add to barrel export, add fixtures + visual snapshot tests"

### H.3 Discovered During Implementation

_(Filled by implementer.)_

---

## Implementation Sessions

### Session 1 — `deriveDsTokens` + fixtures (~3-4h)

- Create `packages/social/src/brand-tokens/derive.ts` with all helpers (Section A)
- Create `packages/social/src/brand-tokens/derive.fixtures.ts` with 3 fixtures (G.1)
- Write unit tests (G.2)
- Verify all tests pass + no input mutation
- Commit: `feat(social): deriveDsTokens helper + fixtures`

### Session 2 — DsBackgroundGlow + DsEyebrow + DsFooter (~3-4h)

- Create `packages/social/src/ds-components/DsBackgroundGlow.tsx` (Section B)
- Create `packages/social/src/ds-components/DsEyebrow.tsx` (Section C)
- Create `packages/social/src/ds-components/DsFooter.tsx` (Section D)
- Set up `packages/social/test/visual/ds-components/` harness using Spec 59.3.5 Section D pattern
- Render 3 baseline PNGs per component, commit to repo
- Commit: `feat(social): DsBackgroundGlow + DsEyebrow + DsFooter`

### Session 3 — DsWinnerBadge + DsScoreNumber + barrel exports (~2-3h)

- Create `packages/social/src/ds-components/DsWinnerBadge.tsx` (Section E)
- Create `packages/social/src/ds-components/DsScoreNumber.tsx` (Section F)
- Barrel exports in `packages/social/src/ds-components/index.ts`
- Render baseline PNGs, commit
- Commit: `feat(social): DsWinnerBadge + DsScoreNumber + barrel exports`

### Session 4 — Tests + docs (~2-3h)

- Wire visual diff harness into CI
- Update `packages/social/src/compositions/CLAUDE.md` (Section H.1)
- Create `packages/social/src/ds-components/CLAUDE.md` (Section H.2)
- Cross-link from root CLAUDE.md
- Verify all tests pass: unit, visual, typecheck
- Commit: `feat(social,docs): DS components CLAUDE.md + CI integration`

---

## Out of Scope

- Inter Variable font load — happens in Spec 60.1 (first composition consumer)
- 9:16 variants of DS components — deferred to dual-format spec (60.6+)
- Component for the cover-template specifically (cover redesign handled in 60.1 since single-tool-spotlight is the reference template)
- Animated variants of components (all static for Remotion `renderStill`)
- DS component theming via project-level component overrides (out of scope; project overrides happen at brand_tokens level, not per-component)
- Removal of old `BrandFooter`, `Eyebrow` etc. components from existing compositions — deletion happens in the 60.5 cleanup pass after all templates have migrated

---

## Open Questions

1. **DS components live in `packages/social/src/ds-components/` (new folder) or `packages/social/src/components/ds/` (under existing components/)?**
  - I picked top-level `ds-components/` for visibility. Confirm or relocate.

2. **The DS shadow tokens are absent in dark mode per HTML audit. Should the `DsTokens.shadows` field be `null`/`undefined` in dark theme, or empty strings, or "none"?**
  - I picked "none" (CSS-valid). Alternative: `undefined`, forcing consuming code to null-check. "none" is simpler.

3. **The DS `--font-mono` is `"SF Mono", "JetBrains Mono", "Menlo"`. Should Remotion pre-load any of these via `@remotion/google-fonts`, or rely on the OS fallback chain?**
  - Mono is used for slide counters and score numbers. OS fallback may produce inconsistent renders across CI environments.
  - I default to OS-fallback for 60.0b; mono-font preload added in 60.1 if visual diff fails.

4. **`<DsWinnerBadge>` text color is hardcoded `#06291f` (dark on accent). What if a project's `accentHue` produces a darker accent that breaks contrast?**
  - Section E.4 punts to "project-config issue". Acceptable, or add a fallback "auto-flip to white if accent lightness < 0.5"?
  - Default: hardcode, document.
