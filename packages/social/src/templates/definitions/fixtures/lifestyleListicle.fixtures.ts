/**
 * Spec 65.8 — lifestyle-listicle fixtures (characteristic / edge-min / edge-max).
 * Canonical 3-fixture set per Spec 59.3.5 bootstrap requirement.
 */
import type { MockFixture, MockFixtureMap } from "../../types.ts";
import type { LifestyleListicleContext } from "../lifestyleListicle.ts";

const characteristic: MockFixture<LifestyleListicleContext> = {
  name: "ChatGPT 3-moments lifestyle (DE, dark)",
  description: "Featured tool ChatGPT, 3 lifestyle items, typical content length",
  input: {
    hook: {
      rendered: "3 Momente, in denen ChatGPT meinen Alltag verändert",
      variables: { profession: "Texter", lifeArea: "Alltag" },
    },
    featuredTool: {
      slug: "chatgpt",
      name: "ChatGPT",
      iconInitials: "GP",
      iconHue: 160,
    },
    articleSlug: "chatgpt-alltag",
    articleUrl: "toolwiki.ai/chatgpt-alltag",
  },
};

const edgeMin: MockFixture<LifestyleListicleContext> = {
  name: "Short hook + short tool name",
  description: "Minimum-length variables and tool — proves layout doesn't look empty",
  input: {
    hook: {
      rendered: "Claude in meinem Job",
      variables: { profession: "Texter", lifeArea: "Job" },
    },
    featuredTool: {
      slug: "claude",
      name: "Claude",
      iconInitials: "CL",
      iconHue: 30,
    },
    articleSlug: "claude-job",
    articleUrl: "toolwiki.ai/claude-job",
  },
};

const edgeMax: MockFixture<LifestyleListicleContext> = {
  name: "Long hook + long tool name + max-length narrative",
  description: "Upper-bound stress test — proves no overflow on long strings",
  input: {
    hook: {
      rendered: "Wie ich als selbstständige Webentwicklerin GitHub Copilot in 3 Alltagsmomente integriert habe",
      variables: { profession: "Webentwicklerin", lifeArea: "Alltagsmomente" },
    },
    featuredTool: {
      slug: "github-copilot",
      name: "GitHub Copilot",
      iconInitials: "GC",
      iconHue: 200,
    },
    articleSlug: "webentwicklerin-copilot-alltag",
    articleUrl: "toolwiki.ai/webentwicklerin-copilot-alltag",
  },
};

export const LIFESTYLE_LISTICLE_FIXTURES: MockFixtureMap = {
  characteristic,
  "edge-min": edgeMin,
  "edge-max": edgeMax,
};
