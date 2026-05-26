import { templateRegistry } from "./registry.ts";
import { comparisonGrid4Template } from "./definitions/comparisonGrid4.ts";
import { comparisonGrid3Template } from "./definitions/comparisonGrid3.ts";
import { comparisonGrid5Template } from "./definitions/comparisonGrid5.ts";
import { verdictPerUseCaseTemplate } from "./definitions/verdictPerUseCase.ts";
import { singleToolSpotlightTemplate } from "./definitions/singleToolSpotlight.ts";
import { proConVerdictTemplate } from "./definitions/proConVerdict.ts";
import { headToHeadVsTemplate } from "./definitions/headToHeadVs.ts";
import { headToHeadDeepDiveTemplate } from "./definitions/headToHeadDeepDive.ts";
import { storyArcClickbaitTemplate } from "./definitions/storyArcClickbait.ts";
import type { TemplateDefinition } from "./types.ts";

const REQUIRED_FIXTURE_KEYS = ["characteristic", "edge-min", "edge-max"] as const;

function assertFixtures(t: TemplateDefinition<unknown>): void {
  if (!t.mockFixtures) {
    throw new Error(`[Templates] ${t.key}: mockFixtures missing`);
  }
  for (const key of REQUIRED_FIXTURE_KEYS) {
    if (!(key in t.mockFixtures)) {
      throw new Error(`[Templates] ${t.key}: mockFixtures missing required key "${key}"`);
    }
  }
}

let bootstrapped = false;

export function bootstrapTemplates(): void {
  if (bootstrapped) return;

  // Cast to unknown[] so the generic register<T> resolves cleanly for each element.
  const templates = [
    comparisonGrid4Template,
    comparisonGrid3Template,
    comparisonGrid5Template,
    verdictPerUseCaseTemplate,
    singleToolSpotlightTemplate,
    proConVerdictTemplate,
    headToHeadVsTemplate,
    headToHeadDeepDiveTemplate,
    storyArcClickbaitTemplate,
  ] as unknown as TemplateDefinition<unknown>[];

  for (const t of templates) {
    assertFixtures(t);
    templateRegistry.register(t);
  }

  // Future templates registered here:
  // templateRegistry.register(newsSlideTemplate);             // Spec 54g
  // templateRegistry.register(conceptExplainerDeckTemplate);  // Spec 54h

  bootstrapped = true;
  console.log(`[Templates] Bootstrapped ${templateRegistry.list().length} templates`); // biome-ignore lint/suspicious/noConsoleLog: script output
}
