/**
 * Spec 65.8 + 65.10 — Runtime switch between Family-B inline end slide
 * and the Spec 65.9 pluggable `<HostSlide>`.
 *
 * Mirrors `_shared/family-a/RenderEndSlide.tsx` but routes the fallback
 * branch to Family-B's `InlineEndSlide` so the visual register matches
 * the rest of the carousel (emotional surface + editorial split-layout).
 *
 * Resolution order:
 *   1. If `endSlideData` parses as `EndSlideData` → `<HostSlide>` (Spec 65.9)
 *   2. Otherwise → Family-B `InlineEndSlide` consuming `FamilyBEndContent`
 *
 * The InlineEndSlide is imported lazily via a `getInlineEndSlide` callback
 * so this file can stay generic across Family-B templates. Each template
 * passes its own end-slide component (currently only story-arc-clickbait
 * exists; future Family-B templates will pass their own inline variant).
 */
import type React from "react";
import { HostSlide } from "../../../end-slide-components/HostSlide.tsx";
import { endSlideDataSchema } from "../../../end-slide-components/types.ts";
import { DsBrandStamp } from "../DsBrandStamp.tsx";
import type { FamilyBEndContent, FamilyBImage } from "./types.ts";

interface RenderEndSlideProps {
  /** Loose at the schema boundary — narrowed here via `endSlideDataSchema.safeParse`. */
  endSlideData?: unknown;
  /** Legacy inline-end-slide payload (used when no `endSlideData` is set). */
  inlineEnd: FamilyBEndContent;
  /** Optional background image for the inline-end-slide editorial split. */
  inlineImage: FamilyBImage | null;
  /** Concrete inline-end-slide component (per Family-B template). */
  InlineEndSlide: React.ComponentType<{
    end: FamilyBEndContent;
    image: FamilyBImage | null;
    brandTokens?: unknown;
    theme: "dark" | "light";
    slideIndex: number;
    slideTotal: number;
    /** Spec 65.16 — forwarded to the inline-end-slide for preset-aware tokens. */
    preset?: "dark-neon-grid" | "light-editorial" | "blue-tech-gradient" | null;
  }>;
  brandTokens?: unknown;
  theme: "dark" | "light";
  locale: "de" | "en";
  slideIndex: number;
  slideTotal: number;
  /** Spec 65.15 — bottom-right brand-stamp watermark on the end slide (bookend). */
  logoUrl?: string | null;
  /** Spec 65.16 — visual-style preset; passed through to the inline-end-slide. */
  preset?: "dark-neon-grid" | "light-editorial" | "blue-tech-gradient" | null;
}

export const RenderEndSlide: React.FC<RenderEndSlideProps> = ({
  endSlideData,
  inlineEnd,
  inlineImage,
  InlineEndSlide,
  brandTokens,
  theme,
  locale,
  slideIndex,
  slideTotal,
  logoUrl,
  preset,
}) => {
  if (endSlideData !== undefined) {
    const parsed = endSlideDataSchema.safeParse(endSlideData);
    if (parsed.success) {
      return (
        <>
          <HostSlide
            data={parsed.data}
            theme={theme}
            locale={locale}
            brandTokens={brandTokens}
          />
          <DsBrandStamp logoUrl={logoUrl} />
        </>
      );
    }
  }
  return (
    <>
      <InlineEndSlide
        end={inlineEnd}
        image={inlineImage}
        brandTokens={brandTokens}
        theme={theme}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        {...(preset !== undefined && { preset })}
      />
      <DsBrandStamp logoUrl={logoUrl} />
    </>
  );
};
