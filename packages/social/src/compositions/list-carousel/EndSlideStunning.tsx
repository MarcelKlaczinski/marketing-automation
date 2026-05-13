import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import type { ThemeTokens } from "../../lib/theme.ts";
import type { ListCarouselInput } from "./types.ts";

type Props = {
  input: ListCarouselInput;
  theme: ThemeTokens;
  totalSlides: number;
};

// Aurora-style background matching EditorialEndSlide mood but with more depth
function StunningEndBackground({ theme }: { theme: ThemeTokens }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `
          radial-gradient(ellipse 80% 60% at 50% 110%, color-mix(in oklch, ${theme.brand} 18%, transparent) 0%, transparent 65%),
          radial-gradient(ellipse 60% 50% at 90% 10%, color-mix(in oklch, ${theme.accent} 8%, transparent) 0%, transparent 55%),
          ${theme.bg}
        `,
      }}
    />
  );
}

// Tool recap strip — small icons in a row at bottom
function ToolRecapStrip({ tools, recap, theme, fontFamily }: {
  tools: ListCarouselInput["tools"];
  recap: string[] | undefined;
  theme: ThemeTokens;
  fontFamily: string;
}) {
  const slugs = recap ?? tools.map((t) => t.slug);
  const displayTools = tools.filter((t) => slugs.includes(t.slug)).slice(0, 5);
  if (displayTools.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 20px",
        background: `color-mix(in oklch, ${theme.inkMuted} 8%, transparent)`,
        borderRadius: 16,
        border: `1px solid color-mix(in oklch, ${theme.inkMuted} 15%, transparent)`,
      }}
    >
      <span
        style={{
          fontFamily,
          fontSize: 16,
          fontWeight: 600,
          color: theme.inkMuted,
          letterSpacing: "0.05em",
          textTransform: "uppercase" as const,
          flexShrink: 0,
        }}
      >
        Reviewed:
      </span>
      {displayTools.map((tool) => (
        <ToolIconImage
          key={tool.slug}
          {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
          {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
          {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
          size={44}
        />
      ))}
    </div>
  );
}

export function EndSlideStunning({ input, theme, totalSlides }: Props) {
  const { end, tools, brandTokens } = input;
  const { fontFamily, headingWeight, eyebrowLetterSpacing } = brandTokens.typography;
  const closer = end.closer;

  return (
    <div
      style={{
        width: 1080,
        height: 1080,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        boxSizing: "border-box",
      }}
    >
      <StunningEndBackground theme={theme} />

      {/* Top: Eyebrow */}
      <div style={{ position: "relative" }}>
        <Eyebrow
          text="ZUR VERTIEFUNG"
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Center: Closer headline + action blocks */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 36 }}>
        {/* Closer headline — dramatic, engagement-triggering */}
        <div
          style={{
            fontFamily,
            fontSize: 72,
            fontWeight: headingWeight,
            lineHeight: 1.1,
            color: theme.ink,
          }}
        >
          {closer ? (
            <>
              <span>{closer.headlineLead} </span>
              <span style={{ color: theme.brand }}>
                {closer.headlineEmphasis
                  ? <>
                      {closer.headlineTrail.replace(closer.headlineEmphasis, "")}
                      <span
                        style={{
                          textDecoration: "underline",
                          textDecorationColor: `color-mix(in oklch, ${theme.brand} 60%, transparent)`,
                          textDecorationThickness: 3,
                          textUnderlineOffset: 8,
                        }}
                      >
                        {closer.headlineEmphasis}
                      </span>
                    </>
                  : closer.headlineTrail}
              </span>
            </>
          ) : (
            <>
              <span>{end.headline} </span>
              <span style={{ color: theme.brand }}>{end.headlineHighlight}</span>
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Save-action block — primary algo signal */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "22px 28px",
              background: `color-mix(in oklch, ${theme.brand} 12%, transparent)`,
              borderRadius: 18,
              border: `1.5px solid color-mix(in oklch, ${theme.brand} 35%, transparent)`,
            }}
          >
            <span style={{ fontSize: 32 }}>📌</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span
                style={{
                  fontFamily,
                  fontSize: 18,
                  fontWeight: 600,
                  color: theme.inkMuted,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                }}
              >
                Speichere diesen Post
              </span>
              <span style={{ fontFamily, fontSize: 26, fontWeight: 700, color: theme.brand }}>
                als Cheat-Sheet für deinen Workflow
              </span>
            </div>
          </div>

          {/* Follow CTA */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "22px 28px",
              background: `color-mix(in oklch, ${theme.accent} 12%, transparent)`,
              borderRadius: 18,
              border: `1.5px solid color-mix(in oklch, ${theme.accent} 35%, transparent)`,
            }}
          >
            <span style={{ fontSize: 32 }}>📱</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span
                style={{
                  fontFamily,
                  fontSize: 18,
                  fontWeight: 600,
                  color: theme.inkMuted,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                }}
              >
                Mehr ehrliche Vergleiche
              </span>
              <span style={{ fontFamily, fontSize: 26, fontWeight: 700, color: theme.accent }}>
                {brandTokens.social.instagramHandle}
              </span>
            </div>
          </div>

          {/* Article link */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              padding: "20px 28px",
              background: `color-mix(in oklch, ${theme.inkMuted} 8%, transparent)`,
              borderRadius: 18,
              border: `1.5px solid color-mix(in oklch, ${theme.inkMuted} 20%, transparent)`,
            }}
          >
            <span style={{ fontSize: 28 }}>🌐</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span
                style={{
                  fontFamily,
                  fontSize: 16,
                  fontWeight: 600,
                  color: theme.inkMuted,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                }}
              >
                Vollständiger Artikel
              </span>
              <span style={{ fontFamily, fontSize: 22, fontWeight: 600, color: theme.ink, wordBreak: "break-all" }}>
                {end.articleUrl.replace(/^https?:\/\//, "")}
              </span>
            </div>
          </div>
        </div>

        {/* Tool recap strip */}
        <ToolRecapStrip tools={tools} recap={end.toolRecap} theme={theme} fontFamily={fontFamily} />
      </div>

      {/* Bottom: Brand footer */}
      <div style={{ position: "relative" }}>
        <BrandFooter
          websiteUrl={brandTokens.social.websiteUrl}
          instagramHandle={brandTokens.social.instagramHandle}
          theme={theme}
          fontFamily={fontFamily}
          slideLabel={`${totalSlides}/${totalSlides}`}
        />
      </div>
    </div>
  );
}
