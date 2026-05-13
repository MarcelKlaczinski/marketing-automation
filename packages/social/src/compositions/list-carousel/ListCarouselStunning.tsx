import React from "react";
import { loadFont } from "@remotion/google-fonts/SpaceGrotesk";
import { getThemeTokens } from "../../lib/theme.ts";
import { CoverSlideStunning } from "./CoverSlideStunning.tsx";
import { EndSlideStunning } from "./EndSlideStunning.tsx";
import { ToolSlideStunning } from "./ToolSlideStunning.tsx";
import type { ListCarouselInput } from "./types.ts";

const { fontFamily: spaceGroteskFamily } = loadFont();

type Props = ListCarouselInput;

export function ListCarouselStunning(props: Props) {
  const effectiveBrandTokens = {
    ...props.brandTokens,
    typography: { ...props.brandTokens.typography, fontFamily: spaceGroteskFamily },
  };
  const theme = getThemeTokens(effectiveBrandTokens, props.theme);
  const totalSlides = 1 + props.tools.length + 1;

  const { slideIndex } = props;
  const effectiveProps = { ...props, brandTokens: effectiveBrandTokens };

  if (slideIndex === 0) {
    return <CoverSlideStunning input={effectiveProps} theme={theme} totalSlides={totalSlides} />;
  }

  const toolIndex = slideIndex - 1;
  if (toolIndex < props.tools.length) {
    const tool = props.tools[toolIndex]!;
    return (
      <ToolSlideStunning
        input={effectiveProps}
        tool={tool}
        slideNumber={slideIndex + 1}
        totalSlides={totalSlides}
        theme={theme}
        themeMode={props.theme}
      />
    );
  }

  return <EndSlideStunning input={effectiveProps} theme={theme} totalSlides={totalSlides} />;
}
