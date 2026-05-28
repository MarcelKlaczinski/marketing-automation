import React from "react";
import { AbsoluteFill } from "remotion";
import type { SingleToolSpotlightInput } from "./types.ts";
import "./loadFonts.ts"; // Side-effect: registers Inter Variable with Remotion
import { CoverSlide } from "./CoverSlide.tsx";
import { BodySlide } from "./BodySlide.tsx";
import { EndSlide } from "./EndSlide.tsx";

export function SingleToolSpotlight(props: SingleToolSpotlightInput) {
  const slides = computeSlideOrder(props);
  const slide = slides[props.slideIndex];

  if (slide === "cover" && props.cover) {
    return (
      <CoverSlide
        content={props.cover}
        theme={props.theme}
        locale={props.locale}
        slideIndex={props.slideIndex}
        slideTotal={props.slideTotal}
        {...(props.brandTokens !== undefined && { brandTokens: props.brandTokens })}
        {...(props.logoUrl !== undefined && { logoUrl: props.logoUrl })}
      />
    );
  }
  if (slide === "body" && props.body) {
    return (
      <BodySlide
        {...props.body}
        slideIndex={props.slideIndex}
        slideTotal={props.slideTotal}
        theme={props.theme}
        locale={props.locale}
        {...(props.brandTokens !== undefined && { brandTokens: props.brandTokens })}
      />
    );
  }
  if (slide === "end" && props.end) {
    return (
      <EndSlide
        content={props.end}
        theme={props.theme}
        locale={props.locale}
        {...(props.brandTokens !== undefined && { brandTokens: props.brandTokens })}
        {...(props.logoUrl !== undefined && { logoUrl: props.logoUrl })}
      />
    );
  }

  return <AbsoluteFill style={{ background: "#050507" }} />;
}

function computeSlideOrder(props: SingleToolSpotlightInput): Array<"cover" | "body" | "end"> {
  const order: Array<"cover" | "body" | "end"> = [];
  if (props.cover) order.push("cover");
  if (props.body) order.push("body");
  if (props.end) order.push("end");
  return order;
}
