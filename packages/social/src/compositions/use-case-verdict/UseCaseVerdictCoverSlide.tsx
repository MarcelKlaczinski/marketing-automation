import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import type { UseCaseVerdictInput } from "./types.ts";

loadFont();

const FONT = "Space Grotesk, sans-serif";
const W = 1080;
const H = 1350;
const PAD_X = 80;
const PAD_Y = 100;
const FOOTER_BOTTOM = 72;

type Props = {
  input: UseCaseVerdictInput;
  totalSlides: number;
};

export function UseCaseVerdictCoverSlide({ input, totalSlides }: Props) {
  const theme = getThemeTokens(undefined, input.theme);
  const year = new Date().getFullYear();
  const eyebrowText =
    input.locale === "de"
      ? `TOOL-VERGLEICH · ${year}`
      : `TOOL COMPARISON · ${year}`;

  const toolNames = input.tools.map((t) => t.name).join(" vs. ");
  const subline =
    input.locale === "de"
      ? `${input.verdicts.length} Use-Cases im direkten Vergleich`
      : `${input.verdicts.length} use cases compared directly`;

  const promise1 =
    input.locale === "de"
      ? "Jeder Use-Case bekommt einen Gewinner."
      : "Every use case gets a winner.";
  const promise2 =
    input.locale === "de" ? "Keine Hype-Antworten." : "No hype answers.";

  return (
    <div
      style={{
        width: W,
        height: H,
        background: theme.bg,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: `${PAD_Y}px ${PAD_X}px`,
        paddingBottom: 140,
        boxSizing: "border-box",
      }}
    >
      {/* Gradient background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(ellipse 70% 70% at 85% 10%, color-mix(in oklch, ${theme.brand} 8%, transparent), transparent 60%),
            radial-gradient(ellipse 60% 60% at 10% 90%, color-mix(in oklch, ${theme.accent} 5%, transparent), transparent 55%)
          `,
        }}
      />

      {/* Tool icons top-right */}
      <div
        style={{
          position: "absolute",
          top: PAD_Y,
          right: PAD_X,
          display: "flex",
          gap: 16,
        }}
      >
        {input.tools.slice(0, 3).map((tool) => (
          <ToolIconImage
            key={tool.slug}
            {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
            initials={tool.iconInitials ?? tool.name.slice(0, 2).toUpperCase()}
            hue={tool.iconHue ?? 220}
            size={72}
          />
        ))}
      </div>

      {/* Big ghost number */}
      <div
        style={{
          position: "absolute",
          left: 20,
          top: 240,
          fontFamily: FONT,
          fontSize: 560,
          fontWeight: 900,
          color: theme.ink,
          opacity: input.theme === "dark" ? 0.07 : 0.04,
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        {input.verdicts.length}
      </div>

      {/* Content (stacks vertically, fills space above footer) */}
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", gap: 0 }}>
        <Eyebrow
          text={eyebrowText}
          theme={theme}
          fontFamily={FONT}
          letterSpacing="0.08em"
        />

        {/* Hook headline */}
        <div style={{ marginTop: 56 }}>
          <div style={{ fontFamily: FONT, fontSize: 96, fontWeight: 800, lineHeight: 1.05, color: theme.ink }}>
            {input.locale === "de" ? "So wählst du" : "How to choose"}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 96, fontWeight: 800, lineHeight: 1.05 }}>
            <span style={{ color: theme.ink }}>das </span>
            <span style={{ color: theme.brand, fontWeight: 900 }}>
              {input.locale === "de" ? "richtige" : "right"}
            </span>
          </div>
          <div style={{ fontFamily: FONT, fontSize: 96, fontWeight: 800, lineHeight: 1.05, color: theme.ink }}>
            {input.locale === "de" ? "Tool" : "tool"}
          </div>
        </div>

        {/* Tool names + subline */}
        <div style={{ marginTop: 40, fontFamily: FONT, fontSize: 28, color: theme.inkMuted, fontWeight: 400 }}>
          {toolNames}
        </div>
        <div style={{ marginTop: 8, fontFamily: FONT, fontSize: 28, color: theme.inkMuted, fontWeight: 400 }}>
          {subline}
        </div>

        {/* Promise block */}
        <div style={{ marginTop: 64, display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div
            style={{
              width: 8,
              minHeight: 80,
              background: theme.brand,
              borderRadius: 4,
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 700, color: theme.ink }}>
              {promise1}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 32, fontWeight: 700, color: theme.inkMuted }}>
              {promise2}
            </div>
          </div>
        </div>

        {/* Use-case preview grid */}
        <div style={{ marginTop: 72 }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 22,
              fontWeight: 600,
              color: theme.inkMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
              marginBottom: 24,
            }}
          >
            {input.locale === "de" ? "Was dich erwartet" : "What's inside"}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            {input.verdicts.map((v, i) => (
              <div
                key={v.useCase}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  background: input.theme === "dark"
                    ? "oklch(22% 0.025 250)"
                    : "oklch(94% 0.01 250)",
                  borderRadius: 12,
                  padding: "14px 18px",
                }}
              >
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: 18,
                    fontWeight: 700,
                    color: theme.brand,
                    minWidth: 28,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: 20,
                    fontWeight: 500,
                    color: theme.ink,
                    lineHeight: 1.3,
                  }}
                >
                  {v.useCase}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: "absolute", bottom: FOOTER_BOTTOM, left: PAD_X, right: PAD_X }}>
        <BrandFooter
          websiteUrl={input.websiteUrl}
          instagramHandle={input.instagramHandle}
          theme={theme}
          fontFamily={FONT}
          slideLabel={`1/${totalSlides}`}
        />
      </div>
    </div>
  );
}
