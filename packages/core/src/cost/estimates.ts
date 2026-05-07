import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cost-estimates");

export const COST_ESTIMATES_EUR: Record<string, Record<string, number>> = {
  anthropic: {
    'outline-generation': 0.30,
    'draft-generation': 1.50,
    'self-review': 0.80,
    'briefing-generation': 0.10,
    'cold-start:voice-extraction': 0.20,
    'cold-start:competitor-questions': 0.05,
    'cold-start:cluster-plan': 0.50,
    'cold-start:cornerstone-spec': 0.40,
    'cold-start:go-live-checklist': 0.10,
    'schema-extension': 0.20,
    'internal-linking': 0.30,
  },
  replicate: {
    'hero-image': 0.10,
  },
  dataforseo: {
    'serp-analysis': 0.20,
    'keyword-research': 0.05,
    'backlink-check': 0.30,
  },
  smtp: {
    'magic-link': 0.001,
    'briefing': 0.001,
  },
};

export function estimateCostEur(service: string, operation: string, multiplier = 1): number {
  const baseEur = COST_ESTIMATES_EUR[service]?.[operation] ?? 0;
  if (baseEur === 0) {
    log.warn({ service, operation }, "No cost estimate found — cost check will pass with 0 EUR. Add an entry to COST_ESTIMATES_EUR.");
  }
  return baseEur * multiplier;
}
