import React from "react";
import { ToolTierRankingSlide } from "./ToolTierRankingSlide";
import type { ToolTierRankingInput } from "./types";
import "./loadFonts";

// Single-slide composition — no dispatcher needed. tool-tier-ranking renders
// exactly one still PNG per article. Mirrors `verdict-per-use-case` shape.
export const ToolTierRanking: React.FC<ToolTierRankingInput> = (props) => {
  return <ToolTierRankingSlide {...props} />;
};
