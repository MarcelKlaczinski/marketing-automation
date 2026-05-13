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

// Gradient mesh background — multi-layer radial for depth without overwhelming
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

// Tool logo floats — pattern-specific cluster in top-right corner
function LogoFloats({ tools, pattern }: {
  tools: ListCarouselInput["tools"];
  pattern: string;
}) {
  if (pattern === "superlative_question") {
    // 2 logos prominent with slight overlap
    const a = tools[0];
    const b = tools[1];
    if (!a || !b) return null;
    return (
      <div style={{ position: "absolute", top: 72, right: 72, display: "flex", gap: -20, alignItems: "center" }}>
        <div style={{ transform: "rotate(-6deg)", zIndex: 2 }}>
          <ToolIconImage
            {...(a.iconSvg !== undefined && { iconSvg: a.iconSvg })}
            {...(a.iconInitials !== undefined && { initials: a.iconInitials })}
            {...(a.iconHue !== undefined && { hue: a.iconHue })}
            size={120}
          />
        </div>
        <div style={{ transform: "rotate(5deg)", marginLeft: -24, zIndex: 1 }}>
          <ToolIconImage
            {...(b.iconSvg !== undefined && { iconSvg: b.iconSvg })}
            {...(b.iconInitials !== undefined && { initials: b.iconInitials })}
            {...(b.iconHue !== undefined && { hue: b.iconHue })}
            size={120}
          />
        </div>
      </div>
    );
  }

  if (pattern === "curiosity_gap") {
    const a = tools[0];
    if (!a) return null;
    return (
      <div style={{ position: "absolute", top: 72, right: 72, transform: "rotate(4deg)" }}>
        <ToolIconImage
          {...(a.iconSvg !== undefined && { iconSvg: a.iconSvg })}
          {...(a.iconInitials !== undefined && { initials: a.iconInitials })}
          {...(a.iconHue !== undefined && { hue: a.iconHue })}
          size={140}
        />
      </div>
    );
  }

  if (pattern === "number_promise" || pattern === "identity_frame") {
    // Cluster of 3-5 logos in varying sizes
    const cluster = tools.slice(0, Math.min(tools.length, 5));
    const sizes = [80, 100, 70, 90, 65];
    const rotations = [-8, 4, -3, 7, -5];
    const positions = [
      { top: 72, right: 180 },
      { top: 80, right: 72 },
      { top: 188, right: 100 },
      { top: 160, right: 210 },
      { top: 220, right: 72 },
    ];
    return (
      <div style={{ position: "absolute", top: 0, right: 0, width: 320, height: 320 }}>
        {cluster.map((tool, i) => {
          const pos = positions[i] ?? { top: 72 + i * 40, right: 72 };
          const size = sizes[i] ?? 80;
          const rot = rotations[i] ?? 0;
          return (
            <div
              key={tool.slug}
              style={{ position: "absolute", top: pos.top, right: pos.right, transform: `rotate(${rot}deg)` }}
            >
              <ToolIconImage
                {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
                {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
                {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
                size={size}
              />
            </div>
          );
        })}
      </div>
    );
  }

  // problem-recognition: 2-3 logos small, less prominent
  const small = tools.slice(0, 3);
  return (
    <div style={{ position: "absolute", top: 72, right: 72, display: "flex", flexDirection: "column", gap: 12 }}>
      {small.map((tool, i) => (
        <div key={tool.slug} style={{ transform: `rotate(${i % 2 === 0 ? 4 : -4}deg)` }}>
          <ToolIconImage
            {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
            {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
            {...(tool.iconHue !== undefined && { hue: tool.iconHue })}
            size={72}
          />
        </div>
      ))}
    </div>
  );
}

// Big background number decoration for Number-Promise pattern
function BigNumberDecoration({ n, brand, fontFamily }: { n: number; brand: string; fontFamily: string }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: -60,
        left: 40,
        fontSize: 520,
        fontWeight: 900,
        fontFamily,
        lineHeight: 1,
        color: `color-mix(in oklch, ${brand} 7%, transparent)`,
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      {n}
    </div>
  );
}

// Split the hook_trail to highlight the emphasis word
function renderTrailWithEmphasis(trail: string, emphasisWord: string, brand: string): React.ReactNode {
  if (!emphasisWord || !trail.toLowerCase().includes(emphasisWord.toLowerCase())) {
    return <span style={{ color: brand }}>{trail}</span>;
  }
  const idx = trail.toLowerCase().indexOf(emphasisWord.toLowerCase());
  const before = trail.slice(0, idx);
  const match = trail.slice(idx, idx + emphasisWord.length);
  const after = trail.slice(idx + emphasisWord.length);
  return (
    <span style={{ color: brand }}>
      {before}
      <span
        style={{
          color: brand,
          textDecoration: "underline",
          textDecorationColor: `color-mix(in oklch, ${brand} 70%, transparent)`,
          textDecorationThickness: 3,
          textUnderlineOffset: 8,
        }}
      >
        {match}
      </span>
      {after}
    </span>
  );
}

export function CoverSlideStunning({ input, theme, totalSlides }: Props) {
  const { cover, tools, brandTokens } = input;
  const { fontFamily, headingWeight, eyebrowLetterSpacing } = brandTokens.typography;
  const hook = cover.hookOutput;

  // Determine pattern for decoration
  const pattern = hook?.pattern ?? "number_promise";
  const toolCount = tools.length;

  return (
    <div
      style={{
        width: 1080,
        height: 1080,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        padding: 80,
        paddingBottom: 140,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <StunningBackground theme={theme} />

      {/* Big number decoration behind hook */}
      {(pattern === "number_promise" || pattern === "superlative_question") && (
        <BigNumberDecoration n={toolCount} brand={theme.brand} fontFamily={fontFamily} />
      )}

      {/* Logo floats (top-right) */}
      <LogoFloats tools={tools} pattern={pattern} />

      {/* Top: Eyebrow */}
      <div style={{ position: "relative" }}>
        <Eyebrow
          text={cover.eyebrow}
          theme={theme}
          fontFamily={fontFamily}
          letterSpacing={eyebrowLetterSpacing}
        />
      </div>

      {/* Center: Dramatic hook or editorial headline — fills remaining space */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          flex: 1,
          maxWidth: "68%", // leave room for logo floats
        }}
      >
        {hook ? (
          <>
            {/* Hook Lead — big, white */}
            <div
              style={{
                fontFamily,
                fontSize: 108,
                fontWeight: 900,
                lineHeight: 1.0,
                color: theme.ink,
                letterSpacing: "-0.03em",
                textWrap: "balance",
              } as React.CSSProperties}
            >
              {hook.leadPhrase}
            </div>

            {/* Hook Trail — brand color, slightly smaller */}
            <div
              style={{
                fontFamily,
                fontSize: 88,
                fontWeight: 900,
                lineHeight: 1.0,
                letterSpacing: "-0.02em",
                marginTop: 8,
              }}
            >
              {renderTrailWithEmphasis(hook.highlightWord, hook.trailPhrase, theme.brand)}
            </div>

            {/* Save-prompt hint when save_trigger_intensity === 'high' */}
            {hook.promiseBlock && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 32,
                  padding: "10px 20px",
                  background: `color-mix(in oklch, ${theme.accent} 12%, transparent)`,
                  border: `1.5px solid color-mix(in oklch, ${theme.accent} 30%, transparent)`,
                  borderRadius: 12,
                  alignSelf: "flex-start",
                }}
              >
                <span style={{ fontSize: 22 }}>🔖</span>
                <span style={{ fontFamily, fontSize: 20, fontWeight: 600, color: theme.accent }}>Speichern</span>
              </div>
            )}
          </>
        ) : (
          // Editorial fallback for stunning (shouldn't happen, but safe)
          <div
            style={{
              fontFamily,
              fontSize: 96,
              fontWeight: headingWeight,
              lineHeight: 1.05,
              color: theme.ink,
            }}
          >
            <span>{cover.headlineLead} </span>
            <span style={{ color: theme.brand }}>{cover.headlineHighlight}</span>
            {cover.headlineTrail && <span> {cover.headlineTrail}</span>}
          </div>
        )}

        {/* Subhead */}
        {cover.subhead && (
          <p
            style={{
              margin: "20px 0 0",
              fontFamily,
              fontSize: 26,
              color: theme.inkMuted,
              fontWeight: 400,
              letterSpacing: "0.01em",
            }}
          >
            {cover.subhead}
          </p>
        )}
      </div>

      {/* Footer: absolute so it never pushes content */}
      <div style={{ position: "absolute", bottom: 80, left: 80, right: 80 }}>
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
