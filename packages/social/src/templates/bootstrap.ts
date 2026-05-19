import { templateRegistry } from "./registry.ts";
import { comparisonGrid4Template } from "./definitions/comparisonGrid4.ts";
import { comparisonGrid3Template } from "./definitions/comparisonGrid3.ts";
import { verdictPerUseCaseTemplate } from "./definitions/verdictPerUseCase.ts";
import { singleToolSpotlightTemplate } from "./definitions/singleToolSpotlight.ts";
import { proConVerdictTemplate } from "./definitions/proConVerdict.ts";

let bootstrapped = false;

export function bootstrapTemplates(): void {
  if (bootstrapped) return;

  templateRegistry.register(comparisonGrid4Template);
  templateRegistry.register(comparisonGrid3Template);
  templateRegistry.register(verdictPerUseCaseTemplate);
  templateRegistry.register(singleToolSpotlightTemplate);
  templateRegistry.register(proConVerdictTemplate);

  // Future templates registered here:
  // templateRegistry.register(newsSlideTemplate);             // Spec 54g
  // templateRegistry.register(conceptExplainerDeckTemplate);  // Spec 54h

  bootstrapped = true;
  console.log(`[Templates] Bootstrapped ${templateRegistry.list().length} templates`); // biome-ignore lint/suspicious/noConsoleLog: script output
}
