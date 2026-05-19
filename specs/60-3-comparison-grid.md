# Spec 60.3 — `comparison-grid-3` Remotion Composition

**Date:** 2026-05-19
**Theme:** 60 — Design System Migration
**Template key:** `comparison-grid-3`
**Visual source:** Claude Design HTML (4 variants: dark/light × de/en)
**Prerequisite:** 60.2 done, `DsGlow` supports `position` prop
**Estimated effort:** ~0.75 day (simpler than grid-4 in some ways, more complex in others due to bullets row)

---

## TL;DR

Implement `comparison-grid-3` Remotion composition. Three tool cards in an `auto`-height stack (not fixed px). Each card has a **two-row grid**: top row = logo + head + score/price, bottom row = bullets (2×2 pro/con grid spanning full width). Winner card: accent border + glow + flag pill **left-anchored** (opposite of grid-4). Glow: **bottom-left** (same as spotlight, opposite of grid-4). Score: **56px** (not 84px). Sub text: **18px** (not 19px).

---

## Section A — Design Audit (from HTML)

### A.1 Canvas & Grid

```
Canvas:         1080 × 1350px
Padding:        56px all sides
Grid rows:      auto auto 1fr auto   (top / hero / stack / foot)
Row gap:        28px                  (grid-4 uses 32px — different!)
Overflow:       hidden
```

### A.2 Glow

```
Position:       bottom-left (inset: auto auto -240px -240px)
Size:           800 × 800px
Color:          color-mix(in oklab, var(--brand-500) 25%, transparent)
Blur:           filter: blur(50px)
```

**Critical:** glow alpha is **25%** here (grid-4 = 28%, spotlight = 28%). Bottom-left position same as spotlight.

### A.3 Top Bar — identical to all templates

```
Left:
  .eyebrow    font-size 17px, letter-spacing 0.14em, line-height 1.15, white-space nowrap
  .num        font-mono, 17px, color ink-muted, margin-top 8px

Right:
  .right      font-mono, 17px, color ink-muted, text-align right, line-height 1.5
```

### A.4 Hero

```
h1:     font-size 60px, weight 700, line-height 1.08, letter-spacing -0.035em, margin 0
  .em:  color var(--brand-300)
.sub:   font-size 18px (grid-3 = 18px; grid-4 = 19px!), color ink-muted,
        margin-top 18px, max-width 920px (grid-4 = 880px!), line-height 1.4
```

Two deltas vs grid-4: sub font-size **18px** (not 19px), sub max-width **920px** (not 880px).

### A.5 Stack

```
display:            grid
grid-template-rows: repeat(3, auto)    ← AUTO height, not fixed 150px
gap:                14px
```

Three cards, each auto-height determined by content + bullets.

### A.6 Tool Card — two-row grid

```
background:     var(--surface-raised)
border:         1px solid var(--border)
border-radius:  18px
padding:        18px 22px              (grid-4 = 20px 26px — different!)
display:        grid
grid-template-columns: 72px 1fr auto
grid-template-rows:    auto auto       ← TWO rows (grid-4 has one)
align-items:    center
column-gap:     18px                   (grid-4 = 28px — different!)
row-gap:        10px
position:       relative
```

### A.7 Card — top row internals

**Left — Logo:**
```
width: 72px, height: 72px, border-radius: 18px
```

**Middle — `.head`:**
```
.name:  font-size 30px, weight 700, letter-spacing -0.025em, line-height 1
.meta:  font-mono, font-size 12px, color ink-muted, margin-top 6px
        (e.g. "Premium-Ästhetik · web + Discord")
```

Note: grid-3 uses `.head` with `.name` + `.meta` sub-structure.
Grid-4 uses `.mid` with `.name` + `.v`. **Different class names and semantics.**

**Right — `.right`:**
```
display: flex, flex-direction: column, align-items: flex-end, gap: 6px, min-width: 170px

  .score: font-mono, weight 700, font-size 56px (!!), letter-spacing -0.055em,
          line-height 0.85, font-feature-settings "tnum"
          Color: s-hi → accent-500 | s-mid → warn | s-lo → danger

  .price: font-mono, font-size 13px, color ink-muted
          <strong> inside: color ink, weight 600
          Format: "Ab <strong>10 $/Mo</strong>"
```

Score is **56px** (grid-4 = 84px). Price uses inline `<strong>` for the amount.
Right column min-width is **170px** (grid-4 = 150px).

### A.8 Card — bottom row: bullets

```css
.tcard .bullets {
  grid-column: 1 / -1;          /* spans all 3 columns */
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 22px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
```

Each bullet `.b`:
```
display: flex, gap: 8px, align-items: flex-start
font-size: 13px, line-height: 1.35, color: ink-muted

icon: 14 × 14px, flex: none, margin-top: 2px
  .pro i → color: accent-500   (lucide "check")
  .con i → color: danger        (lucide "x")
```

**Exactly 4 bullets per card: 2 pros + 2 cons, rendered in 2×2 grid.**
Pro bullets first (left column top), then cons (right column top), alternating.
Actual HTML order: pro, pro, con, con — CSS grid handles the 2-column layout.

### A.9 Winner Card

```
border-color:   color-mix(in oklab, var(--accent-500) 65%, transparent)
box-shadow:     0 0 0 1px var(--accent-500),
                0 0 60px -10px color-mix(in oklab, var(--accent-500) 50%, transparent)
```

**Winner `.flag` pill:**
```
position:       absolute, top: -14px, LEFT: 32px    ← LEFT-anchored (grid-4 = right!)
background:     var(--accent-500)
color:          #06291f
font-size:      13px, weight 700, letter-spacing 0.14em, text-transform uppercase
padding:        6px 14px, border-radius 999px
display:        inline-flex, white-space nowrap, align-items center, gap 6px
icon:           14 × 14px (lucide "award")
```

### A.10 Footer — identical to all templates

```
display: flex, justify-content: space-between, align-items: flex-end

.brand img:   height 44px
.cta:         font-size 18px, color ink-muted, text-align right, line-height 1.4
              <strong> inside: color ink, weight 600
```

### A.11 Light mode delta

```css
html:not(.dark) .template { background: oklch(99% 0.005 250); }
html:not(.dark) .tcard { box-shadow: var(--shadow-1); }
```

---

## Section B — Slide Architecture

Single slide per article — same as grid-4.

```
slideIndex 0  →  ComparisonGrid3Slide   (the only slide)
```

`renderComparisonGrid3()` calls `renderStill()` once with `slideIndex: 0`.
Worker emits exactly 1 PNG to R2.

---

## Section C — File Structure

### C.1 Files to create

```
packages/social/src/compositions/comparison-grid-3/
  ComparisonGrid3.tsx
  ComparisonGrid3Slide.tsx
  types.ts
  safeZones.ts                 (copy from grid-4 verbatim)
  loadFonts.ts                 (copy from grid-4 verbatim)

packages/social/src/definitions/
  comparison-grid-3.ts

packages/social/src/definitions/fixtures/
  comparison-grid-3.fixtures.ts   (3 fixtures)

packages/social/src/templates/overrides/
  comparison-grid-3.overrides.ts
```

### C.2 Files to modify

```
packages/social/src/templates/types.ts         (verify key exists)
packages/social/src/templates/bootstrap.ts     (register)
packages/social/src/templates/overrides/index.ts
packages/social/src/index.tsx
packages/social/src/render-server.ts           (add renderComparisonGrid3)
apps/api/src/workers/social-render.worker.ts   (add switch case)
```

---

## Section D — TypeScript Types & Zod Schemas

### D.1 `types.ts`

```typescript
import { z } from 'zod';
import type { ContentBounds } from '@marketing-auto/core';

export type ScoreTier = 'hi' | 'mid' | 'lo';

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return 'hi';
  if (score >= 65) return 'mid';
  return 'lo';
}

// ─── LLM raw response schema (snake_case) ─────────────────────────────────────
export const comparisonGrid3LlmResponseSchema = z.object({
  headline: z.string(),
  headline_em: z.string(),
  subline: z.string(),
  eyebrow: z.string(),
  slide_num: z.string(),
  cta_line1: z.string(),
  cta_line2: z.string(),
  date_label: z.string(),
  tools: z.array(z.object({
    name: z.string(),
    meta: z.string(),              // e.g. "Premium-Ästhetik · web + Discord"
    score: z.number().int().min(0).max(100),
    price_prefix: z.string(),      // e.g. "Ab" / "From" / "" (empty = price IS the label)
    price_amount: z.string(),      // the <strong> part, e.g. "10 $/Mo"
    logo_slug: z.string(),
    is_winner: z.boolean(),
    winner_flag_text: z.string().optional(),
    pros: z.array(z.string()).length(2),
    cons: z.array(z.string()).length(2),
  })).length(3),
});

export type ComparisonGrid3LlmResponse = z.infer<typeof comparisonGrid3LlmResponseSchema>;

// ─── Generated (camelCase) ────────────────────────────────────────────────────
export interface ComparisonGrid3Tool {
  name: string;
  meta: string;
  score: number;
  scoreTier: ScoreTier;
  pricePrefix: string;
  priceAmount: string;
  logoSlug: string;
  isWinner: boolean;
  winnerFlagText?: string;
  pros: [string, string];
  cons: [string, string];
}

export interface ComparisonGrid3Generated {
  headline: string;
  headlineEm: string;
  subline: string;
  eyebrow: string;
  slideNum: string;
  ctaLine1: string;
  ctaLine2: string;
  dateLabel: string;
  tools: ComparisonGrid3Tool[];
}

// ─── Composition props ─────────────────────────────────────────────────────────
export interface ComparisonGrid3Props {
  slideIndex: number;
  locale: 'de' | 'en';
  theme: 'dark' | 'light';
  generated: ComparisonGrid3Generated;
  brandTokens: import('@marketing-auto/shared').BrandTokens;
  overrides?: Partial<ComparisonGrid3Overrides>;
}

export interface ComparisonGrid3Overrides {
  // reserved
}

// ─── ContentBounds ─────────────────────────────────────────────────────────────
export const comparisonGrid3Bounds: ContentBounds = {
  headline: { maxChars: 52 },
  headline_em: { maxChars: 22 },
  subline: { maxChars: 130 },
  eyebrow: { maxChars: 38 },
  slide_num: { maxChars: 10 },
  cta_line1: { maxChars: 30 },
  cta_line2: { maxChars: 28 },
  date_label: { maxChars: 36 },
  tools: {
    count: 3,
    children: {
      name: { maxChars: 26 },
      meta: { maxChars: 38 },
      price_prefix: { maxChars: 8 },
      price_amount: { maxChars: 14 },
      winner_flag_text: { maxChars: 18 },
      pros: { count: 2, each: { maxChars: 52 } },
      cons: { count: 2, each: { maxChars: 52 } },
    },
  },
};

// ─── generatedSchema (camelCase, for validateAndReprompt) ──────────────────────
export const comparisonGrid3GeneratedSchema = z.object({
  headline: z.string(),
  headlineEm: z.string(),
  subline: z.string(),
  eyebrow: z.string(),
  slideNum: z.string(),
  ctaLine1: z.string(),
  ctaLine2: z.string(),
  dateLabel: z.string(),
  tools: z.array(z.object({
    name: z.string(),
    meta: z.string(),
    score: z.number(),
    pricePrefix: z.string(),
    priceAmount: z.string(),
    logoSlug: z.string(),
    isWinner: z.boolean(),
    winnerFlagText: z.string().optional(),
    pros: z.tuple([z.string(), z.string()]),
    cons: z.tuple([z.string(), z.string()]),
  })).length(3),
});
```

### D.2 Transform function

```typescript
function transformLlmResponse(raw: ComparisonGrid3LlmResponse): ComparisonGrid3Generated {
  return {
    headline: raw.headline,
    headlineEm: raw.headline_em,
    subline: raw.subline,
    eyebrow: raw.eyebrow,
    slideNum: raw.slide_num,
    ctaLine1: raw.cta_line1,
    ctaLine2: raw.cta_line2,
    dateLabel: raw.date_label,
    tools: raw.tools.map(t => ({
      name: t.name,
      meta: t.meta,
      score: t.score,
      scoreTier: scoreTier(t.score),
      pricePrefix: t.price_prefix,
      priceAmount: t.price_amount,
      logoSlug: t.logo_slug,
      isWinner: t.is_winner,
      winnerFlagText: t.winner_flag_text,
      pros: [t.pros[0], t.pros[1]] as [string, string],
      cons: [t.cons[0], t.cons[1]] as [string, string],
    })),
  };
}
```

**Why `price_prefix` + `price_amount` split:** The HTML uses inline `<strong>`
for the amount (`Ab <strong>10 $/Mo</strong>`). In Remotion this requires two
adjacent `<span>` elements with different styles. Splitting at the schema level
avoids parsing in the component. For free tools, `price_prefix = ""` and
`price_amount = "Kostenlos"` (no bold needed — component renders
`priceAmount` in `ink` color when `pricePrefix` is empty).

---

## Section E — Composition Implementation

### E.1 `ComparisonGrid3.tsx`

Single-slide, no dispatch needed — identical pattern to grid-4.

### E.2 `ComparisonGrid3Slide.tsx`

```tsx
import React, { useMemo } from 'react';
import { Award, Check, X } from 'lucide-react';
import { deriveDsTokens, resolveBrandTokens } from '../../lib/brand-tokens';
import { DsGlow } from '../../ds-components/DsGlow';
import { DsTop } from '../../ds-components/DsTop';
import { DsFoot } from '../../ds-components/DsFoot';
import type { ComparisonGrid3Props, ComparisonGrid3Tool } from './types';

export const ComparisonGrid3Slide: React.FC<ComparisonGrid3Props> = (props) => {
  const { generated: g, brandTokens, theme } = props;

  const tokens = useMemo(
    () => deriveDsTokens(resolveBrandTokens(brandTokens), theme),
    [brandTokens, theme],
  );

  const isLight = theme === 'light';

  return (
    <div
      style={{
        width: 1080,
        height: 1350,
        backgroundColor: isLight ? 'oklch(99% 0.005 250)' : tokens.surface,
        color: tokens.ink,
        fontFamily: tokens.fontSans,
        padding: 56,
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateRows: 'auto auto 1fr auto',
        rowGap: 28,                               // ← 28px (grid-4 = 32px)
      }}
    >
      {/* Glow — BOTTOM-LEFT, alpha 25% */}
      <DsGlow
        tokens={tokens}
        position="bottom-left"
        size={800}
        alpha={0.25}                              // ← 25% (grid-4 = 28%)
      />

      <div style={{ position: 'relative', zIndex: 1, display: 'contents' }}>

        {/* TOP BAR */}
        <DsTop
          tokens={tokens}
          eyebrow={g.eyebrow}
          num={g.dateLabel}
          rightText={g.slideNum}
        />

        {/* HERO */}
        <div>
          <h1
            style={{
              fontSize: 60,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: '-0.035em',
              margin: 0,
            }}
          >
            {g.headline}{' '}
            <span style={{ color: tokens.brand300 }}>{g.headlineEm}</span>
          </h1>
          <p
            style={{
              fontSize: 18,                        // ← 18px (grid-4 = 19px)
              color: tokens.inkMuted,
              maxWidth: 920,                       // ← 920px (grid-4 = 880px)
              lineHeight: 1.4,
              margin: '18px 0 0',
            }}
          >
            {g.subline}
          </p>
        </div>

        {/* STACK — 3 auto-height cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: 'repeat(3, auto)',   // ← auto (grid-4 = 150px fixed)
            gap: 14,
            alignContent: 'start',
          }}
        >
          {g.tools.map((tool, i) => (
            <ToolCard key={i} tool={tool} tokens={tokens} isLight={isLight} />
          ))}
        </div>

        {/* FOOTER */}
        <DsFoot
          tokens={tokens}
          ctaLine1={g.ctaLine1}
          ctaLine2={g.ctaLine2}
        />
      </div>
    </div>
  );
};

// ─── ToolCard ────────────────────────────────────────────────────────────────

interface ToolCardProps {
  tool: ComparisonGrid3Tool;
  tokens: ReturnType<typeof deriveDsTokens>;
  isLight: boolean;
}

const ToolCard: React.FC<ToolCardProps> = ({ tool, tokens, isLight }) => {
  const scoreColor =
    tool.scoreTier === 'hi' ? tokens.accent500 :
    tool.scoreTier === 'mid' ? tokens.warn :
    tokens.danger;

  return (
    <div
      style={{
        backgroundColor: tokens.surfaceRaised,
        border: tool.isWinner
          ? `1px solid color-mix(in oklab, ${tokens.accent500} 65%, transparent)`
          : `1px solid ${tokens.border}`,
        boxShadow: tool.isWinner
          ? `0 0 0 1px ${tokens.accent500}, 0 0 60px -10px color-mix(in oklab, ${tokens.accent500} 50%, transparent)`
          : isLight ? tokens.shadow1 : 'none',
        borderRadius: 18,
        padding: '18px 22px',                      // ← 18/22 (grid-4 = 20/26)
        display: 'grid',
        gridTemplateColumns: '72px 1fr auto',
        gridTemplateRows: 'auto auto',              // ← TWO rows
        alignItems: 'center',
        columnGap: 18,                              // ← 18px (grid-4 = 28px)
        rowGap: 10,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {/* Winner flag — LEFT-anchored */}
      {tool.isWinner && tool.winnerFlagText && (
        <div
          style={{
            position: 'absolute',
            top: -14,
            left: 32,                              // ← left (grid-4 = right: 28px)
            backgroundColor: tokens.accent500,
            color: '#06291f',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            padding: '6px 14px',
            borderRadius: 999,
            display: 'inline-flex',
            whiteSpace: 'nowrap',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Award size={14} strokeWidth={1.75} />
          {tool.winnerFlagText}
        </div>
      )}

      {/* ROW 1 — Logo */}
      <img
        src={`/assets/tools/${tool.logoSlug}.svg`}
        alt={tool.name}
        style={{ width: 72, height: 72, borderRadius: 18 }}
      />

      {/* ROW 1 — Head: name + meta */}
      <div>
        <div
          style={{
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: '-0.025em',
            lineHeight: 1,
          }}
        >
          {tool.name}
        </div>
        <div
          style={{
            fontFamily: tokens.fontMono,
            fontSize: 12,
            color: tokens.inkMuted,
            marginTop: 6,
          }}
        >
          {tool.meta}
        </div>
      </div>

      {/* ROW 1 — Score + Price */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          minWidth: 170,                           // ← 170px (grid-4 = 150px)
        }}
      >
        <div
          style={{
            fontFamily: tokens.fontMono,
            fontWeight: 700,
            fontSize: 56,                          // ← 56px (grid-4 = 84px)
            letterSpacing: '-0.055em',
            lineHeight: 0.85,
            fontFeatureSettings: '"tnum"',
            color: scoreColor,
          }}
        >
          {tool.score}
        </div>
        <div
          style={{
            fontFamily: tokens.fontMono,
            fontSize: 13,
            color: tokens.inkMuted,
          }}
        >
          {tool.pricePrefix && (
            <span>{tool.pricePrefix} </span>
          )}
          <strong style={{ color: tokens.ink, fontWeight: 600 }}>
            {tool.priceAmount}
          </strong>
        </div>
      </div>

      {/* ROW 2 — Bullets (spans all 3 columns) */}
      <div
        style={{
          gridColumn: '1 / -1',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 22px',
          borderTop: `1px solid ${tokens.border}`,
          paddingTop: 12,
        }}
      >
        {tool.pros.map((text, i) => (
          <Bullet key={`pro-${i}`} text={text} isPro tokens={tokens} />
        ))}
        {tool.cons.map((text, i) => (
          <Bullet key={`con-${i}`} text={text} isPro={false} tokens={tokens} />
        ))}
      </div>
    </div>
  );
};

// ─── Bullet ──────────────────────────────────────────────────────────────────

interface BulletProps {
  text: string;
  isPro: boolean;
  tokens: ReturnType<typeof deriveDsTokens>;
}

const Bullet: React.FC<BulletProps> = ({ text, isPro, tokens }) => (
  <div
    style={{
      display: 'flex',
      gap: 8,
      alignItems: 'flex-start',
      fontSize: 13,
      lineHeight: 1.35,
      color: tokens.inkMuted,
    }}
  >
    <div style={{ flexShrink: 0, marginTop: 2, color: isPro ? tokens.accent500 : tokens.danger }}>
      {isPro
        ? <Check size={14} strokeWidth={1.75} />
        : <X size={14} strokeWidth={1.75} />
      }
    </div>
    {text}
  </div>
);
```

---

## Section F — LLM Step & Prompt

Same dual-schema pattern as grid-4 (60.2):
1. `buildConstraintBlock(comparisonGrid3Bounds)` → injected into prompt
2. Prompt-only JSON, extract via `indexOf` / `lastIndexOf`
3. `validateAndReprompt` against `comparisonGrid3LlmResponseSchema`
4. Transform → `ComparisonGrid3Generated`
5. Store in `content.renderInput`

### Prompt template (DE)

```
Du bist Redakteur für toolwiki.ai. Erstelle den Content für eine Instagram-Slide im Format comparison-grid-3.

Artikel-Kontext:
- Titel: {article.title}
- Kategorie: {article.category}
- Body (Auszug): {article.bodyMd | first 1500 chars}
- Tools im Artikel: {article.tools | map name+score+price}

Format-Anforderungen:
{buildConstraintBlock(comparisonGrid3Bounds)}

Die tools-Array enthält genau 3 Einträge. Jedes Tool hat exakt 2 pros und 2 cons.
pros und cons sind kurze, konkrete Aussagen — keine vollständigen Sätze nötig.
price_prefix ist "Ab" bei Preisangaben oder leer bei kostenlosen Tools.
price_amount enthält den Preis-Wert, z.B. "10 $/Mo" oder "Kostenlos".

Ausgabe: Exakt ein JSON-Objekt, kein Markdown, keine Erklärung.

{
  "headline": "...",
  "headline_em": "...",
  "subline": "...",
  "eyebrow": "Vergleich · 3 [Kategorie]",
  "slide_num": "01 / 04",
  "cta_line1": "Workflow-Empfehlungen →",
  "cta_line2": "toolwiki.ai/[slug]",
  "date_label": "Stand MM/YYYY · toolwiki.ai/[slug]",
  "tools": [
    {
      "name": "...",
      "meta": "...",
      "score": 0,
      "price_prefix": "Ab",
      "price_amount": "10 $/Mo",
      "logo_slug": "...",
      "is_winner": true,
      "winner_flag_text": "Top Aesthetic",
      "pros": ["...", "..."],
      "cons": ["...", "..."]
    }
  ]
}
```

### Prompt template (EN)

Same structure, replace:
- `"eyebrow": "Comparison · 3 [Category]"`
- `"cta_line1": "Workflow recommendations →"`
- `"price_prefix": "From"` for paid tools, `""` for free
- `"winner_flag_text"` stays EN (e.g. `"Top Aesthetic"`, `"Best Value"`)

---

## Section G — Definition File

```typescript
// packages/social/src/definitions/comparison-grid-3.ts

import type { TemplateDefinition } from '../templates/types';
import {
  comparisonGrid3Bounds,
  comparisonGrid3GeneratedSchema,
} from '../compositions/comparison-grid-3/types';

export const comparisonGrid3Template: TemplateDefinition = {
  key: 'comparison-grid-3',
  label: { de: '3-Tool-Vergleich', en: '3-Tool Comparison' },
  slideCount: 1,
  bounds: comparisonGrid3Bounds,
  generatedSchema: comparisonGrid3GeneratedSchema,

  eligibility: {
    minToolCount: 3,
    requiredFields: ['tools'],
  },
};
```

---

## Section H — Overrides File

```typescript
// packages/social/src/templates/overrides/comparison-grid-3.overrides.ts

import type { TemplateOverrides } from './types';

export const comparisonGrid3Overrides: TemplateOverrides = {
  copy: {
    winnerFlagText: {
      de: 'Testsieger',
      en: 'Top pick',
    },
    ctaPrefix: {
      de: 'Workflow-Empfehlungen →',
      en: 'Workflow recommendations →',
    },
    eyebrowPrefix: {
      de: 'Vergleich ·',
      en: 'Comparison ·',
    },
  },

  layout: {},

  eligibility: {
    minToolCount: 3,
  },
};
```

---

## Section I — Fixtures

### I.1 `characteristic` fixture

**Scenario:** Standard 3-tool image generator comparison. Matches Claude Design HTML example exactly.

```typescript
export const characteristicFixture: ComparisonGrid3Props = {
  slideIndex: 0,
  locale: 'de',
  theme: 'dark',
  brandTokens: defaultBrandTokens,
  generated: {
    headline: 'Die',
    headlineEm: 'drei Schulen',
    subline: 'Ästhetik, Prompt-Adhärenz oder Kontrolle — jedes Tool steht für eine andere Philosophie. Welches passt zu deinem Job?',
    eyebrow: 'Vergleich · 3 Top-Modelle',
    slideNum: '02 / 04',
    ctaLine1: 'Workflow-Empfehlungen →',
    ctaLine2: 'toolwiki.ai/bilder',
    dateLabel: 'Stand 05/2026 · toolwiki.ai/bilder',
    tools: [
      {
        name: 'Midjourney v7',
        meta: 'Premium-Ästhetik · web + Discord',
        score: 92,
        scoreTier: 'hi',
        pricePrefix: 'Ab',
        priceAmount: '10 $/Mo',
        logoSlug: 'midjourney',
        isWinner: true,
        winnerFlagText: 'Top Aesthetic',
        pros: [
          'Hero-Visuals out-of-the-box auf Agentur-Niveau',
          '--sref & --cref für Marken-Konsistenz',
        ],
        cons: [
          'Schwer aus dem MJ-Look auszubrechen',
          'Text im Bild bleibt schwach',
        ],
      },
      {
        name: 'DALL·E 4',
        meta: 'Prompt-Adhärenz · via ChatGPT',
        score: 81,
        scoreTier: 'hi',
        pricePrefix: 'Ab',
        priceAmount: '20 $/Mo',
        logoSlug: 'dalle',
        isWinner: false,
        pros: [
          'Liefert exakt was du beschreibst',
          'Text endlich lesbar',
        ],
        cons: [
          'Stil oft glatt, austauschbar',
          'Weniger Stil-Kontrolle',
        ],
      },
      {
        name: 'Stable Diffusion',
        meta: 'Maximale Kontrolle · ComfyUI',
        score: 74,
        scoreTier: 'mid',
        pricePrefix: '',
        priceAmount: 'Kostenlos',
        logoSlug: 'stable-diffusion',
        isWinner: false,
        pros: [
          'LoRAs für 98% Charakter-Konsistenz',
          'Kein Abo, keine Quota, lokal',
        ],
        cons: [
          'Steile Lernkurve (Hardware + Nodes)',
          'SD-Default wirkt blass ohne LoRA',
        ],
      },
    ],
  },
};
```

### I.2 `edge-min` fixture

**Scenario:** EN locale, light theme. Very short names, minimal text. No winner card.

```typescript
export const edgeMinFixture: ComparisonGrid3Props = {
  slideIndex: 0,
  locale: 'en',
  theme: 'light',
  brandTokens: defaultBrandTokens,
  generated: {
    headline: 'Three tools,',
    headlineEm: 'one clear winner.',
    subline: 'Quick verdict on three leading AI writing assistants.',
    eyebrow: 'Comparison · 3 tools',
    slideNum: '01 / 03',
    ctaLine1: 'Workflow recommendations →',
    ctaLine2: 'toolwiki.ai/ai',
    dateLabel: 'As of 05/2026 · toolwiki.ai',
    tools: [
      {
        name: 'GPT-4o',
        meta: 'Best all-rounder · ChatGPT',
        score: 91,
        scoreTier: 'hi',
        pricePrefix: 'From',
        priceAmount: '$20/mo',
        logoSlug: 'chatgpt',
        isWinner: false,
        pros: ['Best at creative tasks', 'Widest plugin ecosystem'],
        cons: ['No free tier for GPT-4o', 'Context window limited'],
      },
      {
        name: 'Claude',
        meta: 'Long context · Anthropic',
        score: 89,
        scoreTier: 'hi',
        pricePrefix: 'From',
        priceAmount: '$20/mo',
        logoSlug: 'claude',
        isWinner: false,
        pros: ['200k context window', 'Strong at analysis'],
        cons: ['No image generation', 'Fewer integrations'],
      },
      {
        name: 'Gemini',
        meta: 'Google Search · native',
        score: 75,
        scoreTier: 'mid',
        pricePrefix: '',
        priceAmount: 'Free tier',
        logoSlug: 'gemini',
        isWinner: false,
        pros: ['Free with Google account', 'Live web access'],
        cons: ['Inconsistent quality', 'Limited creative range'],
      },
    ],
  },
};
```

**Acceptance check:** No winner card renders anywhere. All 3 cards use standard border + no flag.

### I.3 `edge-max` fixture

**Scenario:** Maximum-length content. Long tool names, long meta strings, long bullet texts, score tier `lo` present.

```typescript
export const edgeMaxFixture: ComparisonGrid3Props = {
  slideIndex: 0,
  locale: 'de',
  theme: 'dark',
  brandTokens: defaultBrandTokens,
  generated: {
    headline: 'Die drei führenden',
    headlineEm: 'Video-KI-Plattformen.',
    subline: 'Drei Monate Praxistest mit 80 echten Produktionsprojekten — von kurzen Reels bis zu 10-Minuten-Explainern. Das sind die Ergebnisse.',
    eyebrow: 'Vergleich · 3 Video-Generatoren',
    slideNum: '02 / 05',
    ctaLine1: 'Vollständiger Praxistest →',
    ctaLine2: 'toolwiki.ai/video-ki',
    dateLabel: 'Stand 05/2026 · toolwiki.ai/video-ki',
    tools: [
      {
        name: 'Runway Gen-4',
        meta: 'Cinematic Quality · Professionals',      // 37 chars (near bound)
        score: 88,
        scoreTier: 'hi',
        pricePrefix: 'Ab',
        priceAmount: '15 $/Mo',
        logoSlug: 'runway',
        isWinner: true,
        winnerFlagText: 'Profi-Empfehlung',
        pros: [
          'Beste Motion-Konsistenz bei langen Szenen',      // 44 chars
          'Director Mode für präzise Kamera-Kontrolle',      // 44 chars
        ],
        cons: [
          'Teuerste Option im Vergleich bei hohem Volumen',  // 48 chars
          'Render-Zeiten bei 4K über 5 Minuten pro Clip',    // 46 chars
        ],
      },
      {
        name: 'Kling AI 2.0',
        meta: 'Photorealism · API-first Platform',
        score: 82,
        scoreTier: 'hi',
        pricePrefix: 'Ab',
        priceAmount: '0.14 $/Clip',
        logoSlug: 'kling',
        isWinner: false,
        pros: [
          'Fotorealistischste Gesichter im Vergleich',
          'Pay-per-Clip — ideal für kleines Volumen',
        ],
        cons: [
          'Kein konsistenter Charakter über mehrere Clips',
          'API-Dokumentation noch lückenhaft',
        ],
      },
      {
        name: 'Hailuo MiniMax',
        meta: 'Speed & Cost · High Volume',
        score: 61,
        scoreTier: 'lo',
        pricePrefix: '',
        priceAmount: 'Kostenlos (Beta)',
        logoSlug: 'hailuo',
        isWinner: false,
        pros: [
          'Schnellste Generierung im Test (unter 60s)',
          'Kostenlose Beta ohne Warteliste',
        ],
        cons: [
          'Qualität für professionelle Nutzung zu schwach',
          'Datenschutz-Bestimmungen unklar (China-Anbieter)',
        ],
      },
    ],
  },
};
```

**Acceptance checks for edge-max:**
- Score `61` renders in `tokens.danger` (lo tier)
- Long bullet texts (48 chars) fit within 1fr column without overflow
- Cards auto-height expands correctly to accommodate longer bullet lines
- `priceAmount: "Kostenlos (Beta)"` with empty `pricePrefix` renders without leading space
- Long `winnerFlagText: "Profi-Empfehlung"` (16 chars) fits pill without clipping

---

## Section J — render-server.ts

```typescript
export async function renderComparisonGrid3(
  props: ComparisonGrid3Props,
  outputDir: string,
): Promise<string[]> {
  const outputPath = path.join(outputDir, 'slide-0.png');

  await renderStill({
    composition: 'comparison-grid-3',
    serveUrl: getBundleUrl(),
    output: outputPath,
    inputProps: { ...props, slideIndex: 0 },
    imageFormat: 'png',
  });

  return [outputPath];
}
```

---

## Section K — Worker Switch Case

```typescript
case 'comparison-grid-3': {
  const props = buildComparisonGrid3Props(job.data);
  const files = await renderComparisonGrid3(props, tmpDir);
  await uploadSlidesToR2(files, job.data.postId);
  break;
}
```

---

## Section L — DS Component Notes

### L.1 `DsGlow`

Uses `position="bottom-left"` and `alpha={0.25}`. Both values differ from grid-4.
`DsGlow` position support was added as part of 60.2 — verify it exists before starting.

### L.2 `DsTop`

Same usage as grid-4:
- `eyebrow` ✅
- `num` (= dateLabel) ✅
- `rightText` (= slideNum) ✅
- `updateBadge` — NOT used

### L.3 Lucide icons

`comparison-grid-3` is the first template to use `Check` and `X` icons from
`lucide-react` inside the composition. Verify these are available in the
`lucide-react@0.383.0` version pinned in `packages/social/package.json`.
Do not upgrade Lucide — use the pinned version.

---

## Section M — Visual Acceptance Criteria

| Check | Expected |
|---|---|
| Glow position | Bottom-left, 25% alpha |
| Hero sub font-size | 18px (not 19px) |
| Hero sub max-width | 920px (visible difference on long sublines) |
| Stack rows | 3 × auto-height (expands with bullets) |
| Winner flag | Top-left of card (`left: 32px`) |
| Non-winner cards | No flag, standard border |
| Score size | 56px monospace |
| Price — paid | "Ab **10 $/Mo**" (prefix + bold amount) |
| Price — free | "**Kostenlos**" (no prefix, bold) |
| Bullets layout | 2×2 grid, pros left col, cons right col |
| Pro icon | Check, accent-500 color |
| Con icon | X, danger color |
| No-winner edge case | Zero flag pills, layout intact |
| Score tier `lo` | `tokens.danger` color |
| Light theme | oklch background, shadow-1 on cards |

Run visuals:
```bash
RUN_VISUAL=1 bun test packages/social/test/visual-comparison-grid-3.test.ts
```

Commit baselines:
```bash
git add packages/social/test/__baselines__/comparison-grid-3/
git commit -m "test(social): commit comparison-grid-3 visual baselines"
```

---

## Section N — Key Deltas vs. `comparison-grid-4`

| Property | `comparison-grid-3` | `comparison-grid-4` |
|---|---|---|
| `row-gap` | `28px` | `32px` |
| Glow position | bottom-left | top-right |
| Glow alpha | `25%` | `28%` |
| Stack layout | `repeat(3, auto)` | `repeat(4, 150px)` |
| Card grid rows | `auto auto` (2 rows) | 1 row |
| Card padding | `18px 22px` | `20px 26px` |
| Card column-gap | `18px` | `28px` |
| Score size | `56px` | `84px` |
| Score line-height | `0.85` | `0.9` |
| Sub font-size | `18px` | `19px` |
| Sub max-width | `920px` | `880px` |
| Right col min-width | `170px` | `150px` |
| Flag anchor | `left: 32px` | `right: 28px` |
| Tool middle slot | `.head` + `.meta` (tagline) | `.mid` + `.v` (verdict sentence) |
| Bullets row | yes (2 pro + 2 con) | no |
| Price structure | prefix + `<strong>` amount | single string |
| Lucide icons | Award + Check + X | Award only |

---

## Section O — Out of Scope

- Multi-slide variant
- Animated transitions
- comparison-grid-4 changes (done, separate spec)
- verdict-per-use-case (60.4)

---

## Section P — Patterns Established by 60.3

**(80) `comparison-grid-3` card uses a 2-row grid (`gridTemplateRows: 'auto auto'`). The bullets row uses `gridColumn: '1 / -1'` to span all 3 columns. This is a CSS grid span — in Remotion inline styles, write `gridColumn: '1 / -1'` directly in the style prop.**

**(81) Price with inline `<strong>`: split at schema level into `pricePrefix` + `priceAmount`. Component renders `{pricePrefix && <span>{pricePrefix} </span>}<strong>{priceAmount}</strong>`. Never parse price strings in the component.**

**(82) Bullets array: LLM schema enforces exactly `length(2)` for pros and cons. TypeScript type uses `[string, string]` tuple. `validateAndReprompt` will re-prompt if the LLM returns 1 or 3 bullets.**

**(83) Lucide `Check` and `X` icons first used in `comparison-grid-3`. Always import from `lucide-react` (same package as `Award`). Never use unicode checkmarks or HTML entities — icon size and stroke must match `size={14} strokeWidth={1.75}` for visual consistency across templates.**

---

## Section Q — Commit Plan

```
feat(social): add comparison-grid-3 types, bounds, generatedSchema
feat(social): add comparison-grid-3 definition + overrides
feat(social): implement ComparisonGrid3Slide composition
feat(social): wire comparison-grid-3 to render-server + worker
feat(social): add comparison-grid-3 fixtures (characteristic, edge-min, edge-max)
test(social): commit comparison-grid-3 visual baselines
```

One commit per section — no batch commits.
