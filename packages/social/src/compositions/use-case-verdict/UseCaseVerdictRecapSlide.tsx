import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import React from "react";
import { BrandFooter } from "../../shared/BrandLogo.tsx";
import { Eyebrow } from "../../shared/Eyebrow.tsx";
import { ToolIconImage } from "../../shared/ToolIconImage.tsx";
import { getThemeTokens } from "../../lib/theme.ts";
import type { TallyEntry, UseCaseVerdictInput, UseCaseVerdictItem } from "./types.ts";

loadFont();

const FONT = "Space Grotesk, sans-serif";
const W = 1080;
const H = 1350;
const PAD_X = 80;
const PAD_Y = 100;
const FOOTER_BOTTOM = 72;
const BAR_MAX_WIDTH = 660;

function computeTally(verdicts: UseCaseVerdictItem[]): TallyEntry[] {
  const counts = new Map<string, number>();
  for (const v of verdicts) {
    counts.set(v.winner, (counts.get(v.winner) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([slug, count]) => ({ slug, count }));
}

type Props = {
  input: UseCaseVerdictInput;
  slideIndex: number;
  totalSlides: number;
};

export function UseCaseVerdictRecapSlide({ input, slideIndex, totalSlides }: Props) {
  const theme = getThemeTokens(undefined, input.theme);
  const tally = computeTally(input.verdicts);
  const maxCount = Math.max(...tally.map((e) => e.count), 1);
  const overall = tally[0];
  const overallTool = input.tools.find((t) => t.slug === overall?.slug);
  const runnerUp = tally[1];
  const runnerUpTool = input.tools.find((t) => t.slug === runnerUp?.slug);

  const eyebrowText = input.locale === "de" ? "GESAMT-ERGEBNIS" : "OVERALL RESULT";

  const summaryText =
    input.locale === "de"
      ? overallTool && runnerUpTool
        ? `${overallTool.name} gewinnt beim breiteren Spektrum — ${runnerUpTool.name} punktet in spezialisierten Use-Cases.`
        : `${overallTool?.name ?? "Sieger"} überzeugt in der Gesamtwertung.`
      : overallTool && runnerUpTool
        ? `${overallTool.name} wins across the wider spectrum — ${runnerUpTool.name} excels in specialised use cases.`
        : `${overallTool?.name ?? "Winner"} takes the overall result.`;

  const winsLabel = (n: number) =>
    input.locale === "de" ? `${n}× Gewinner` : `${n}× winner`;

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
      {/* Aurora gradient bottom */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 80% 50% at 50% 110%, color-mix(in oklch, ${theme.brand} 12%, transparent), transparent 60%)`,
        }}
      />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <Eyebrow
          text={eyebrowText}
          theme={theme}
          fontFamily={FONT}
          letterSpacing="0.08em"
        />

        <div
          style={{
            marginTop: 48,
            fontFamily: FONT,
            fontSize: 56,
            fontWeight: 800,
            color: theme.ink,
          }}
        >
          {input.locale === "de" ? "Wer gewinnt?" : "Who wins?"}
        </div>

        {/* Tally bars */}
        <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 28 }}>
          {tally.map((entry) => {
            const tool = input.tools.find((t) => t.slug === entry.slug);
            const barWidth = Math.round((entry.count / maxCount) * BAR_MAX_WIDTH);
            const isWinner = entry.slug === tally[0]?.slug;

            return (
              <div
                key={entry.slug}
                style={{ display: "flex", alignItems: "center", gap: 20 }}
              >
                <ToolIconImage
                  {...(tool?.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
                  initials={tool?.iconInitials ?? (tool?.name.slice(0, 2).toUpperCase() ?? "??")}
                  hue={tool?.iconHue ?? 220}
                  size={56}
                />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      maxWidth: BAR_MAX_WIDTH + 180,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: FONT,
                        fontSize: 28,
                        fontWeight: isWinner ? 700 : 500,
                        color: isWinner ? theme.ink : theme.inkMuted,
                      }}
                    >
                      {tool?.name ?? entry.slug}
                    </span>
                    <span
                      style={{
                        fontFamily: FONT,
                        fontSize: 24,
                        fontWeight: 600,
                        color: isWinner ? theme.brand : theme.inkMuted,
                        marginLeft: 16,
                      }}
                    >
                      {winsLabel(entry.count)}
                    </span>
                  </div>
                  {/* Bar */}
                  <div
                    style={{
                      height: 12,
                      width: BAR_MAX_WIDTH,
                      background: input.theme === "dark"
                        ? "oklch(30% 0.02 250)"
                        : "oklch(90% 0.01 250)",
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: barWidth,
                        background: isWinner ? theme.brand : theme.accent,
                        borderRadius: 6,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary sentence */}
        <div
          style={{
            marginTop: 56,
            fontFamily: FONT,
            fontSize: 26,
            fontWeight: 400,
            lineHeight: 1.6,
            color: theme.inkMuted,
            maxWidth: 860,
          }}
        >
          {summaryText}
        </div>

        {/* Verdict breakdown grid */}
        <div style={{ marginTop: 56 }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 20,
              fontWeight: 600,
              color: theme.inkMuted,
              letterSpacing: "0.06em",
              textTransform: "uppercase" as const,
              marginBottom: 20,
            }}
          >
            {input.locale === "de" ? "Alle Verdicts" : "All verdicts"}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {input.verdicts.map((v) => {
              const winnerTool = input.tools.find((t) => t.slug === v.winner);
              return (
                <div
                  key={v.useCase}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: input.theme === "dark"
                      ? "oklch(22% 0.025 250)"
                      : "oklch(94% 0.01 250)",
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  <ToolIconImage
                    {...(winnerTool?.iconSvg !== undefined && { iconSvg: winnerTool.iconSvg })}
                    initials={winnerTool?.iconInitials ?? (v.winner.slice(0, 2).toUpperCase())}
                    hue={winnerTool?.iconHue ?? 220}
                    size={32}
                  />
                  <span
                    style={{
                      fontFamily: FONT,
                      fontSize: 19,
                      fontWeight: 500,
                      color: theme.ink,
                      lineHeight: 1.3,
                    }}
                  >
                    {v.useCase}
                  </span>
                </div>
              );
            })}
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
          slideLabel={`${slideIndex + 1}/${totalSlides}`}
        />
      </div>
    </div>
  );
}
