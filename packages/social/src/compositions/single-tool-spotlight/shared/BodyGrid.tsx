import React from "react";
import type { DsTokens } from "../../../brand-tokens/derive";

interface BodyGridProps {
  tokens: DsTokens;
  strengths: string[];
  weaknesses: string[];
  locale: "de" | "en";
}

const CheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    style={{ flexShrink: 0, marginTop: 2 }}
  >
    <path
      d="M3 8l3.5 3.5L13 4.5"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CrossIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    style={{ flexShrink: 0, marginTop: 2 }}
  >
    <path
      d="M4 4l8 8M12 4l-8 8"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    />
  </svg>
);

interface ListCardProps {
  tokens: DsTokens;
  title: string;
  titleColor: string;
  icon: "check" | "cross";
  items: string[];
}

const ListCard: React.FC<ListCardProps> = ({ tokens, title, titleColor, icon, items }) => (
  <div
    style={{
      background: tokens.surface.raised,
      border: `1px solid ${tokens.border}`,
      borderRadius: 18,
      padding: "20px 22px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        fontSize: 13,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: 700,
        letterSpacing: "0.10em",
        textTransform: "uppercase" as const,
        color: titleColor,
        marginBottom: 14,
        flexShrink: 0,
      }}
    >
      {title}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, overflow: "hidden" }}>
      {items.map((item, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, index is stable
          key={i}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            opacity: Math.max(0.65, 1 - i * 0.12),
          }}
        >
          {icon === "check" ? (
            <CheckIcon color={tokens.semantic.success} />
          ) : (
            <CrossIcon color={tokens.semantic.danger} />
          )}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: 16,
                fontFamily: tokens.typography.fontFamily,
                fontWeight: 500,
                lineHeight: 1.35,
                color: tokens.ink.base,
              }}
            >
              {item}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const BodyGrid: React.FC<BodyGridProps> = ({ tokens, strengths, weaknesses, locale }) => {
  const strengthsLabel = locale === "de" ? "Stärken" : "Strengths";
  const weaknessesLabel = locale === "de" ? "Schwächen" : "Weaknesses";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 22,
        height: "100%",
      }}
    >
      <ListCard
        tokens={tokens}
        title={strengthsLabel}
        titleColor={tokens.semantic.success}
        icon="check"
        items={strengths}
      />
      <ListCard
        tokens={tokens}
        title={weaknessesLabel}
        titleColor={tokens.semantic.danger}
        icon="cross"
        items={weaknesses}
      />
    </div>
  );
};
