import { templateRegistry } from "./registry.ts";
import { comparisonStunningTemplate } from "./definitions/comparisonStunning.ts";
import { comparisonStunning3Template } from "./definitions/comparisonStunning3.ts";
import { useCaseVerdictPerToolTemplate } from "./definitions/useCaseVerdictPerTool.ts";
import { singleToolSpotlightTemplate } from "./definitions/singleToolSpotlight.ts";

let bootstrapped = false;

export function bootstrapTemplates(): void {
  if (bootstrapped) return;

  templateRegistry.register(comparisonStunningTemplate);
  templateRegistry.register(comparisonStunning3Template);
  templateRegistry.register(useCaseVerdictPerToolTemplate);
  templateRegistry.register(singleToolSpotlightTemplate);

  // Future templates registered here:
  // templateRegistry.register(newsSlideTemplate);             // Spec 54g
  // templateRegistry.register(conceptExplainerDeckTemplate);  // Spec 54h

  bootstrapped = true;
  console.log(`[Templates] Bootstrapped ${templateRegistry.list().length} templates`); // biome-ignore lint/suspicious/noConsoleLog: script output
}
