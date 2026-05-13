import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import type { ThemeTokens } from "../../lib/theme.ts";
import type { ListCarouselInput } from "./types.ts";
import { COVER_LAYOUT_V2 as L } from "./coverLayout.ts";

type Props = {
  input: ListCarouselInput;
  theme: ThemeTokens;
  totalSlides: number;
};

function StunningBackground({ theme }: { theme: ThemeTokens }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `
          radial-gradient(ellipse 70% 70% at 85% 10%, color-mix(in oklch, ${theme.brand} 8%, transparent), transparent 60%),
          radial-gradient(ellipse 60% 60% at 10% 90%, color-mix(in oklch, ${theme.accent} 5%, transparent), transparent 55%),
          ${theme.bg}
        `,
      }}
    />
  );
}

function BigNumberAnchor({
  n,
  brand,
  fontFamily,
  isDark,
}: {
  n: number;
  brand: string;
  fontFamily: string;
  isDark: boolean;
}) {
  const opacity = isDark ? L.bigNumberOpacityDark : L.bigNumberOpacityLight;
  return (
    <div
      style={{
        position: "absolute",
        bottom: L.bigNumberBottom,
        left: L.bigNumberLeft,
        fontSize: L.bigNumberFontSize,
        fontWeight: L.bigNumberFontWeight,
        fontFamily,
        lineHeight: 1,
        color: `color-mix(in oklch, ${brand} ${Math.round(opacity * 100)}%, transparent)`,
        userSelect: "none",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {n}
    </div>
  );
}

function ToolLogosTopRight({ tools }: { tools: ListCarouselInput["tools"] }) {
  const logos = tools.slice(0, 4);
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
          style={{ transform: `rotate(${i % 2 === 0 ? -4 : 4}deg)` }}
        >
          <ToolIconImage
            {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
            {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
            {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
            size={L.toolLogoSize}
          />
        </div>
      ))}
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
  const isDark = input.theme === "dark";

  const promiseAccentColor = theme.accent;
  const promiseLine1Color = theme.ink;
  const promiseLine2Color = theme.accent;

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
      <StunningBackground theme={theme} />

      {/* BigNumber anchor — behind everything */}
      <BigNumberAnchor
        n={toolCount}
        brand={theme.brand}
        fontFamily={fontFamily}
        isDark={isDark}
      />

      {/* Tool logos — top-right, always shown */}
      <ToolLogosTopRight tools={tools} />

      {/* Eyebrow — top-left */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <Eyebrow
          text={cover.eyebrow}
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Main content: hook + promise-block */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          maxWidth: "70%",
          marginTop: 40,
        }}
      >
        {hookOutput ? (
          <>
            {/* Line 1: leadPhrase — base color */}
            <div
              style={{
                fontFamily,
                fontSize: L.hookFontSize,
                fontWeight: L.hookFontWeight,
                lineHeight: L.hookLineHeight,
                color: theme.ink,
                letterSpacing: "-0.03em",
              } as React.CSSProperties}
            >
              {hookOutput.leadPhrase}
            </div>

            {/* Line 2: highlightWord — brand color, no underline */}
            <div
              style={{
                fontFamily,
                fontSize: L.hookFontSize,
                fontWeight: L.highlightFontWeight,
                lineHeight: L.hookLineHeight,
                color: theme.brand,
                letterSpacing: "-0.03em",
                marginTop: L.hookLineGap,
              } as React.CSSProperties}
            >
              {hookOutput.highlightWord}
            </div>

            {/* Line 3: trailPhrase — base color */}
            <div
              style={{
                fontFamily,
                fontSize: L.hookFontSize,
                fontWeight: L.hookFontWeight,
                lineHeight: L.hookLineHeight,
                color: theme.ink,
                letterSpacing: "-0.03em",
                marginTop: L.hookLineGap,
              } as React.CSSProperties}
            >
              {hookOutput.trailPhrase}
            </div>

            {/* Subline */}
            {cover.subhead && (
              <div
                style={{
                  fontFamily,
                  fontSize: L.sublineFontSize,
                  fontWeight: L.sublineFontWeight,
                  color: theme.inkMuted,
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
              accentBarColor={promiseAccentColor}
              line1Color={promiseLine1Color}
              line2Color={promiseLine2Color}
              fontFamily={fontFamily}
            />
          </>
        ) : (
          /* Editorial headline fallback (if no hookOutput, e.g. old carousel re-render) */
          <div
            style={{
              fontFamily,
              fontSize: 96,
              fontWeight: L.hookFontWeight,
              lineHeight: 1.05,
              color: theme.ink,
            }}
          >
            <span>{cover.headlineLead} </span>
            <span style={{ color: theme.brand }}>{cover.headlineHighlight}</span>
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
