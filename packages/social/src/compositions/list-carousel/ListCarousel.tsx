import React from "react";
import { getThemeTokens } from "../../lib/theme.ts";
import { CoverSlide } from "./CoverSlide.tsx";
import { EndSlide } from "./EndSlide.tsx";
import { ToolSlide } from "./ToolSlide.tsx";
import type { ListCarouselInput } from "./types.ts";

type Props = ListCarouselInput;

export function ListCarousel(props: Props) {
  const theme = getThemeTokens(props.brandTokens, props.theme);
  const totalSlides = 1 + props.tools.length + 1; // cover + tools + end

  const { slideIndex } = props;

  if (slideIndex === 0) {
    return <CoverSlide input={props} theme={theme} totalSlides={totalSlides} />;
  }

  const toolIndex = slideIndex - 1;
  if (toolIndex < props.tools.length) {
    const tool = props.tools[toolIndex]!;
    return (
      <ToolSlide
        input={props}
        tool={tool}
        slideNumber={slideIndex + 1}
        totalSlides={totalSlides}
        theme={theme}
      />
    );
  }

  return <EndSlide input={props} theme={theme} totalSlides={totalSlides} />;
}
