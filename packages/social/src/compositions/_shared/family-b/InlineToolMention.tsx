/**
 * Spec 65.8 — Inline tool mention chip.
 *
 * Per Marcel-Decision §0: "Product-mention im narrative (logo + name in
 * text-flow)". Renders a compact pill with the tool's icon + name, intended
 * to be placed alongside narrative body text (chip-style, not a separate
 * slide).
 *
 * Icon resolution mirrors `ToolIconImage` (Spec 52a): inline SVG when
 * available, deterministic initials avatar otherwise.
 */
import type React from "react";
import { ToolIconImage } from "../../../shared/ToolIconImage.tsx";
import type { EmotionalDsTokens } from "./ds-tokens-emotional.ts";
import type { FamilyBToolMention } from "./types.ts";

interface InlineToolMentionProps {
  tool: FamilyBToolMention;
  tokens: EmotionalDsTokens;
  /** Size mode — `compact` for in-line text-flow, `prominent` for highlighted callouts. */
  size?: "compact" | "prominent";
}

export const InlineToolMention: React.FC<InlineToolMentionProps> = ({
  tool,
  tokens,
  size = "compact",
}) => {
  const iconSize = size === "compact" ? 36 : 56;
  const fontSize = size === "compact" ? 22 : 32;
  const paddingY = size === "compact" ? 8 : 12;
  const paddingX = size === "compact" ? 16 : 24;
  const gap = size === "compact" ? 10 : 14;

  // Use the tool's brand primary when available, otherwise the project's
  // accent stop — matches the existing Family-A `FamilyATool` brand-color
  // semantics from Spec 65.7.
  const bgColor = `color-mix(in oklch, ${tool.primaryColor ?? tokens.brand[500]} 12%, ${tokens.surface.raised})`;
  const borderColor = `color-mix(in oklch, ${tool.primaryColor ?? tokens.brand[500]} 25%, transparent)`;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        padding: `${paddingY}px ${paddingX}px`,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 999,
        color: tokens.ink.base,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: tokens.typography.bodyWeight,
        fontSize,
        lineHeight: 1.15,
      }}
    >
      <ToolIconImage
        {...(tool.iconSvg !== undefined && { iconSvg: tool.iconSvg })}
        {...(tool.iconInitials !== undefined && { initials: tool.iconInitials })}
        hue={tool.iconHue ?? 220}
        size={iconSize}
      />
      <span>{tool.name}</span>
    </span>
  );
};
