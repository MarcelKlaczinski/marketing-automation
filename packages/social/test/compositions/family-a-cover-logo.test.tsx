/**
 * Spec 65.17 A1+A2+A3 — Family-A CoverSlide logo-hero treatment tests.
 *
 * Pure structural tests. The inline subcomponents are exported solely for this
 * test surface (per `packages/social/src/compositions/CLAUDE.md` they stay
 * file-private to slide consumers; the named exports are for test injection
 * only). No Remotion/React-DOM rendering — invoke the FC and walk the returned
 * React element tree, mirroring the `ds-brand-stamp.test.tsx` pattern.
 */
import { describe, expect, it } from "bun:test";
import type React from "react";
import {
  LogoTile,
  ToolLogoFaceoff,
  ToolLogoRow,
  logoTileSizeFor,
} from "../../src/compositions/comparison-grid-3/slides/CoverSlide";
import type { DsTokens } from "../../src/brand-tokens/derive";
import type { FamilyATool } from "../../src/compositions/_shared/family-a/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fakeTokens = {
  ink: { base: "#0b0d12", muted: "#6b7282" },
  brand: { 300: "oklch(0.78 0.13 250)" },
  surface: { base: "#ffffff", raised: "#f4f5f7" },
  accent: { 500: "oklch(0.55 0.2 250)" },
  typography: {
    fontFamily: "Inter Variable",
    fontFamilyMono: "JetBrains Mono",
    headingWeight: 800,
  },
} as unknown as DsTokens;

function tool(slug: string, opts: Partial<FamilyATool> = {}): FamilyATool {
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    score: 80,
    scoreTier: "hi",
    meta: "Test category · solid",
    pricePrefix: "Ab",
    priceAmount: "10 $/Mo",
    pros: ["Pro one", "Pro two"] as [string, string],
    cons: ["Con one", "Con two"] as [string, string],
    isWinner: false,
    ...opts,
  };
}

const SVG_FIXTURE = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>';

// ─── logoTileSizeFor (pure helper) ───────────────────────────────────────────

describe("logoTileSizeFor", () => {
  it("returns 280px tiles for 2-tool faceoff bucket", () => {
    expect(logoTileSizeFor(2)).toEqual({ tile: 280, gap: 56, radius: 56 });
  });

  it("returns 232px tiles for 3-tool grid", () => {
    expect(logoTileSizeFor(3)).toEqual({ tile: 232, gap: 40, radius: 48 });
  });

  it("returns 188px tiles for 4-tool grid", () => {
    expect(logoTileSizeFor(4)).toEqual({ tile: 188, gap: 32, radius: 40 });
  });

  it("returns 160px tiles for 5-tool grid", () => {
    expect(logoTileSizeFor(5)).toEqual({ tile: 160, gap: 22, radius: 36 });
  });

  it("clamps to 160px tiles for 6+ tools (falls through to smallest bucket)", () => {
    expect(logoTileSizeFor(6)).toEqual({ tile: 160, gap: 22, radius: 36 });
    expect(logoTileSizeFor(10)).toEqual({ tile: 160, gap: 22, radius: 36 });
  });

  it("treats single-tool count as the faceoff bucket (head-to-head fallback)", () => {
    expect(logoTileSizeFor(1)).toEqual({ tile: 280, gap: 56, radius: 56 });
  });
});

// ─── LogoTile (graceful-null fallback per Spec 65.15) ────────────────────────

describe("LogoTile", () => {
  it("renders inline-SVG via dangerouslySetInnerHTML when iconSvg is present", () => {
    const element = LogoTile({
      tokens: fakeTokens,
      tool: tool("recraft", { iconSvg: SVG_FIXTURE, primaryColor: "#ff6b00" }),
      size: 160,
      radius: 36,
    }) as React.ReactElement<{
      style: React.CSSProperties;
      children: React.ReactElement<{ dangerouslySetInnerHTML?: { __html: string } }>;
    }>;

    expect(element.type).toBe("div");
    expect(element.props.style.background).toBe("#ff6b00");
    expect(element.props.style.width).toBe(160);
    expect(element.props.style.height).toBe(160);
    expect(element.props.style.borderRadius).toBe(36);

    const inner = element.props.children;
    expect(inner.type).toBe("div");
    expect(inner.props.dangerouslySetInnerHTML?.__html).toBe(SVG_FIXTURE);
  });

  it("falls back to initials text when iconSvg is missing (graceful-null)", () => {
    const element = LogoTile({
      tokens: fakeTokens,
      tool: tool("midjourney", { iconInitials: "MJ", primaryColor: "#7c3aed" }),
      size: 200,
      radius: 48,
    }) as React.ReactElement<{
      style: React.CSSProperties;
      children: React.ReactElement<{ children: string }>;
    }>;

    expect(element.type).toBe("div");
    expect(element.props.style.background).toBe("#7c3aed");

    const inner = element.props.children;
    expect(inner.type).toBe("span");
    expect(inner.props.children).toBe("MJ");
  });

  it("derives initials from tool name when iconInitials is unset", () => {
    const element = LogoTile({
      tokens: fakeTokens,
      tool: tool("gemini", {}),
      size: 160,
      radius: 36,
    }) as React.ReactElement<{
      children: React.ReactElement<{ children: string }>;
    }>;
    // tool() capitalises slug → "Gemini" → first 2 chars "GE"
    expect(element.props.children.props.children).toBe("GE");
  });

  it("falls back to surface.raised backdrop when primaryColor is unset", () => {
    const element = LogoTile({
      tokens: fakeTokens,
      tool: tool("noname", {}),
      size: 160,
      radius: 36,
    }) as React.ReactElement<{
      style: React.CSSProperties;
    }>;
    expect(element.props.style.background).toBe("#f4f5f7");
  });

  it("scales initials font-size proportionally to tile size (36% of size)", () => {
    const small = LogoTile({
      tokens: fakeTokens,
      tool: tool("a", {}),
      size: 160,
      radius: 36,
    }) as React.ReactElement<{
      children: React.ReactElement<{ style: React.CSSProperties }>;
    }>;
    const big = LogoTile({
      tokens: fakeTokens,
      tool: tool("a", {}),
      size: 320,
      radius: 64,
    }) as React.ReactElement<{
      children: React.ReactElement<{ style: React.CSSProperties }>;
    }>;
    expect(small.props.children.props.style.fontSize).toBe(58); // round(160 * 0.36)
    expect(big.props.children.props.style.fontSize).toBe(115); // round(320 * 0.36)
  });
});

// ─── ToolLogoRow (3-N tools) ────────────────────────────────────────────────

describe("ToolLogoRow", () => {
  it("renders one LogoTile per tool plus the caption label", () => {
    const tools = [
      tool("a", { iconSvg: SVG_FIXTURE }),
      tool("b", { iconSvg: SVG_FIXTURE }),
      tool("c", { iconSvg: SVG_FIXTURE }),
    ];
    const element = ToolLogoRow({
      tokens: fakeTokens,
      tools,
      caption: "3 tools compared",
    }) as React.ReactElement<{
      children: [
        React.ReactElement<{ children: React.ReactElement[] }>,
        React.ReactElement<{ children: string }>,
      ];
    }>;

    const [logoCluster, caption] = element.props.children;
    expect(logoCluster.props.children).toHaveLength(3);
    expect(caption.props.children).toBe("3 tools compared");
  });

  it("uses the size bucket for the tool count (3 → 232px)", () => {
    const element = ToolLogoRow({
      tokens: fakeTokens,
      tools: [tool("a"), tool("b"), tool("c")],
      caption: "x",
    }) as React.ReactElement<{
      children: [
        React.ReactElement<{ style: React.CSSProperties; children: React.ReactElement[] }>,
        React.ReactElement,
      ];
    }>;
    const [logoCluster] = element.props.children;
    expect(logoCluster.props.style.gap).toBe(40);
    // Each child tile carries the computed size in its style
    const firstTile = logoCluster.props.children[0] as React.ReactElement<{
      props: { size: number };
    }>;
    // LogoTile is invoked as JSX so size is on the props of the React element
    expect((firstTile as unknown as { props: { size: number } }).props.size).toBe(232);
  });
});

// ─── ToolLogoFaceoff (2-tool head-to-head VS) ───────────────────────────────

describe("ToolLogoFaceoff", () => {
  it("renders left-side + VS glyph + right-side with the correct versus label", () => {
    const tools = [
      tool("claude", { iconSvg: SVG_FIXTURE, primaryColor: "#d97757" }),
      tool("chatgpt", { iconSvg: SVG_FIXTURE, primaryColor: "#10a37f" }),
    ];
    const element = ToolLogoFaceoff({
      tokens: fakeTokens,
      tools,
      versusLabel: "vs.",
    }) as React.ReactElement<{
      children: [React.ReactElement, React.ReactElement, React.ReactElement];
    }>;

    expect(element).not.toBeNull();
    const [left, vsBlock, right] = element.props.children;
    expect(left).toBeDefined();
    expect(right).toBeDefined();

    // Middle VS block — drill into the span carrying the versus label
    const vsSpan = (
      vsBlock as React.ReactElement<{
        children: React.ReactElement<{ children: string }>;
      }>
    ).props.children;
    expect(vsSpan.props.children).toBe("vs.");
  });

  it("returns null when fewer than 2 tools are passed (defensive)", () => {
    const element = ToolLogoFaceoff({
      tokens: fakeTokens,
      tools: [tool("solo")],
      versusLabel: "vs.",
    });
    expect(element).toBeNull();
  });

  it("returns null when given an empty tools array", () => {
    const element = ToolLogoFaceoff({
      tokens: fakeTokens,
      tools: [],
      versusLabel: "vs.",
    });
    expect(element).toBeNull();
  });
});
