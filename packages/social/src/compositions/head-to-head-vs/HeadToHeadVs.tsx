import React from "react";
import { AbsoluteFill } from "remotion";
import "./loadFonts.ts";
import { CoverSlide } from "../comparison-grid-3/slides/CoverSlide.tsx";
import { ToolSlide } from "../comparison-grid-3/slides/ToolSlide.tsx";
import { VerdictSlide } from "../comparison-grid-3/slides/VerdictSlide.tsx";
import { RenderEndSlide } from "../_shared/family-a/RenderEndSlide.tsx";
import { SideBySideSlide } from "./slides/SideBySideSlide.tsx";
import type { HeadToHeadVsInput } from "./types.ts";

/**
 * Spec 65.7 — `head-to-head-vs` 2-tool comparison carousel dispatcher.
 *
 * 6-slide anatomy:
 *   0 — Cover
 *   1 — Tool A profile
 *   2 — Tool B profile
 *   3 — Side-by-side compare
 *   4 — Verdict
 *   5 — End
 */
export const HeadToHeadVs: React.FC<HeadToHeadVsInput> = (props) => {
  const slideIndex = props.slideIndex;
  const slideTotal = props.slideTotal;
  const brandTokens = props.brandTokens;
  const [toolA, toolB] = props.tools;
  if (!toolA || !toolB) return <AbsoluteFill style={{ background: "#050507" }} />;

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
      <ToolSlide
        tool={toolA}
        rank={1}
        totalTools={2}
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

  if (slideIndex === 2) {
    return (
      <ToolSlide
        tool={toolB}
        rank={2}
        totalTools={2}
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

  if (slideIndex === 3) {
    return (
      <SideBySideSlide
        content={props.compare}
        toolA={toolA}
        toolB={toolB}
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

  if (slideIndex === 4) {
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

  if (slideIndex === 5) {
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
