/**
 * Spec 65.16 — unit tests for image-style preset + provider resolution.
 *
 * Pure-function tests (no DB) covering the 3-tier preset cascade and the
 * 2-tier provider cascade.
 */
import { describe, expect, it } from "bun:test";
import {
  isImageProvider,
  resolveImageProvider,
  resolveImageStylePreset,
} from "../../../src/lib/recurring-content/resolve-image-style-preset.ts";

describe("resolveImageStylePreset (3-tier cascade)", () => {
  it("content-level choice wins over definition + project", () => {
    const result = resolveImageStylePreset({
      projectDefault: "dark-neon-grid",
      definitionOverride: "light-editorial",
      contentLevelChoice: "blue-tech-gradient",
    });
    expect(result).toBe("blue-tech-gradient");
  });

  it("definition override wins when no content-level choice", () => {
    const result = resolveImageStylePreset({
      projectDefault: "dark-neon-grid",
      definitionOverride: "light-editorial",
      contentLevelChoice: null,
    });
    expect(result).toBe("light-editorial");
  });

  it("falls back to project default when no override + no content-level", () => {
    const result = resolveImageStylePreset({
      projectDefault: "light-editorial",
      definitionOverride: null,
      contentLevelChoice: null,
    });
    expect(result).toBe("light-editorial");
  });

  it("undefined contentLevelChoice is treated as 'no choice'", () => {
    const result = resolveImageStylePreset({
      projectDefault: "dark-neon-grid",
      definitionOverride: "blue-tech-gradient",
      // contentLevelChoice omitted entirely
    });
    expect(result).toBe("blue-tech-gradient");
  });

  it("invalid content-level choice falls through to definition", () => {
    const result = resolveImageStylePreset({
      projectDefault: "dark-neon-grid",
      definitionOverride: "blue-tech-gradient",
      contentLevelChoice: "garbage" as never,
    });
    expect(result).toBe("blue-tech-gradient");
  });

  it("invalid definition override + invalid content-level fall through to project default", () => {
    const result = resolveImageStylePreset({
      projectDefault: "dark-neon-grid",
      definitionOverride: "garbage" as never,
      contentLevelChoice: "more-garbage" as never,
    });
    expect(result).toBe("dark-neon-grid");
  });
});

describe("resolveImageProvider (2-tier cascade)", () => {
  it("content-level choice wins over content-type default", () => {
    const result = resolveImageProvider({
      templateKey: "story-arc-clickbait",
      contentLevelChoice: "photographic",
    });
    expect(result).toBe("photographic");
  });

  it("story-arc default routes to nano-banana-2", () => {
    expect(resolveImageProvider({ templateKey: "story-arc-clickbait" })).toBe(
      "nano-banana-2",
    );
  });

  it("opinion-recommendation default routes to nano-banana-2", () => {
    expect(resolveImageProvider({ templateKey: "opinion-recommendation" })).toBe(
      "nano-banana-2",
    );
  });

  it("lifestyle-listicle stays photographic per Marcel-Decision §3.4", () => {
    expect(resolveImageProvider({ templateKey: "lifestyle-listicle" })).toBe(
      "photographic",
    );
  });

  it("unknown template falls back to nano-banana-2 (V1 default)", () => {
    expect(resolveImageProvider({ templateKey: "future-template" })).toBe(
      "nano-banana-2",
    );
  });

  it("invalid content-level choice falls through to content-type default", () => {
    const result = resolveImageProvider({
      templateKey: "lifestyle-listicle",
      contentLevelChoice: "garbage" as never,
    });
    expect(result).toBe("photographic");
  });

  it("null content-level choice falls through to content-type default", () => {
    expect(
      resolveImageProvider({ templateKey: "story-arc-clickbait", contentLevelChoice: null }),
    ).toBe("nano-banana-2");
  });

  it("isImageProvider narrows correctly", () => {
    expect(isImageProvider("nano-banana-2")).toBe(true);
    expect(isImageProvider("photographic")).toBe(true);
    expect(isImageProvider("flux-1.1-pro")).toBe(false);
    expect(isImageProvider(null)).toBe(false);
    expect(isImageProvider(undefined)).toBe(false);
  });
});
