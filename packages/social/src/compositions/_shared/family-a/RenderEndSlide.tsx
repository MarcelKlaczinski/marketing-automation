/**
 * Spec 65.10 — Runtime switch between the inline `FamilyAEnd` slide and the
 * Spec 65.9 pluggable `<HostSlide>`. Used by all four Family-A carousel
 * templates so a single component owns the decision.
 *
 * Resolution order:
 *   1. If `endSlideData` is a valid `EndSlideData` (Zod-parses) → `<HostSlide>`
 *   2. Otherwise → legacy inline `<EndSlide>` consuming `FamilyAEndContent`
 *
 * Back-compat: existing tool / comparison articles (Astro-imported, no
 * recurring metadata) carry no `endSlideData` and continue to render the
 * inline end frame. Only briefs whose `recurringMetadata.formatConfig.
 * selectedEndSlide` was populated by Spec 65.5 brief-generators land in the
 * HostSlide branch.
 */
import type React from "react";
import { HostSlide } from "../../../end-slide-components/HostSlide.tsx";
import { endSlideDataSchema } from "../../../end-slide-components/types.ts";
import { EndSlide } from "../../comparison-grid-3/slides/EndSlide.tsx";
import { DsBrandStamp } from "../DsBrandStamp.tsx";
import type { FamilyAEndContent } from "./types.ts";

interface RenderEndSlideProps {
  end: FamilyAEndContent;
  eyebrow: string;
  theme: "dark" | "light";
  locale: "de" | "en";
  slideIndex: number;
  slideTotal: number;
  brandTokens?: unknown;
  /** Optional Spec 65.9 end-slide data (loose; parsed here). */
  endSlideData?: unknown;
  /** Spec 65.15 — bottom-right brand-stamp watermark on the end slide (bookend). */
  logoUrl?: string | null;
}

export const RenderEndSlide: React.FC<RenderEndSlideProps> = ({
  end,
  eyebrow,
  theme,
  locale,
  slideIndex,
  slideTotal,
  brandTokens,
  endSlideData,
  logoUrl,
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
    // Fall through to legacy EndSlide — malformed jsonb shouldn't break
    // rendering; the inline end frame is always a safe fallback.
  }

  return (
    <>
      <EndSlide
        content={end}
        eyebrow={eyebrow}
        theme={theme}
        locale={locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        {...(brandTokens !== undefined && { brandTokens })}
      />
      <DsBrandStamp logoUrl={logoUrl} />
    </>
  );
};
