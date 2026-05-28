import React from "react";
import { AbsoluteFill } from "remotion";
import "./loadFonts.ts"; // Side-effect: registers Inter Variable with Remotion
import { CompareHeaderSlide } from "./slides/CompareHeaderSlide.tsx";
import { CoverSlide } from "./slides/CoverSlide.tsx";
import { ToolSlide } from "./slides/ToolSlide.tsx";
import { VerdictSlide } from "./slides/VerdictSlide.tsx";
import { RenderEndSlide } from "../_shared/family-a/RenderEndSlide.tsx";
import type { ComparisonGrid3Input } from "./types.ts";

/**
 * Spec 65.7 — `comparison-grid-3` multi-slide carousel dispatcher.
 *
 * 7-slide anatomy:
 *   0 — Cover
 *   1 — Compare-Header
 *   2 — Tool slide #1 (rank 1 — winner shown first)
 *   3 — Tool slide #2
 *   4 — Tool slide #3
 *   5 — Verdict
 *   6 — End
 */
export const ComparisonGrid3: React.FC<ComparisonGrid3Input> = (props) => {
  const slideIndex = props.slideIndex;
  const slideTotal = props.slideTotal;
  const brandTokens = props.brandTokens;

  // Slide 0 — Cover
  if (slideIndex === 0) {
    return (
      <CoverSlide
        content={props.cover}
        tools={props.tools}
        theme={props.theme}
        locale={props.locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        endCta={props.end.ctaLine}
        endUrl={props.end.articleUrl}
        {...(brandTokens !== undefined && { brandTokens })}
        {...(props.logoUrl !== undefined && { logoUrl: props.logoUrl })}
      />
    );
  }

  // Slide 1 — Compare-Header
  if (slideIndex === 1) {
    return (
      <CompareHeaderSlide
        content={props.compareHeader}
        eyebrow={props.cover.eyebrow}
        theme={props.theme}
        locale={props.locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        endCta={props.end.ctaLine}
        endUrl={props.end.articleUrl}
        {...(brandTokens !== undefined && { brandTokens })}
      />
    );
  }

  // Slides 2..4 — Tool slides
  const toolIndex = slideIndex - 2;
  if (toolIndex >= 0 && toolIndex < props.tools.length) {
    const tool = props.tools[toolIndex];
    if (tool) {
      return (
        <ToolSlide
          tool={tool}
          rank={toolIndex + 1}
          totalTools={props.tools.length}
          eyebrow={props.cover.eyebrow}
          theme={props.theme}
          locale={props.locale}
          slideIndex={slideIndex}
          slideTotal={slideTotal}
          endCta={props.end.ctaLine}
          endUrl={props.end.articleUrl}
          {...(brandTokens !== undefined && { brandTokens })}
        />
      );
    }
  }

  // Slide 5 — Verdict
  if (slideIndex === 2 + props.tools.length) {
    return (
      <VerdictSlide
        content={props.verdict}
        tools={props.tools}
        theme={props.theme}
        locale={props.locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        endUrl={props.end.articleUrl}
        {...(brandTokens !== undefined && { brandTokens })}
      />
    );
  }

  // Slide 6 — End (Spec 65.10: HostSlide when endSlideData present, else legacy EndSlide)
  if (slideIndex === 3 + props.tools.length) {
    return (
      <RenderEndSlide
        end={props.end}
        eyebrow={props.cover.eyebrow}
        theme={props.theme}
        locale={props.locale}
        slideIndex={slideIndex}
        slideTotal={slideTotal}
        brandTokens={brandTokens}
        endSlideData={props.endSlideData}
        {...(props.logoUrl !== undefined && { logoUrl: props.logoUrl })}
      />
    );
  }

  // Fallback for out-of-range slideIndex
  return <AbsoluteFill style={{ background: "#050507" }} />;
};
