import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import type { ThemeTokens } from "../../lib/theme.ts";
import type { HookOutput, ListCarouselInput } from "./types.ts";
import { COVER_LAYOUT_V2 as L } from "./coverLayout.ts";
import { getCoverColors } from "../../themes/coverThemeAdapter.ts";

/**
 * Computes hook font size balancing two constraints:
 *  1. Nowrap constraint — highlight (+ merged trail if short) must fit in ONE line (748px).
 *  2. Lead wrap constraint — lead phrase should wrap to AT MOST 2 lines (2 × 748px).
 * Returns the minimum of both upper bounds, clamped to [84, 108].
 */
function computeHookFontSize(hook: HookOutput, trailIsShort: boolean): number {
  const CHAR_WIDTH_RATIO = 0.55;

  // 1. Nowrap lines: each must fit in TEXT_SAFE_W on one line
  const effectiveHighlight = trailIsShort
    ? `${hook.highlightWord} ${hook.trailPhrase}`
    : hook.highlightWord;
  const nowrapPhrases = trailIsShort
    ? [effectiveHighlight]
    : [hook.highlightWord, hook.trailPhrase];
  let longestNowrap = nowrapPhrases[0] ?? "";
  for (const p of nowrapPhrases) if (p.length > longestNowrap.length) longestNowrap = p;
  const maxForNowrap = Math.floor(L.textSafeWidth / (Math.max(longestNowrap.length, 1) * CHAR_WIDTH_RATIO));

  // 2. Lead phrase: allowed to wrap, but capped at 2 lines to avoid excessive line-count
  const maxForLead = Math.floor((L.textSafeWidth * 2) / (Math.max(hook.leadPhrase.length, 1) * CHAR_WIDTH_RATIO));

  const raw = Math.min(maxForNowrap, maxForLead);
  return Math.min(L.hookFontSize, Math.max(84, raw));
}

type Props = {
  input: ListCarouselInput;
  theme: ThemeTokens;
  totalSlides: number;
};

function StunningBackground({ theme, bgOverride }: { theme: ThemeTokens; bgOverride?: string }) {
  const bg = bgOverride ?? theme.bg;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `
          radial-gradient(ellipse 70% 70% at 85% 10%, color-mix(in oklch, ${theme.brand} 8%, transparent), transparent 60%),
          radial-gradient(ellipse 60% 60% at 10% 90%, color-mix(in oklch, ${theme.accent} 5%, transparent), transparent 55%),
          ${bg}
        `,
      }}
    />
  );
}

function BigNumberAnchor({
  n,
  color,
  fontFamily,
}: {
  n: number;
  color: string;
  fontFamily: string;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: L.bigNumberTop,
        left: L.bigNumberLeft,
        fontSize: L.bigNumberFontSize,
        fontWeight: L.bigNumberFontWeight,
        fontFamily,
        lineHeight: 1,
        color,
        userSelect: "none",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {n}
    </div>
  );
}

function ToolLogosTopRight({
  tools,
  themeMode,
}: {
  tools: ListCarouselInput["tools"];
  themeMode: "dark" | "light";
}) {
  const logos = tools.slice(0, 4);
  // Spec 51a-stunning-v2.1 §3.2 — dark card wraps every tool icon so brand
  // marks render on a consistent dark surface in both themes.
  const cardBg = themeMode === "dark" ? "#1a2540" : "#0a1428";
  return (
    <div
      style={{
        position: "absolute",
        top: L.toolLogoTop,
        right: L.toolLogoRight,
        display: "flex",
        flexDirection: "column",
        gap: L.toolLogoGap,
        zIndex: 2,
      }}
    >
      {logos.map((tool, i) => (
        <div
          key={tool.slug}
          style={{
            transform: `rotate(${i % 2 === 0 ? -4 : 4}deg)`,
            width: L.toolLogoSize,
            height: L.toolLogoSize,
            borderRadius: 14,
            background: cardBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
            boxSizing: "border-box",
          }}
        >
          <ToolIconImage
            {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
            {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
            {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
            size={L.toolLogoSize - 24}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Spec 51a-stunning-v2.1 follow-up — fills the lower half of the cover so the
 * 4:5 (1080×1350) canvas does not run with ~600px of dead space below the
 * promise block. Renders one chip per tool: icon on a dark card, name, and a
 * one-line bestFor / tagline preview.
 */
function ToolPreviewRow({
  tools,
  themeMode,
  brand,
  fontFamily,
}: {
  tools: ListCarouselInput["tools"];
  themeMode: "dark" | "light";
  brand: string;
  fontFamily: string;
}) {
  const display = tools.slice(0, 5);
  if (display.length === 0) return null;
  const cardBg = themeMode === "dark" ? "#1a2540" : "#0a1428";
  const inkColor = themeMode === "dark" ? "#e9edf6" : "#0e1422";
  const subColor = themeMode === "dark" ? "#a8b3c8" : "#475067";

  return (
    <div
      style={{
        marginTop: "auto",
        marginBottom: 80,
        display: "flex",
        flexDirection: "row",
        gap: 16,
        position: "relative",
        zIndex: 2,
      }}
    >
      {display.map((tool) => {
        const sub = tool.bestFor ?? tool.tagline ?? "";
        return (
          <div
            key={tool.slug}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 14,
              padding: "22px 18px",
              borderRadius: 18,
              background: `color-mix(in oklch, ${brand} 8%, transparent)`,
              border: `1.5px solid color-mix(in oklch, ${brand} 35%, transparent)`,
            }}
          >
            <div
              style={{
                width: 80,
                height: 80,
                borderRadius: 14,
                background: cardBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 12,
                boxSizing: "border-box",
              }}
            >
              <ToolIconImage
                {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
                {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
                {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
                size={56}
              />
            </div>
            <div
              style={{
                fontFamily,
                fontSize: 26,
                fontWeight: 800,
                color: inkColor,
                lineHeight: 1.1,
                letterSpacing: "-0.01em",
              }}
            >
              {tool.name}
            </div>
            {sub && (
              <div
                style={{
                  fontFamily,
                  fontSize: 17,
                  fontWeight: 500,
                  color: subColor,
                  lineHeight: 1.3,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical" as const,
                  overflow: "hidden",
                }}
              >
                {sub}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PromiseBlockElement({
  line1,
  line2,
  accentBarColor,
  line1Color,
  line2Color,
  fontFamily,
}: {
  line1: string;
  line2: string;
  accentBarColor: string;
  line1Color: string;
  line2Color: string;
  fontFamily: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        zIndex: 2,
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        gap: 0,
        marginTop: 40,
      }}
    >
      {/* Mint accent bar */}
      <div
        style={{
          width: L.promiseBlockBarWidth,
          minHeight: L.promiseBlockBarHeight,
          background: accentBarColor,
          borderRadius: 4,
          flexShrink: 0,
        }}
      />
      {/* Text lines */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: L.promiseLineGap,
          paddingLeft: L.promiseBlockTextLeft,
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontFamily,
            fontSize: L.promiseLineFontSize,
            fontWeight: L.promiseLineFontWeight,
            color: line1Color,
            lineHeight: 1.2,
          }}
        >
          {line1}
        </div>
        <div
          style={{
            fontFamily,
            fontSize: L.promiseLineFontSize,
            fontWeight: L.promiseLineFontWeight,
            color: line2Color,
            lineHeight: 1.2,
          }}
        >
          {line2}
        </div>
      </div>
    </div>
  );
}

export function CoverSlideStunning({ input, theme, totalSlides }: Props) {
  const { cover, tools, brandTokens } = input;
  const { fontFamily, eyebrowLetterSpacing } = brandTokens.typography;
  const hookOutput = cover.hookOutput;
  const toolCount = tools.length;
  const coverColors = getCoverColors(input.theme, brandTokens);

  return (
    <div
      style={{
        width: 1080,
        height: 1350,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        padding: L.paddingX,
        paddingTop: L.paddingY,
        paddingBottom: 140,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <StunningBackground theme={theme} bgOverride={coverColors.background} />

      {/* BigNumber anchor — behind everything */}
      <BigNumberAnchor
        n={toolCount}
        color={coverColors.bigNumber}
        fontFamily={fontFamily}
      />

      {/* Tool logos — top-right, always shown */}
      <ToolLogosTopRight tools={tools} themeMode={input.theme} />

      {/* Eyebrow — top-left */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <Eyebrow
          text={cover.eyebrow}
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Main content: hook + promise-block. Width is the paddingX-bound 920px
          (Spec 51a-stunning-v2.1 §2). Tool logos float over with z-index. */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          marginTop: 40,
        }}
      >
        {hookOutput ? (
          <>
            {/* Spec 51a-stunning-v2.1 §2 — adaptive font + nowrap = guaranteed lines.
                trailIsShort: merge trailing fragment ("Code?") onto the highlight line
                so it never appears orphaned. hidePreview: hide ToolPreviewRow cards
                when leadPhrase is long to prevent vertical overflow. */}
            {(() => {
              const trailIsShort = hookOutput.trailPhrase.trim().length <= 5;
              const hookFontSize = computeHookFontSize(hookOutput, trailIsShort);
              // Lead phrase can wrap (allows long phrases like "Welcher AI-Editor passt"
              // to break naturally). Highlight + trail stay nowrap (1 line of brand colour).
              const baseStyle: React.CSSProperties = {
                fontFamily,
                fontSize: hookFontSize,
                lineHeight: L.hookLineHeight,
                letterSpacing: "-0.03em",
                maxWidth: L.textSafeWidth,
              };
              return (
                <>
                  <div
                    style={{
                      ...baseStyle,
                      fontWeight: L.hookFontWeight,
                      color: coverColors.hookText,
                      whiteSpace: "normal",
                    }}
                  >
                    {hookOutput.leadPhrase}
                  </div>
                  <div
                    style={{
                      ...baseStyle,
                      fontWeight: L.highlightFontWeight,
                      color: coverColors.hookHighlight,
                      marginTop: L.hookLineGap,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {hookOutput.highlightWord}
                    {trailIsShort && ` ${hookOutput.trailPhrase}`}
                  </div>
                  {!trailIsShort && (
                    <div
                      style={{
                        ...baseStyle,
                        fontWeight: L.hookFontWeight,
                        color: coverColors.hookText,
                        marginTop: L.hookLineGap,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {hookOutput.trailPhrase}
                    </div>
                  )}

                  {/* Subline */}
                  {cover.subhead && (
                    <div
                      style={{
                        fontFamily,
                        fontSize: L.sublineFontSize,
                        fontWeight: L.sublineFontWeight,
                        color: coverColors.subline,
                        marginTop: 24,
                        letterSpacing: "0.01em",
                      }}
                    >
                      {cover.subhead}
                    </div>
                  )}

                  {/* Promise-Block */}
                  <PromiseBlockElement
                    line1={hookOutput.promiseBlock.line1}
                    line2={hookOutput.promiseBlock.line2}
                    accentBarColor={coverColors.promiseAccentBar}
                    line1Color={coverColors.promiseLine1}
                    line2Color={coverColors.promiseLine2}
                    fontFamily={fontFamily}
                  />

                  {/* Tool preview — fills the lower-half of the 4:5 canvas */}
                  <ToolPreviewRow
                    tools={tools}
                    themeMode={input.theme}
                    brand={coverColors.hookHighlight}
                    fontFamily={fontFamily}
                  />
                </>
              );
            })()}
          </>
        ) : (
          /* Editorial headline fallback (if no hookOutput, e.g. old carousel re-render) */
          <div
            style={{
              fontFamily,
              fontSize: 96,
              fontWeight: L.hookFontWeight,
              lineHeight: 1.05,
              color: coverColors.hookText,
            }}
          >
            <span>{cover.headlineLead} </span>
            <span style={{ color: coverColors.hookHighlight }}>{cover.headlineHighlight}</span>
            {cover.headlineTrail && <span> {cover.headlineTrail}</span>}
          </div>
        )}
      </div>

      {/* Footer: page indicator + brand */}
      <div style={{ position: "absolute", bottom: 80, left: L.paddingX, right: L.paddingX, zIndex: 1 }}>
        <BrandFooter
          websiteUrl={brandTokens.social.websiteUrl}
          instagramHandle={brandTokens.social.instagramHandle}
          theme={theme}
          fontFamily={fontFamily}
          slideLabel={`1/${totalSlides}`}
        />
      </div>
    </div>
  );
}
