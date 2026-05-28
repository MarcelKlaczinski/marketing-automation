import React from "react";
import { AbsoluteFill } from "remotion";
import "./loadFonts.ts";
import { CompareHeaderSlide } from "../comparison-grid-3/slides/CompareHeaderSlide.tsx";
import { CoverSlide } from "../comparison-grid-3/slides/CoverSlide.tsx";
import { ToolSlide } from "../comparison-grid-3/slides/ToolSlide.tsx";
import { VerdictSlide } from "../comparison-grid-3/slides/VerdictSlide.tsx";
import { RenderEndSlide } from "../_shared/family-a/RenderEndSlide.tsx";
import type { ComparisonGrid5Input } from "./types.ts";

/**
 * Spec 65.7 — `comparison-grid-5` multi-slide carousel dispatcher.
 *
 * 9-slide anatomy. Slide components are reused from `comparison-grid-3` —
 * the only delta is `tools.length === 5` and `slideTotal === 9`.
 */
export const ComparisonGrid5: React.FC<ComparisonGrid5Input> = (props) => {
  const slideIndex = props.slideIndex;
  const slideTotal = props.slideTotal;
  const brandTokens = props.brandTokens;

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

  return <AbsoluteFill style={{ background: "#050507" }} />;
};
