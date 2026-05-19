import React from "react";
import { AbsoluteFill } from "remotion";
import type { SingleToolSpotlightInput } from "./types.ts";

// Sessions 4-5 (Spec 60.1): Replace with CoverSlide, BodySlide, EndSlide implementations.
// Session 2: Inter Variable font will be loaded here via loadFonts.ts.
// This stub compiles cleanly with the new schema and renders a placeholder.

export function SingleToolSpotlight(props: SingleToolSpotlightInput) {
  const slides = computeSlideOrder(props);
  const slide = slides[props.slideIndex];

  if (slide === "cover" && props.cover) {
    // TODO(Session 5): return <CoverSlide content={props.cover} {...sharedProps(props)} />;
    return <AbsoluteFill style={{ background: "#050507" }} />;
  }
  if (slide === "body" && props.body) {
    // TODO(Session 4): return <BodySlide content={props.body} {...sharedProps(props)} />;
    return <AbsoluteFill style={{ background: "#050507" }} />;
  }
  if (slide === "end" && props.end) {
    // TODO(Session 5): return <EndSlide content={props.end} {...sharedProps(props)} />;
    return <AbsoluteFill style={{ background: "#050507" }} />;
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
