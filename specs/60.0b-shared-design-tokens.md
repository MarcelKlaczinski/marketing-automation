# Spec 60.0b v2 — Shared DS Helpers (Lean)

**Theme:** 60 (Design System Visual Refresh)
**Status:** Implemented (2026-05-19)
**Estimated effort:** 0.5 day (~4-5 focused hours across 2 sessions)
**Prerequisite:** Spec 60.0 (schema sync) + Spec 60.0c (skill installed) shipped
**Successor:** Spec 60.1 — single-tool-spotlight Visual Refresh

**Supersedes:** the original Spec 60.0b draft (5 components + helper) — that version was speculative; this revision is evidence-based after reading the actual HTML.

---

## Goal

Build the minimum shared infrastructure needed by Spec 60.1+ template refreshes:

1. **`deriveDsTokens(brandTokens, theme)`** — pure function returning the full DS token set from `brand_tokens` + theme parameter (per Spec 60.0's schema with `brandHue` / `accentHue`)
2. **`<DsGlow>`** — the only React component genuinely shared across all 5 templates (radial gradient + blur, parameterized by corner/color/intensity)
3. **`<DsTop>` + `<DsFoot>`** — top eyebrow row and footer logo row — visually identical in 4/5 templates per HTML evidence

That's it. No `<DsWinnerBadge>`, no `<DsScoreNumber>`, no shared eyebrow scaffolding — those exist in specific templates with template-local styling and are better inlined per-template.

After 60.0b v2 lands, Spec 60.1 (single-tool-spotlight) imports `deriveDsTokens` + 3 components and writes everything else inline.

## Why this revision

The original Spec 60.0b drafted 5 components based on the Audit's HTML pattern analysis (Section 3A). Reading the actual HTML files in `.claude/skills/toolwiki-design/slides/` after Spec 60.0c installed them changed two things:

1. **REMOTION.md's explicit guidance**: "Don't restructure the layout when porting — the grid sizing was tuned to the 1080×1350 canvas. The static CSS in each template's `<style>` block transfers 1:1 to inline styles." → most "shared component" abstractions add a layer that REMOTION.md says to avoid.

2. **Empirical inspection of the HTML files** (`single-tool-spotlight-dark.html`, `comparison-grid-4-dark.html`, etc.) shows:
  - `.top` eyebrow row: **identical CSS in 4/5 templates** (cover adds an extra update-badge but the base `.top` block is the same)
  - `.foot` block: **identical CSS in 4/5 templates** (cover uses 48px logo vs 44px elsewhere)
  - `.template::before` radial glow: **structurally identical** in all 5 (parameterized: corner inset, size 800-900px, color brand vs accent, alpha 22-42%)
  - `.template` root grid: **different per template** (cover has 6 rows, single-tool-spotlight has 6, grid-4 has 4) — not shareable
  - Score numbers, winner badges, tool cards: **template-specific styling** despite same DS tokens — better inlined

Result: 3 shared components and 1 derivation function — the minimum that genuinely deduplicates without imposing structure REMOTION.md warns against.

## What this is NOT

- Not visual changes to existing compositions — those happen per-template in 60.1+
- Not the Inter Variable font load — that lands in 60.1 (first composition that needs it)
- Not a refactor of existing `BrandFooter` / `Eyebrow` components — they stay until all templates have migrated; deletion in the 60.5 cleanup pass

## Sections

- **Section A**: `deriveDsTokens(brandTokens, theme)`
- **Section B**: `<DsGlow>` component
- **Section C**: `<DsTop>` + `<DsFoot>` components
- **Section D**: Fixtures + tests
- **Section E**: CLAUDE.md update

---

## Section A — `deriveDsTokens(brandTokens, theme)`

### A.1 Why this still exists (unchanged from original 60.0b)

Spec 60.0 added `colors.brandHue` and `colors.accentHue` numeric fields to `brandTokensSchema`. Compositions need the full DS token set (7 brand stops, 2 accent stops, theme-conditional surface/ink/border, semantic colors). `deriveDsTokens()` computes all of those from `brand_tokens` + theme at render time.

This isolates derivation logic in one place. Every composition gets identical tokens for identical inputs.

### A.2 File location

```
packages/social/src/brand-tokens/derive.ts
```

Per Spec 60.0 Section E.2: schema in `packages/shared/`, derivation in `packages/social/` (render-time concern).

### A.3 The function

Reference values come directly from `.claude/skills/toolwiki-design/colors_and_type.css` (Audit Section 2A confirmed).

```typescript
import type { BrandTokens } from "@marketing-auto/shared/brand-tokens";

export interface DsTokens {
  brand: { 50: string; 100: string; 300: string; 500: string; 700: string; 900: string; 950: string };
  accent: { 500: string; 600: string };
  surface: { base: string; raised: string; sunken: string };
  border: string;
  ink: { base: string; muted: string };
  semantic: { success: string; warn: string; danger: string; info: string };
  shadows: { sm: string; md: string };
  pricing: { free: string; freemium: string; paid: string };
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
): DsTokens {
  const brandHue = brandTokens.colors.brandHue ?? 248;
  const accentHue = brandTokens.colors.accentHue ?? 168;

  const brand = {
    50:  `oklch(97% 0.018 ${brandHue})`,
    100: `oklch(94% 0.040 ${brandHue})`,
    300: `oklch(80% 0.100 ${brandHue})`,
    500: `oklch(64% 0.160 ${brandHue})`,
    700: `oklch(48% 0.140 ${brandHue})`,
    900: `oklch(32% 0.080 ${brandHue})`,
    950: `oklch(22% 0.060 ${brandHue})`,
  };

  const accent = {
    500: `oklch(72% 0.150 ${accentHue})`,
    600: `oklch(64% 0.160 ${accentHue})`,
  };

  const isDark = theme === "dark";

  return {
    brand,
    accent,
    surface: {
      base: isDark ? brandTokens.colors.surfaceDark : brandTokens.colors.surface,
      raised: isDark
        ? (brandTokens.colors.surfaceRaisedDark ?? "oklch(20% 0.025 250)")
        : (brandTokens.colors.surfaceRaised ?? "oklch(99% 0.005 250)"),
      sunken: isDark
        ? (brandTokens.colors.surfaceSunkenDark ?? "oklch(13% 0.020 250)")
        : (brandTokens.colors.surfaceSunken ?? "oklch(97% 0.010 250)"),
    },
    border: isDark
      ? (brandTokens.colors.borderDark ?? "oklch(28% 0.020 250)")
      : (brandTokens.colors.border ?? "oklch(92% 0.010 250)"),
    ink: {
      base: isDark ? "oklch(95% 0.010 250)" : "oklch(20% 0.025 250)",
      muted: isDark ? "oklch(95% 0.010 250 / 0.65)" : "oklch(20% 0.025 250 / 0.70)",
    },
    semantic: {
      success: "oklch(70% 0.160 145)",
      warn: "oklch(78% 0.160 75)",
      danger: "oklch(62% 0.200 28)",
      info: brand[500],
    },
    shadows: isDark
      ? { sm: "none", md: "none" }
      : {
          sm: "0 1px 2px oklch(0% 0 0 / 0.06), 0 4px 12px oklch(0% 0 0 / 0.05)",
          md: "0 1px 0 oklch(0% 0 0 / 0.04), 0 16px 32px -12px oklch(0% 0 0 / 0.18)",
        },
    pricing: {
      free: brandTokens.colors.pricingFree,
      freemium: brandTokens.colors.pricingFreemium,
      paid: brandTokens.colors.pricingPaid,
    },
    typography: {
      fontFamily: brandTokens.typography.fontFamily,
      fontFamilyMono: brandTokens.typography.fontFamilyMono,
      headingWeight: brandTokens.typography.headingWeight,
      bodyWeight: brandTokens.typography.bodyWeight,
      eyebrowLetterSpacing: brandTokens.typography.eyebrowLetterSpacing,
    },
  };
}
```

### A.4 Decisions worth flagging

- **`ink.base`/`ink.muted` are derived from theme, NOT from `brandTokens.colors.ink`**: the DS specifies ink as theme-driven. Stored `brandTokens.colors.ink`/`inkMuted` are ignored by `deriveDsTokens`. They remain in the schema for back-compat with `getThemeTokens()` (the legacy theme helper) but new compositions consume `tokens.ink.*` exclusively.
- **`semantic.info` follows brand**: matches DS reference (`--info: var(--brand-500)`). If a project's `brandHue` changes, `info` follows automatically.
- **No memoization here**: the function is pure and called once per slide render. Callers can `useMemo` per (project, theme) if needed.

### A.5 Discovered During Implementation

- The `??` fallback on `brandHue`/`accentHue` is redundant in practice because `brandTokensSchema` applies `.default(248)` / `.default(168)` — stored tokens always have these fields. The fallbacks are kept as a defensive belt-and-suspenders measure since `deriveDsTokens` accepts any `BrandTokens` value (including hand-crafted ones in tests).

---

## Section B — `<DsGlow>`

### B.1 Why this is shared

Empirical evidence from inspecting all 5 HTML files in `.claude/skills/toolwiki-design/slides/`:

| Template | Corner | Size | Color | Alpha (dark / light) | Blur |
|---|---|---|---|---|---|
| `cover` | top-right + bottom-left (dual) | 880px / 880px | brand + accent | 42/28 + 22/16 | 70px |
| `comparison-grid-4` | top-right | 800px | brand | 28 / 28 | 60-70px |
| `comparison-grid-3` | bottom-left | 800px | brand | 25 / 25 | 60-70px |
| `verdict-per-use-case` | top-left | 800px | accent | 22 / 22 | 60-70px |
| `single-tool-spotlight` | bottom-right | 900px | brand | 32 / 28 | 70px |

Same CSS structure (`radial-gradient(closest-side, color-mix(in oklab, ${color} ${alpha}%, transparent), transparent 70%)` + `filter: blur(${blur}px)`), only the parameters differ. Single component, 5-6 prop combinations.

### B.2 File location

```
packages/social/src/ds-components/DsGlow.tsx
```

### B.3 Component signature

```typescript
import type { DsTokens } from "../brand-tokens/derive";

export type GlowCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface DsGlowProps {
  tokens: DsTokens;
  theme: "dark" | "light";
  corner: GlowCorner;
  color: "brand" | "accent";
  /** Glow size in px. Default 800. Cover uses 880, spotlight 900. */
  size?: number;
  /** Negative offset from corner. Default -240. Single-tool-spotlight uses -300; cover uses asymmetric. */
  inset?: number | { x: number; y: number };
  /** Alpha 0-100 (matches DS `%` value in color-mix). If omitted, defaults per (color, theme). */
  alpha?: number;
  /** Blur in px. Default 60 (dark) / 70 (light per cover convention; otherwise 60). */
  blur?: number;
}

export const DsGlow: React.FC<DsGlowProps>;
```

### B.4 Implementation

```tsx
import React from "react";
import type { DsGlowProps } from "./types";

const DEFAULT_ALPHA: Record<"brand" | "accent", Record<"dark" | "light", number>> = {
  brand: { dark: 28, light: 28 },
  accent: { dark: 22, light: 16 },
};

export const DsGlow: React.FC<DsGlowProps> = ({
  tokens,
  theme,
  corner,
  color,
  size = 800,
  inset = -240,
  alpha,
  blur = 60,
}) => {
  const effectiveAlpha = alpha ?? DEFAULT_ALPHA[color][theme];
  const colorValue = color === "brand" ? tokens.brand[500] : tokens.accent[500];

  const insetX = typeof inset === "object" ? inset.x : inset;
  const insetY = typeof inset === "object" ? inset.y : inset;

  const positionStyle: React.CSSProperties = { position: "absolute" };
  if (corner.startsWith("top")) positionStyle.top = insetY;
  else positionStyle.bottom = insetY;
  if (corner.endsWith("left")) positionStyle.left = insetX;
  else positionStyle.right = insetX;

  return (
    <div
      aria-hidden
      style={{
        ...positionStyle,
        width: size,
        height: size,
        background: `radial-gradient(closest-side, color-mix(in oklab, ${colorValue} ${effectiveAlpha}%, transparent), transparent 70%)`,
        filter: `blur(${blur}px)`,
        pointerEvents: "none",
      }}
    />
  );
};
```

### B.5 `color-mix(in oklab, ...)` in Remotion Chromium

The DS HTML uses `color-mix(in oklab, ${color} ${alpha}%, transparent)` instead of pre-computed `oklch(... / alpha)`. The audit's Section 8 didn't flag this as a problem. Remotion runs modern Chromium so `color-mix` works. Implementer should verify with a baseline render — if `color-mix` doesn't render, fall back to manual oklch-with-alpha string construction.

### B.6 Dual-glow support (cover)

The cover has two glows. Compose two `<DsGlow>` instances:

```tsx
<DsGlow tokens={tokens} theme={theme} corner="top-right" color="brand"
  size={880} inset={{ x: -200, y: -120 }} alpha={theme === "dark" ? 42 : 28} blur={70} />
<DsGlow tokens={tokens} theme={theme} corner="bottom-left" color="accent"
  size={880} inset={-200} alpha={theme === "dark" ? 22 : 16} blur={70} />
```

### B.7 Layout-shift safety

`position: absolute` + fixed-px size + fixed-px inset = outside document flow. Surrounding content unaffected. Spec 59.3.5 patterns respected.

### B.8 Discovered During Implementation

_(Filled by implementer.)_

---

## Section C — `<DsTop>` + `<DsFoot>`

### C.1 Why these are shared (per HTML evidence)

The `.top` block (eyebrow + slide counter) and `.foot` block (logo + CTA) are byte-for-byte identical in CSS across 4/5 templates. Reading `comparison-grid-4-dark.html`, `comparison-grid-3-dark.html`, `verdict-per-use-case-dark.html`, `single-tool-spotlight-dark.html`:

**`.top`** — all 4 identical:
```css
.top { display: flex; justify-content: space-between; align-items: flex-start; }
.top .eyebrow { font-size: 17px; letter-spacing: 0.14em; line-height: 1.15; white-space: nowrap; }
.top .num { font-family: var(--font-mono); font-size: 17px; color: var(--ink-muted); margin-top: 8px; }
.top .right { font-family: var(--font-mono); font-size: 17px; color: var(--ink-muted); text-align: right; line-height: 1.5; }
```

**`.foot`** — all 4 identical (cover varies logo height: 48px vs 44px):
```css
.foot { display: flex; justify-content: space-between; align-items: flex-end; }
.foot .brand img { height: 44px; display: block; }
.foot .cta { font-size: 18px; color: var(--ink-muted); text-align: right; line-height: 1.4; }
.foot .cta strong { color: var(--ink); font-weight: 600; }
```

Cover has an additional `.top .right .update` badge — variant handled via optional prop, not separate component.

### C.2 `<DsTop>` signature

```typescript
export interface DsTopProps {
  tokens: DsTokens;
  /** Eyebrow text (left side). Example: "Vergleich · 4 Bildgeneratoren" */
  eyebrow: string;
  /** Slide counter or date/URL (right side). Example: "01 / 06" or "As of 05/2026 · toolwiki.ai/images" */
  rightText: string;
  /** Optional secondary line under eyebrow (used by some templates for date/URL). */
  num?: string;
  /** Optional update-badge variant for cover slide (renders a pill on the right). */
  updateBadge?: string;
}

export const DsTop: React.FC<DsTopProps>;
```

### C.3 `<DsTop>` implementation

```tsx
export const DsTop: React.FC<DsTopProps> = ({ tokens, eyebrow, rightText, num, updateBadge }) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 17,
            fontFamily: tokens.typography.fontFamily,
            fontWeight: 700,
            letterSpacing: "0.14em",
            lineHeight: 1.15,
            whiteSpace: "nowrap",
            color: tokens.ink.base,
          }}
        >
          {eyebrow}
        </div>
        {num && (
          <div
            style={{
              fontFamily: tokens.typography.fontFamilyMono,
              fontSize: 17,
              color: tokens.ink.muted,
              marginTop: 8,
            }}
          >
            {num}
          </div>
        )}
      </div>
      {updateBadge ? (
        <DsUpdateBadge tokens={tokens} text={updateBadge} />
      ) : (
        <div
          style={{
            fontFamily: tokens.typography.fontFamilyMono,
            fontSize: 17,
            color: tokens.ink.muted,
            textAlign: "right",
            lineHeight: 1.5,
          }}
        >
          {rightText}
        </div>
      )}
    </div>
  );
};

// Internal — only used by cover template, not exported separately
const DsUpdateBadge: React.FC<{ tokens: DsTokens; text: string }> = ({ tokens, text }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 14px",
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.04em",
      color: tokens.brand[300],
      background: `color-mix(in oklab, ${tokens.brand[500]} 10%, transparent)`,
    }}
  >
    {text}
  </span>
);
```

### C.4 `<DsFoot>` signature

```typescript
export interface DsFootProps {
  tokens: DsTokens;
  /** Logo image URL (typically wordmark from brandTokens.social.logoAssetKey resolution). */
  logoUrl?: string;
  /** Fallback text logo if logoUrl is absent. */
  logoText?: string;
  /** CTA text (right side). Strong-emphasis parts wrap in <strong> via "ctaBold". Example: "Vollständiger Test →" */
  ctaLead?: string;
  ctaBold: string;
  /** Logo height in px. Default 44; cover passes 48. */
  logoHeight?: number;
}

export const DsFoot: React.FC<DsFootProps>;
```

### C.5 `<DsFoot>` implementation

```tsx
import { Img } from "remotion";

export const DsFoot: React.FC<DsFootProps> = ({
  tokens,
  logoUrl,
  logoText,
  ctaLead,
  ctaBold,
  logoHeight = 44,
}) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
      }}
    >
      <div>
        {logoUrl ? (
          <Img src={logoUrl} style={{ height: logoHeight, display: "block" }} />
        ) : logoText ? (
          <span
            style={{
              fontFamily: tokens.typography.fontFamily,
              fontWeight: tokens.typography.headingWeight,
              fontSize: Math.round(logoHeight * 0.6),
              color: tokens.ink.base,
            }}
          >
            {logoText}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 18,
          color: tokens.ink.muted,
          textAlign: "right",
          lineHeight: 1.4,
        }}
      >
        {ctaLead && <>{ctaLead}<br /></>}
        <strong style={{ color: tokens.ink.base, fontWeight: 600 }}>{ctaBold}</strong>
      </div>
    </div>
  );
};
```

The two-line CTA pattern (lead + bold) is common in the HTML files (e.g. cover: "Sophie Renner ·" + "**13 min read**"). Templates that only need a single line pass `ctaBold` only.

### C.6 What's intentionally NOT a shared component

To preempt scope-creep questions during implementation:

- **`<DsScoreNumber>`** — score sizes vary 56/84/88px per template, fontWeight/letterSpacing same. Inlining is 5 lines per template. Not worth the abstraction.
- **`<DsWinnerBadge>`** — winner pill exists in comparison-grid-3, comparison-grid-4, verdict-per-use-case but with different padding, icon presence, and label styling. Inline.
- **`<DsToolCard>`** — comparison-grid card / spotlight body block share `var(--surface-raised)` + 1px border + 18px radius. But contents differ entirely. Use shared CSS values (border radius, border color from tokens) inline.
- **`<DsEyebrow>` (top text only)** — replaced by `<DsTop>` which handles the full row. Eyebrow text alone is fontSize/letterSpacing → 3 lines of CSS, not worth a component.

These decisions follow REMOTION.md: "don't restructure the layout when porting".

### C.7 Discovered During Implementation

- **`letterSpacing` in `<DsTop>` must use `tokens.typography.eyebrowLetterSpacing`, not a hardcoded `"0.14em"`**: the spec's C.3 implementation block had `letterSpacing: "0.14em"` as a literal. The `brandTokensSchema` default for `eyebrowLetterSpacing` is `"0.08em"`, so any project without an explicit override would silently render the wrong spacing. Fixed during implementation — the token field exists for exactly this purpose.

---

## Section D — Fixtures + Tests

### D.1 Fixtures

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
    headingWeight: 700,
    bodyWeight: 400,
    eyebrowLetterSpacing: "0.14em",
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

// Custom-hue project — orange brand, cyan accent
export const orangeBrandTokens: BrandTokens = {
  ...toolwikiBrandTokens,
  colors: {
    ...toolwikiBrandTokens.colors,
    brandHue: 30,
    accentHue: 200,
  },
};
```

(The minimal/edge fixtures from the original 60.0b are dropped — the function is pure, two fixtures are enough to test theme switching and hue derivation.)

### D.2 Unit tests — `deriveDsTokens`

```typescript
import { describe, it, expect } from "bun:test"; // packages/social uses bun:test, not vitest
import { deriveDsTokens } from "../src/brand-tokens/derive";
import { toolwikiBrandTokens, orangeBrandTokens } from "../src/brand-tokens/derive.fixtures";

describe("deriveDsTokens", () => {
  it("derives 7 brand stops from brandHue", () => {
    const t = deriveDsTokens(toolwikiBrandTokens, "dark");
    expect(t.brand[500]).toBe("oklch(64% 0.160 248)");
    expect(t.brand[300]).toBe("oklch(80% 0.100 248)");
    expect(t.brand[700]).toBe("oklch(48% 0.140 248)");
  });

  it("hue change affects every brand stop", () => {
    const a = deriveDsTokens(toolwikiBrandTokens, "dark");
    const b = deriveDsTokens(orangeBrandTokens, "dark");
    expect(a.brand[500]).not.toBe(b.brand[500]);
    expect(b.brand[500]).toContain("30");
  });

  it("surface differs between dark and light", () => {
    const dark = deriveDsTokens(toolwikiBrandTokens, "dark");
    const light = deriveDsTokens(toolwikiBrandTokens, "light");
    expect(dark.surface.base).toBe(toolwikiBrandTokens.colors.surfaceDark);
    expect(light.surface.base).toBe(toolwikiBrandTokens.colors.surface);
  });

  it("shadows present only in light", () => {
    const dark = deriveDsTokens(toolwikiBrandTokens, "dark");
    const light = deriveDsTokens(toolwikiBrandTokens, "light");
    expect(dark.shadows.sm).toBe("none");
    expect(light.shadows.sm).toContain("oklch");
  });

  it("info follows brand", () => {
    const t = deriveDsTokens(toolwikiBrandTokens, "dark");
    expect(t.semantic.info).toBe(t.brand[500]);
  });

  it("does not mutate input", () => {
    const snapshot = JSON.parse(JSON.stringify(toolwikiBrandTokens));
    deriveDsTokens(toolwikiBrandTokens, "dark");
    expect(toolwikiBrandTokens).toEqual(snapshot);
  });
});
```

### D.3 Visual snapshot tests

Each component renders standalone against 1-2 fixtures, in both themes, via the Spec 59.3.5 visual harness (`packages/social/scripts/visual-render-all.ts`). PNGs are committed to `__baselines__/ds-components/`.

```
packages/social/test/__baselines__/ds-components/
  ds-glow/
    toolwiki-dark-top-right-brand.png
    toolwiki-light-top-right-brand.png
    toolwiki-dark-bottom-left-accent.png
    orange-dark-top-right-brand.png
  ds-top/
    toolwiki-dark.png
    toolwiki-light.png
    with-update-badge.png
  ds-foot/
    toolwiki-dark.png
    toolwiki-light.png
    text-logo-fallback.png
```

11 baselines total. Threshold 0.1% (matches 59.3.5 convention).

Test scaffolding goes into `packages/social/test/visual-ds-components.test.ts`, gated on `RUN_VISUAL=1` per 59.3.5 pattern (Discovery #61).

Note: these baselines ARE committed (unlike the 160 template baselines from 59.3.5 which were gitignored). Reason: 11 small PNGs of pure components have stable rendering and are valuable as regression anchors when DS tokens change. The template baselines were too many + too sensitive to noise; component baselines are few + stable.

### D.4 Discovered During Implementation

- **`vitest` → `bun:test`**: Section D.2 spec code used `import { describe, it, expect } from "vitest"`. All existing tests in `packages/social` use `bun:test`; `vitest` is not installed in this package. Implementation used `bun:test` to match codebase convention.
- **Visual render script deferred**: The visual snapshot test (`visual-ds-components.test.ts`) references `scripts/visual-render-ds-components.ts` which was scaffolded but not yet implemented. The script requires a Remotion render harness for standalone components outside a full composition context — deferred to Spec 60.1 when the first consuming template is wired end-to-end.

---

## Section E — CLAUDE.md Update

### E.1 `packages/social/src/compositions/CLAUDE.md` — Add section

Append a section "Consuming DS helpers (Spec 60.0b v2)":

```markdown
## Consuming DS helpers (Spec 60.0b v2)

For visual-refreshed templates (Spec 60.1+), compositions consume:

- `deriveDsTokens(brandTokens, theme)` from `@/social/brand-tokens/derive`
  → returns the full DS token set (brand stops, accent, surface, ink, etc.)
- `<DsGlow>`, `<DsTop>`, `<DsFoot>` from `@/social/ds-components`
  → the only three components shared across multiple templates

Pattern:

```tsx
import { AbsoluteFill } from "remotion";
import { deriveDsTokens } from "@/social/brand-tokens/derive";
import { DsGlow, DsTop, DsFoot } from "@/social/ds-components";

const MyTemplateSlide: React.FC<Props> = ({ brandTokens, theme, content }) => {
  const tokens = useMemo(() => deriveDsTokens(brandTokens, theme), [brandTokens, theme]);
  return (
    <AbsoluteFill style={{
      background: tokens.surface.base,
      color: tokens.ink.base,
      fontFamily: tokens.typography.fontFamily,
      padding: 56,
      boxSizing: "border-box",
      overflow: "hidden",
    }}>
      <DsGlow tokens={tokens} theme={theme} corner="top-right" color="brand" />
      <div style={{
        position: "relative", zIndex: 1,
        display: "grid",
        gridTemplateRows: "auto auto 1fr auto",
        rowGap: 24, height: "100%",
      }}>
        <DsTop tokens={tokens} eyebrow={content.eyebrow} rightText={content.headerNum} />
        {/* ...template-specific body... */}
        <DsFoot tokens={tokens} logoUrl={content.logoUrl} ctaBold={content.ctaLine} />
      </div>
    </AbsoluteFill>
  );
};
```

Anything beyond these three components belongs INLINE in the slide component. REMOTION.md
explicitly says "don't restructure the layout when porting" — adding more shared abstractions
fights the design system's intent.
```

### E.2 New file: `packages/social/src/ds-components/CLAUDE.md`

```markdown
# DS Components — Shared Render-Time Primitives

These three components deduplicate the parts of Claude Design's HTML that are
genuinely identical across all 5 social-media templates.

- `<DsGlow>` — the radial brand/accent glow that every template uses for visual energy
- `<DsTop>` — the eyebrow + slide-counter row at the top of every slide (4/5 templates identical CSS)
- `<DsFoot>` — the logo + CTA row at the bottom of every slide (4/5 templates identical CSS)

That's the complete inventory. Resist the urge to add `<DsScoreNumber>`,
`<DsWinnerBadge>`, `<DsToolCard>`, etc. — these have template-specific styling
despite consuming the same tokens, and inlining is clearer per REMOTION.md guidance.

## Token consumption

Every DS component takes `tokens: DsTokens` (from `deriveDsTokens(brandTokens, theme)`).
Components NEVER reach into `brandTokens` directly — that's `deriveDsTokens`'s job.

## Layout-shift safety

All components follow Spec 59.3.5 patterns: fixed-px sizes, no `flex-grow` on content,
truncation via CSS ellipsis where applicable.
```

### E.3 Discovered During Implementation

_(Filled by implementer.)_

---

## Implementation Sessions

### Session 1 — `deriveDsTokens` + fixtures + unit tests (~2h)

- Create `packages/social/src/brand-tokens/derive.ts` with the full function (Section A)
- Create `packages/social/src/brand-tokens/derive.fixtures.ts` with 2 fixtures (Section D.1)
- Write unit tests (Section D.2)
- Verify tests pass; no mutation
- Commit: `feat(social): deriveDsTokens helper`

### Session 2 — DsGlow + DsTop + DsFoot + visual baselines + docs (~2-3h)

- Create `packages/social/src/ds-components/{DsGlow,DsTop,DsFoot,index}.tsx`
- Add visual snapshot test scaffolding at `packages/social/test/visual-ds-components.test.ts`
- Render 11 baselines via `RUN_VISUAL=1` mode of existing 59.3.5 harness
- Commit baselines to `packages/social/test/__baselines__/ds-components/` (these ARE committed; see D.3)
- Add `packages/social/src/ds-components/CLAUDE.md` (Section E.2)
- Append section to `packages/social/src/compositions/CLAUDE.md` (Section E.1)
- Verify all tests pass (unit + visual + typecheck)
- Commit: `feat(social): DsGlow + DsTop + DsFoot components + CLAUDE.md`

---

## Out of Scope

- `<DsScoreNumber>`, `<DsWinnerBadge>`, `<DsEyebrow>` (alone, w/o counter) — per Section C.6, inlined per-template
- Inter Variable font load — moves to Spec 60.1 (first composition consumer)
- Composition refactor of existing templates — happens in 60.1+
- Old `BrandFooter` / `Eyebrow` component deletion — 60.5 cleanup pass
- 9:16 variants — deferred (60.6+)
- DS theming via project-level component overrides — out of scope; overrides happen at brand_tokens level

---

## Open Questions

1. **`color-mix(in oklab, ...)` in Remotion Chromium**: per Section B.5, the DS HTML uses this and the audit didn't flag issues. First baseline render in Session 2 verifies. If it fails, swap to manual alpha string construction (no spec change needed; just helper internal).

2. **Cover's `.top .right .update` badge**: I rendered it as an internal `<DsUpdateBadge>` inside `<DsTop>`, gated by the `updateBadge` prop. Alternative: expose it as a separate component for cleaner API. _Default: keep internal — only cover uses it, no other template needs it._

3. **Two-line CTA pattern in `<DsFoot>` (`ctaLead` + `ctaBold`)**: I made `ctaLead` optional. Templates that have only `"Vollständiger Test →"` (without a lead line) pass `ctaBold` only. Confirm that pattern matches the actual usage across templates — implementer should verify when porting first template.

4. **Should baselines for DS components be committed (unlike template baselines)?** Section D.3 argues yes (small number, stable). Confirm or override.

---

## Cost / Time Estimate

| Session | Effort | Risk |
|---|---|---|
| 1 (deriveDsTokens) | ~2h | Low — pure function, well-tested in isolation |
| 2 (3 components + baselines + docs) | ~2-3h | Low-Medium — `color-mix` is the only minor unknown |
| **Total** | **~4-5h** | About half the original 60.0b estimate; this revision dropped ~50% of the planned components |
