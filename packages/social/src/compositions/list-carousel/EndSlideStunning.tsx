import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import type { ThemeTokens } from "../../lib/theme.ts";
import type { CloserLine, EndCloser, ListCarouselInput } from "./types.ts";

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

// Tool recap — per-tool row with icon + name + endSlideToken so the slide
// gives a concrete "Recraft → Logos. Ideogram → Poster." takeaway.
function ToolRecapGrid({ tools, recap, theme, fontFamily, themeMode }: {
  tools: ListCarouselInput["tools"];
  recap: string[] | undefined;
  theme: ThemeTokens;
  fontFamily: string;
  themeMode: "dark" | "light";
}) {
  const slugs = recap ?? tools.map((t) => t.slug);
  const displayTools = tools.filter((t) => slugs.includes(t.slug)).slice(0, 6);
  if (displayTools.length === 0) return null;
  const cardBg = themeMode === "dark" ? "#1a2540" : "#0a1428";
  // Two columns when we have more than 3 tools, else one wider column.
  const twoColumn = displayTools.length > 3;

  return (
    <div
      style={{
        padding: "24px 28px",
        background: `color-mix(in oklch, ${theme.inkMuted} 8%, transparent)`,
        borderRadius: 18,
        border: `1px solid color-mix(in oklch, ${theme.inkMuted} 15%, transparent)`,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <span
        style={{
          fontFamily,
          fontSize: 16,
          fontWeight: 700,
          color: theme.inkMuted,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
        }}
      >
        Tools im Detail
      </span>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: twoColumn ? "1fr 1fr" : "1fr",
          rowGap: 14,
          columnGap: 20,
        }}
      >
        {displayTools.map((tool) => (
          <div key={tool.slug} style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: cardBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 6,
                boxSizing: "border-box",
                flexShrink: 0,
              }}
            >
              <ToolIconImage
                {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
                {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
                {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
                size={32}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
              <span style={{ fontFamily, fontSize: 22, fontWeight: 800, color: theme.ink }}>
                {tool.name}
              </span>
              {tool.endSlideToken && (
                <span style={{ fontFamily, fontSize: 16, fontWeight: 500, color: theme.inkMuted }}>
                  für {tool.endSlideToken}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Spec 51a-stunning-v2.1 §1.2 — color-only highlight, no underline,
// each line rendered as three independent <span>s so concatenation is impossible.
function CloserHeadlineRenderer({
  closer,
  theme,
  fontFamily,
  headingWeight,
}: {
  closer: EndCloser;
  theme: ThemeTokens;
  fontFamily: string;
  headingWeight: number;
}) {
  const renderLine = (line: CloserLine, key: string) => (
    <div key={key}>
      {line.leadText && <span style={{ color: theme.ink }}>{line.leadText}</span>}
      {line.leadText && line.highlightText && " "}
      {line.highlightText && (
        <span style={{ color: theme.brand, fontWeight: 900 }}>{line.highlightText}</span>
      )}
      {line.trailText && <span style={{ color: theme.ink }}>{line.trailText}</span>}
    </div>
  );

  return (
    <div
      style={{
        fontFamily,
        fontSize: 64,
        lineHeight: 1.15,
        fontWeight: headingWeight,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {renderLine(closer.line1, "l1")}
      {renderLine(closer.line2, "l2")}
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
        height: 1350,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        padding: 72,
        paddingBottom: 140,
        boxSizing: "border-box",
      }}
    >
      <StunningEndBackground theme={theme} />

      {/* Top: Eyebrow */}
      <div style={{ position: "relative", marginBottom: 48 }}>
        <Eyebrow
          text="ZUR VERTIEFUNG"
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Center: Closer headline + action blocks — fills remaining space */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 36, flex: 1 }}>
        {/* Closer headline — deterministic, structured (Spec 51a-stunning-v2.1 §1.2) */}
        {closer ? (
          <CloserHeadlineRenderer
            closer={closer}
            theme={theme}
            fontFamily={fontFamily}
            headingWeight={headingWeight}
          />
        ) : (
          <div
            style={{
              fontFamily,
              fontSize: 72,
              fontWeight: headingWeight,
              lineHeight: 1.1,
              color: theme.ink,
            }}
          >
            <span>{end.headline} </span>
            <span style={{ color: theme.brand }}>{end.headlineHighlight}</span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Save-action block — primary algo signal */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "30px 32px",
              background: `color-mix(in oklch, ${theme.brand} 12%, transparent)`,
              borderRadius: 20,
              border: `1.5px solid color-mix(in oklch, ${theme.brand} 35%, transparent)`,
            }}
          >
            <span style={{ fontSize: 44 }}>📌</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontFamily,
                  fontSize: 20,
                  fontWeight: 700,
                  color: theme.inkMuted,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                }}
              >
                Speichere diesen Post
              </span>
              <span style={{ fontFamily, fontSize: 32, fontWeight: 800, color: theme.brand, lineHeight: 1.15 }}>
                als Cheat-Sheet für deinen Workflow
              </span>
            </div>
          </div>

          {/* Follow CTA */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "30px 32px",
              background: `color-mix(in oklch, ${theme.accent} 12%, transparent)`,
              borderRadius: 20,
              border: `1.5px solid color-mix(in oklch, ${theme.accent} 35%, transparent)`,
            }}
          >
            <span style={{ fontSize: 44 }}>📱</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontFamily,
                  fontSize: 20,
                  fontWeight: 700,
                  color: theme.inkMuted,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                }}
              >
                Mehr ehrliche Vergleiche
              </span>
              <span style={{ fontFamily, fontSize: 32, fontWeight: 800, color: theme.accent, lineHeight: 1.15 }}>
                {brandTokens.social.instagramHandle}
              </span>
            </div>
          </div>

          {/* Article link */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              padding: "26px 32px",
              background: `color-mix(in oklch, ${theme.inkMuted} 8%, transparent)`,
              borderRadius: 20,
              border: `1.5px solid color-mix(in oklch, ${theme.inkMuted} 20%, transparent)`,
            }}
          >
            <span style={{ fontSize: 40 }}>🌐</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontFamily,
                  fontSize: 18,
                  fontWeight: 700,
                  color: theme.inkMuted,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase" as const,
                }}
              >
                Vollständiger Artikel
              </span>
              <span
                style={{
                  fontFamily,
                  fontSize: 26,
                  fontWeight: 700,
                  color: theme.ink,
                  wordBreak: "break-all",
                  lineHeight: 1.15,
                }}
              >
                {end.articleUrl.replace(/^https?:\/\//, "")}
              </span>
            </div>
          </div>
        </div>

        {/* Tool recap — per-tool with endSlideToken */}
        <ToolRecapGrid
          tools={tools}
          recap={end.toolRecap}
          theme={theme}
          fontFamily={fontFamily}
          themeMode={input.theme}
        />
      </div>

      {/* Footer: absolute so it never pushes content */}
      <div style={{ position: "absolute", bottom: 72, left: 72, right: 72 }}>
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
