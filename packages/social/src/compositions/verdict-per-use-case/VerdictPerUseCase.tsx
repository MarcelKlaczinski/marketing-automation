import React from "react";
import { VerdictPerUseCaseSlide } from "./VerdictPerUseCaseSlide";
import type { VerdictPerUseCaseInput } from "./types";
import "./loadFonts";

// Single-slide composition — no dispatcher needed.
// verdict-per-use-case renders exactly one still PNG per article.
export const VerdictPerUseCase: React.FC<VerdictPerUseCaseInput> = (props) => {
  return <VerdictPerUseCaseSlide {...props} />;
};
