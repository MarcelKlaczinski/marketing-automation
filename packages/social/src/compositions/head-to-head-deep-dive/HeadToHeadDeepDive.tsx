import React from "react";
import { AbsoluteFill } from "remotion";
import "./loadFonts.ts";
import { CoverSlide } from "../comparison-grid-3/slides/CoverSlide.tsx";
import { ToolSlide } from "../comparison-grid-3/slides/ToolSlide.tsx";
import { VerdictSlide } from "../comparison-grid-3/slides/VerdictSlide.tsx";
import { RenderEndSlide } from "../_shared/family-a/RenderEndSlide.tsx";
import { PricingCompareSlide } from "./slides/PricingCompareSlide.tsx";
import { UseCaseCompareSlide } from "./slides/UseCaseCompareSlide.tsx";
import type { FamilyATool } from "../_shared/family-a/types.ts";
import type { HeadToHeadDeepDiveInput } from "./types.ts";

/**
 * Spec 65.7 — `head-to-head-deep-dive` 2-tool deep comparison dispatcher.
 *
 * 9-slide anatomy:
 *   0 — Cover
 *   1 — Tool A profile (overview)
 *   2 — Tool A features (extended pros + cons)
 *   3 — Tool B profile (overview)
 *   4 — Tool B features (extended pros + cons)
 *   5 — Pricing-compare
 *   6 — Use-case-compare
 *   7 — Verdict
 *   8 — End
 *
 * Tool slides 1/3 reuse grid-3 ToolSlide with the standard tool data; slides
 * 2/4 reuse ToolSlide too but with the tool's `extendedPros`/`extendedCons`
 * spliced in as pros/cons (so the same component can render both views).
 */
export const HeadToHeadDeepDive: React.FC<HeadToHeadDeepDiveInput> = (props) => {
  const slideIndex = props.slideIndex;
  const slideTotal = props.slideTotal;
  const brandTokens = props.brandTokens;
  const [toolA, toolB] = props.tools;
  if (!toolA || !toolB) return <AbsoluteFill style={{ background: "#050507" }} />;

  // Helper to build a "features view" of a tool — same shape, different pros/cons content.
  const withExtendedBullets = (tool: FamilyATool): FamilyATool => {
    const ep = tool.extendedPros;
    const ec = tool.extendedCons;
    return {
      ...tool,
      pros: ep && ep.length >= 2
        ? [ep[0] ?? tool.pros[0], ep[1] ?? tool.pros[1]] as [string, string]
        : tool.pros,
      cons: ec && ec.length >= 2
        ? [ec[0] ?? tool.cons[0], ec[1] ?? tool.cons[1]] as [string, string]
        : tool.cons,
    };
  };

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
      />
    );
  }

  if (slideIndex === 1) {
    return (
      <ToolSlide
        tool={toolA}
        rank={1}
        totalTools={2}
        eyebrow={`${props.cover.eyebrow} · ${toolA.name}`.slice(0, 36)}
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
        tool={withExtendedBullets(toolA)}
        rank={1}
        totalTools={2}
        eyebrow={`${toolA.name} · ${props.locale === "de" ? "Features" : "Features"}`.slice(0, 36)}
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
      <ToolSlide
        tool={toolB}
        rank={2}
        totalTools={2}
        eyebrow={`${props.cover.eyebrow} · ${toolB.name}`.slice(0, 36)}
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
      <ToolSlide
        tool={withExtendedBullets(toolB)}
        rank={2}
        totalTools={2}
        eyebrow={`${toolB.name} · ${props.locale === "de" ? "Features" : "Features"}`.slice(0, 36)}
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

  if (slideIndex === 5) {
    return (
      <PricingCompareSlide
        content={props.pricing}
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

  if (slideIndex === 6) {
    return (
      <UseCaseCompareSlide
        content={props.useCases}
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

  if (slideIndex === 7) {
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

  if (slideIndex === 8) {
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
      />
    );
  }

  return <AbsoluteFill style={{ background: "#050507" }} />;
};
