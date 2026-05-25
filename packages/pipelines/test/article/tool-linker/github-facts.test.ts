// Spec 64.20 — GitHub facts injection into the tools-context fragment.
// Pure unit tests against buildToolsContextFragment.
//
// Integration coverage (the JOIN against content_source_inventory inside
// resolveRelevantTools) is light here on purpose — the JOIN is one
// straightforward predicate query and Marcel verifies live after seeding.

import { describe, expect, it } from "bun:test";
import { buildToolsContextFragment } from "../../../src/article/tool-linker/pre-generation.ts";
import type {
  GithubFacts,
  ToolReference,
} from "../../../src/article/tool-linker/types.ts";

const SAMPLE_GITHUB: GithubFacts = {
  starsCount: 25000,
  forksCount: 1234,
  primaryLanguage: "TypeScript",
  license: "MIT",
  latestRelease: { tag: "v1.0.0", publishedAt: "2024-12-15T10:00:00Z" },
  lastFetchedAt: "2026-05-25T12:00:00Z",
};

function tool(overrides: Partial<ToolReference> = {}): ToolReference {
  return {
    slug: "claude-code",
    name: "Claude Code",
    pricing: "freemium",
    rating: 4.8,
    shortDescription: "Anthropic CLI",
    features: [],
    github: null,
    ...overrides,
  };
}

describe("buildToolsContextFragment — GitHub facts rendering", () => {
  it("renders compact suffix when github facts are present", () => {
    const fragment = buildToolsContextFragment({
      primary: [tool({ github: SAMPLE_GITHUB })],
      secondary: [],
    });
    expect(fragment).toContain("GitHub: 25,000⭐");
    expect(fragment).toContain("MIT");
    expect(fragment).toContain("Latest: v1.0.0");
    expect(fragment).toContain("Dec 2024");
  });

  it("includes the use-github-facts instruction when any tool has data", () => {
    const fragment = buildToolsContextFragment({
      primary: [tool({ github: SAMPLE_GITHUB })],
      secondary: [],
    });
    expect(fragment).toContain("Use GitHub facts");
    expect(fragment).toContain("Do NOT invent star counts");
  });

  it("omits the use-github-facts instruction when no tool has data", () => {
    const fragment = buildToolsContextFragment({
      primary: [tool({ github: null })],
      secondary: [],
    });
    expect(fragment).not.toContain("Use GitHub facts");
    expect(fragment).not.toContain("Do NOT invent");
  });

  it("omits license when it is 'no-license'", () => {
    const fragment = buildToolsContextFragment({
      primary: [
        tool({
          github: { ...SAMPLE_GITHUB, license: "no-license" },
        }),
      ],
      secondary: [],
    });
    expect(fragment).toContain("25,000⭐");
    expect(fragment).not.toContain("no-license");
  });

  it("omits latest release when null", () => {
    const fragment = buildToolsContextFragment({
      primary: [
        tool({
          github: { ...SAMPLE_GITHUB, latestRelease: null },
        }),
      ],
      secondary: [],
    });
    expect(fragment).toContain("25,000⭐");
    expect(fragment).not.toContain("Latest:");
  });

  it("renders github suffix for secondary tools too", () => {
    const fragment = buildToolsContextFragment({
      primary: [],
      secondary: [tool({ slug: "ollama", name: "Ollama", github: SAMPLE_GITHUB })],
    });
    expect(fragment).toContain("Ollama");
    expect(fragment).toContain("Other Top Tools");
    expect(fragment).toContain("25,000⭐");
  });

  it("formats stars with locale-en thousand separator", () => {
    const fragment = buildToolsContextFragment({
      primary: [tool({ github: { ...SAMPLE_GITHUB, starsCount: 1234567 } })],
      secondary: [],
    });
    expect(fragment).toContain("1,234,567⭐");
  });

  it("mixes github-having and github-null tools without breaking layout", () => {
    const fragment = buildToolsContextFragment({
      primary: [
        tool({ slug: "with-data", name: "WithGH", github: SAMPLE_GITHUB }),
        tool({ slug: "without-data", name: "NoGH", github: null }),
      ],
      secondary: [],
    });
    expect(fragment).toContain("WithGH");
    expect(fragment).toContain("25,000⭐");
    expect(fragment).toContain("NoGH");
    // NoGH line should NOT carry a GitHub suffix
    const lines = fragment.split("\n");
    const noGhLine = lines.find((l) => l.includes("NoGH"));
    expect(noGhLine).toBeDefined();
    expect(noGhLine).not.toContain("GitHub");
  });
});
