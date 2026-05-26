/**
 * Spec 65.8 — opinion-recommendation fixtures (characteristic / edge-min / edge-max).
 */
import type { MockFixture, MockFixtureMap } from "../../types.ts";
import type { OpinionRecommendationContext } from "../opinionRecommendation.ts";

const characteristic: MockFixture<OpinionRecommendationContext> = {
  name: "Texter opinion + Claude recommendation (DE, dark)",
  description: "Typical opinion-recommendation post with hook + bold take + 2 reasoning + Claude as top-pick",
  input: {
    hook: {
      rendered: "Die meisten Texter benutzen ChatGPT falsch",
      variables: { profession: "Texter", lifeArea: "Workflow" },
    },
    recommendedTool: {
      slug: "claude",
      name: "Claude",
      iconInitials: "CL",
      iconHue: 30,
    },
    articleSlug: "texter-chatgpt-falsch",
    articleUrl: "toolwiki.ai/texter-chatgpt-falsch",
  },
};

const edgeMin: MockFixture<OpinionRecommendationContext> = {
  name: "Minimal hook + short tool name",
  description: "Short hook + 1-word tool — proves layout doesn't look empty",
  input: {
    hook: {
      rendered: "KI-Tools sind nicht gleich",
      variables: { profession: "Texter", lifeArea: "Job" },
    },
    recommendedTool: {
      slug: "claude",
      name: "Claude",
      iconInitials: "CL",
      iconHue: 30,
    },
    articleSlug: "ki-tools-vergleich",
    articleUrl: "toolwiki.ai/ki-tools-vergleich",
  },
};

const edgeMax: MockFixture<OpinionRecommendationContext> = {
  name: "Long hook + long tool name",
  description: "Upper-bound stress test — proves no overflow on long strings + Hot-Take at max length",
  input: {
    hook: {
      rendered: "Für selbstständige Webentwicklerinnen ist GitHub Copilot das einzige Tool, das den Aufwand wert ist",
      variables: { profession: "Webentwicklerin", lifeArea: "Workflow" },
    },
    recommendedTool: {
      slug: "github-copilot",
      name: "GitHub Copilot",
      iconInitials: "GC",
      iconHue: 200,
    },
    articleSlug: "webentwicklerin-copilot-empfehlung",
    articleUrl: "toolwiki.ai/webentwicklerin-copilot-empfehlung",
  },
};

export const OPINION_RECOMMENDATION_FIXTURES: MockFixtureMap = {
  characteristic,
  "edge-min": edgeMin,
  "edge-max": edgeMax,
};
