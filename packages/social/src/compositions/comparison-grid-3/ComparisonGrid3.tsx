import React from "react";
import { ComparisonGrid3Slide } from "./ComparisonGrid3Slide";
import type { ComparisonGrid3Input } from "./types";
import "./loadFonts";

// Single-slide composition — no dispatcher needed.
// comparison-grid-3 renders exactly one still PNG per article.
export const ComparisonGrid3: React.FC<ComparisonGrid3Input> = (props) => {
  return <ComparisonGrid3Slide {...props} />;
};
