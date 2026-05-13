import React from "react";
import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import { getThemeTokens } from "../../lib/theme.ts";
import { CoverSlide } from "./CoverSlide.tsx";
import { EndSlide } from "./EndSlide.tsx";
import { ToolSlide } from "./ToolSlide.tsx";
import type { ListCarouselInput } from "./types.ts";

const { fontFamily: spaceGroteskFamily } = loadFont();

type Props = ListCarouselInput;

export function ListCarousel(props: Props) {
  const effectiveBrandTokens = {
    ...props.brandTokens,
    typography: { ...props.brandTokens.typography, fontFamily: spaceGroteskFamily },
  };
  const theme = getThemeTokens(effectiveBrandTokens, props.theme);
  const totalSlides = 1 + props.tools.length + 1; // cover + tools + end

  const { slideIndex } = props;
  const effectiveProps = { ...props, brandTokens: effectiveBrandTokens };

  if (slideIndex === 0) {
    return <CoverSlide input={effectiveProps} theme={theme} totalSlides={totalSlides} />;
  }

  const toolIndex = slideIndex - 1;
  if (toolIndex < props.tools.length) {
    const tool = props.tools[toolIndex]!;
    return (
      <ToolSlide
        input={effectiveProps}
        tool={tool}
        slideNumber={slideIndex + 1}
        totalSlides={totalSlides}
        theme={theme}
        themeMode={props.theme}
      />
    );
  }

  return <EndSlide input={effectiveProps} theme={theme} totalSlides={totalSlides} />;
}
