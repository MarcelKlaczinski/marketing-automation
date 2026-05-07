import type { CostLimits } from "@marketing-auto/db";

export const DEFAULT_COST_LIMITS: CostLimits = {
  daily: {
    anthropic: 5.0,
    replicate: 3.0,
    dataforseo: 5.0,
    smtp: 1.0,
  },
  monthly: {
    anthropic: 100.0,
    replicate: 50.0,
    dataforseo: 30.0,
    smtp: 5.0,
  },
  alertAtPercent: 80,
  killAtPercent: 100,
};
