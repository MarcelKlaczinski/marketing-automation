import React from "react";
import type { DsTokens } from "../../../brand-tokens/derive";

interface VerdictLineProps {
  tokens: DsTokens;
  /** Verdict quote text. May contain <br> and <em>...</em> tags. */
  text: string;
}

function parseVerdictText(text: string, accentColor: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const brIdx = remaining.indexOf("<br>");
    const emStart = remaining.indexOf("<em>");

    if (brIdx === -1 && emStart === -1) {
      parts.push(remaining);
      break;
    }

    const nextBr = brIdx === -1 ? Infinity : brIdx;
    const nextEm = emStart === -1 ? Infinity : emStart;

    if (nextBr <= nextEm) {
      // <br> comes first
      if (brIdx > 0) parts.push(remaining.slice(0, brIdx));
      parts.push(<br key={key++} />);
      remaining = remaining.slice(brIdx + 4);
    } else {
      // <em> comes first
      if (emStart > 0) parts.push(remaining.slice(0, emStart));
      remaining = remaining.slice(emStart + 4);
      const emEnd = remaining.indexOf("</em>");
      if (emEnd === -1) {
        // Malformed — treat rest as plain text
        parts.push(remaining);
        break;
      }
      const emContent = remaining.slice(0, emEnd);
      parts.push(
        <em key={key++} style={{ fontStyle: "italic", color: accentColor }}>
          {emContent}
        </em>,
      );
      remaining = remaining.slice(emEnd + 5);
    }
  }

  return parts;
}

export const VerdictLine: React.FC<VerdictLineProps> = ({ tokens, text }) => (
  <div style={{ overflow: "hidden" }}>
    <div
      style={{
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontSize: 30,
        fontFamily: tokens.typography.fontFamily,
        fontWeight: 600,
        lineHeight: 1.35,
        color: tokens.ink.base,
      }}
    >
      {parseVerdictText(text, tokens.accent[500])}
    </div>
  </div>
);
