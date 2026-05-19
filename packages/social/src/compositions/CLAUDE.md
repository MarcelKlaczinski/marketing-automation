# Compositions — Layout-Shift-Free Convention

Full documentation: [specs/59.3.5-layout-shift-free-templates.md](/specs/59.3.5-layout-shift-free-templates.md)

Session 5 of Spec 59.3.5 will expand this into the full reference. Until then, the critical rules:

---

## getFontSize — required for all text slots

Shared utility: `src/compositions/_shared/getFontSize.ts`

```ts
import { getFontSize } from "../_shared/getFontSize.ts";

// Always cache — never call twice for the same text+slot
const b = getFontSize(text, "slot-body");
<div style={{ fontSize: b.fontSize, lineHeight: b.lineHeight }}>
```

**SlotType values:** `cover-headline` | `cover-snippet` | `slot-headline` | `slot-body` | `list-item` | `eyebrow` | `caption-cta` | `footer`

**Never use continuous scaling** (`clamp()`, `vw`, `text.length * k`). Discrete buckets only — same input → same pixel output → no baseline drift across fixtures.

**`cover-snippet` produces 44–56px**, not the small italic style some templates used before formalization. It's a prominent slot, not a footnote label.

---

## WebkitLineClamp safety net (Section C.4)

Every LLM-produced text slot must have a `-webkit-line-clamp` safety net. The clamp fires only if content escapes Section A bounds — it should never engage in production, but it prevents render overflow if a bug slips through.

```tsx
// WRONG: -webkit-box overrides display: flex on the same element
<div style={{ display: "flex", WebkitBoxOrient: "vertical" }}> // conflict

// CORRECT: outer element owns flex/layout; inner element owns clamp
<div style={{ flex: 1, overflow: "hidden" }}>
  <div style={{
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    textOverflow: "ellipsis",
  }}>
    {text}
  </div>
</div>
```

---

## Root layout: fixed px, not flex-grow at root

Canvas = 1080×1350px. Root element must declare this explicitly. No `height: auto`, no `flex: 1` at the composition root — these let content push the layout taller than the canvas.

Children inside a fixed-height parent may use `1fr` or `flex: 1` freely, because the parent already constrains the total.

---

## Consuming DS helpers (Spec 60.0b v2 + 60.1)

For visual-refreshed templates (Spec 60.1+), compositions consume:

- `deriveDsTokens(brandTokens, theme)` from `../brand-tokens/derive`
  → returns the full DS token set (brand stops, accent, surface, ink, etc.)
- `resolveBrandTokens(unknown)` from `../lib/brand-tokens`
  → converts loosely-typed input (from Remotion's schema) to fully-typed BrandTokens with defaults
- `<DsGlow>`, `<DsTop>`, `<DsFoot>` from `../../ds-components`
  → the only three components shared across multiple templates

Pattern:

```tsx
import { AbsoluteFill, useMemo } from "remotion";
import { deriveDsTokens } from "../brand-tokens/derive";
import { resolveBrandTokens } from "../lib/brand-tokens";
import { DsGlow, DsTop, DsFoot } from "../../ds-components";

const MyTemplateSlide: React.FC<Props> = ({ brandTokens, theme, content }) => {
  // First: resolve loosely-typed schema input to fully-typed BrandTokens
  const resolvedTokens = resolveBrandTokens(brandTokens);
  
  // Then: derive DS tokens once, memoized for stability across re-renders
  const tokens = useMemo(() => deriveDsTokens(resolvedTokens, theme), [resolvedTokens, theme]);
  
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
