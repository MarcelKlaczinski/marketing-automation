import { templateRegistry } from "./registry.ts";
import { comparisonStunningTemplate } from "./definitions/comparisonStunning.ts";
import { comparisonStunning3Template } from "./definitions/comparisonStunning3.ts";
import { useCaseVerdictPerToolTemplate } from "./definitions/useCaseVerdictPerTool.ts";

let bootstrapped = false;

export function bootstrapTemplates(): void {
  if (bootstrapped) return;

  templateRegistry.register(comparisonStunningTemplate);
  templateRegistry.register(comparisonStunning3Template);
  templateRegistry.register(useCaseVerdictPerToolTemplate);

  // Future templates registered here:
  // templateRegistry.register(singleToolSpotlightTemplate);   // Spec 54e
  // templateRegistry.register(newsSlideTemplate);             // Spec 54f
  // templateRegistry.register(conceptExplainerDeckTemplate);  // Spec 54g

  bootstrapped = true;
  console.log(`[Templates] Bootstrapped ${templateRegistry.list().length} templates`); // biome-ignore lint/suspicious/noConsoleLog: script output
}
