/**
 * Spec 65.8 — story-arc-clickbait fixtures (characteristic / edge-min / edge-max).
 *
 * Three canonical scenarios per Spec 59.3.5 bootstrap requirement.
 * `generatedContent` mirrors the LLM-output slice (narrative only) — the
 * fixture-bounds test validates against `storyArcClickbaitGeneratedSchema`.
 */
import type { StoryArcContext } from "../storyArcClickbait.ts";
import type { MockFixture, MockFixtureMap } from "../../types.ts";

const characteristic: MockFixture<StoryArcContext> = {
  name: "Texter career-disruption (DE, dark)",
  description: "Profession=Texter narrative with primary tool ChatGPT — typical content length",
  input: {
    hook: {
      rendered: "Wie ich als Texter meinen Job mit KI gerettet habe",
      variables: { profession: "Texter", lifeArea: "Job" },
    },
    primaryTool: {
      slug: "chatgpt",
      name: "ChatGPT",
      iconInitials: "GP",
      iconHue: 160,
    },
    articleSlug: "wie-texter-ki",
    articleUrl: "toolwiki.ai/wie-texter-ki",
  },
};

const edgeMin: MockFixture<StoryArcContext> = {
  name: "Minimal hook + no tool",
  description: "Shortest hook, no inline tool mention — proves gradient-only path renders cleanly",
  input: {
    hook: {
      rendered: "Mein Job als Designer hat sich verändert",
      variables: { profession: "Designer", lifeArea: "Job" },
    },
    articleSlug: "designer-shift",
    articleUrl: "toolwiki.ai/designer-shift",
  },
};

const edgeMax: MockFixture<StoryArcContext> = {
  name: "Long hook + tool + max-length narrative",
  description: "Max-length hook + tool mention — proves no overflow at upper bounds",
  input: {
    hook: {
      rendered: "Wie ich als selbstständige UX-Designerin endlich Schlaf bekomme",
      variables: { profession: "UX-Designerin", lifeArea: "Schlaf" },
    },
    primaryTool: {
      slug: "claude",
      name: "Claude",
      iconInitials: "CL",
      iconHue: 30,
    },
    articleSlug: "ux-designerin-schlaf",
    articleUrl: "toolwiki.ai/ux-designerin-schlaf",
  },
};

export const STORY_ARC_CLICKBAIT_FIXTURES: MockFixtureMap = {
  characteristic,
  "edge-min": edgeMin,
  "edge-max": edgeMax,
};
