/**
 * Spec 65.15 — DsBrandStamp tests.
 *
 * Pure structural tests — invoke the FC directly and inspect the returned
 * React element. No Remotion/React-DOM render needed.
 */
import { describe, expect, it } from "bun:test";
import type React from "react";
import { Img } from "remotion";
import { DsBrandStamp } from "../../../src/compositions/_shared/DsBrandStamp";

describe("DsBrandStamp", () => {
  it("renders the wrapper + Img when logoUrl is a URL", () => {
    const element = DsBrandStamp({
      logoUrl: "https://pub.toolwiki.ai/toolwiki/logos/main-dark.svg",
    }) as React.ReactElement<{
      style: React.CSSProperties;
      children: React.ReactElement;
    }> | null;

    expect(element).not.toBeNull();
    expect(element?.type).toBe("div");
    expect(element?.props.style.position).toBe("absolute");
    expect(element?.props.style.opacity).toBe(0.7);
    expect(element?.props.style.bottom).toBe(48);
    expect(element?.props.style.right).toBe(48);
    expect(element?.props.style.zIndex).toBe(100);
    expect(element?.props.style.pointerEvents).toBe("none");

    const img = element?.props.children as React.ReactElement<{
      src: string;
      style: React.CSSProperties;
    }>;
    expect(img.type).toBe(Img);
    expect(img.props.src).toBe("https://pub.toolwiki.ai/toolwiki/logos/main-dark.svg");
    expect(img.props.style.maxWidth).toBe(120);
    expect(img.props.style.height).toBe("auto");
  });

  it("renders nothing when logoUrl is null (graceful-null per spec §3.2)", () => {
    const element = DsBrandStamp({ logoUrl: null });
    expect(element).toBeNull();
  });

  it("renders nothing when logoUrl is undefined", () => {
    const element = DsBrandStamp({});
    expect(element).toBeNull();
  });

  it("renders nothing when logoUrl is empty string", () => {
    const element = DsBrandStamp({ logoUrl: "" });
    expect(element).toBeNull();
  });

  it("accepts data: URLs (inline SVG path)", () => {
    const dataUrl =
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIC8+";
    const element = DsBrandStamp({ logoUrl: dataUrl }) as React.ReactElement<{
      children: React.ReactElement<{ src: string }>;
    }> | null;

    expect(element).not.toBeNull();
    expect(element?.props.children.props.src).toBe(dataUrl);
  });

  it("respects custom margin / opacity / maxWidth overrides", () => {
    const element = DsBrandStamp({
      logoUrl: "https://example.com/logo.png",
      marginPx: 72,
      opacity: 0.5,
      maxWidthPx: 200,
    }) as React.ReactElement<{
      style: React.CSSProperties;
      children: React.ReactElement<{ style: React.CSSProperties }>;
    }> | null;

    expect(element?.props.style.bottom).toBe(72);
    expect(element?.props.style.right).toBe(72);
    expect(element?.props.style.opacity).toBe(0.5);
    expect(element?.props.children.props.style.maxWidth).toBe(200);
  });
});
