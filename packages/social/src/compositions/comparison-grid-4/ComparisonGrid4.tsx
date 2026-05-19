import React from "react";
import { ComparisonGrid4Slide } from "./ComparisonGrid4Slide";
import type { ComparisonGrid4Input } from "./types";
import "./loadFonts";

// Single-slide composition — no dispatcher needed.
// comparison-grid-4 renders exactly one still PNG per article.
export const ComparisonGrid4: React.FC<ComparisonGrid4Input> = (props) => {
  return <ComparisonGrid4Slide {...props} />;
};
