import React from "react";
import { ProConVerdictSlide } from "./ProConVerdictSlide";
import type { ProConVerdictInput } from "./types";
import "./loadFonts";

// Single-slide composition — no dispatcher needed.
// pro-con-verdict renders exactly one still PNG per article.
export function ProConVerdictComposition(props: ProConVerdictInput) {
  return <ProConVerdictSlide {...props} />;
}
