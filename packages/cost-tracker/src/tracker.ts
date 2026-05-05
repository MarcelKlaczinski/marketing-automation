import { db, costLogs, costServiceEnum } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { checkLimit, CostLimitExceeded } from "./limits.ts";

type CostService = (typeof costServiceEnum.enumValues)[number];

const log = createLogger("cost-tracker");

/**
 * Wraps an async operation with cost tracking.
 * Steps:
 *   1. Check limits with estimatedCostEur (throws CostLimitExceeded if blocked)
 *   2. Execute fn()
 *   3. Compute actual cost via computeCostEur(result)
 *   4. Persist cost_log row
 *   5. Return fn's result
 *
 * If computeCostEur returns NaN/negative, we log estimatedCostEur and warn.
 */
export async function track<T>(input: {
  projectId: string;
  service: CostService;
  operation: string;
  estimatedCostEur: number;
  pipelineRunId?: string;
  articleId?: string;
  fn: () => Promise<T>;
  computeCostEur: (result: T) => number;
  metadata?: (result: T) => Record<string, unknown>;
}): Promise<T> {
  const check = await checkLimit({
    projectId: input.projectId,
    service: input.service,
    estimatedCostEur: input.estimatedCostEur,
  });

  if (check.alertTriggered) {
    log.warn({
      projectId: input.projectId,
      service: input.service,
      ...check.alertTriggered,
    }, "Cost alert threshold crossed");
    // TODO Spec 41: send Web Push notification to project owner
  }

  const startedAt = Date.now();
  const result = await input.fn();
  const durationMs = Date.now() - startedAt;

  let actualCost = input.computeCostEur(result);
  if (!Number.isFinite(actualCost) || actualCost < 0) {
    log.warn(
      { actualCost, estimated: input.estimatedCostEur },
      "computeCostEur returned invalid value, using estimate",
    );
    actualCost = input.estimatedCostEur;
  }

  const base = {
    projectId: input.projectId,
    service: input.service,
    operation: input.operation,
    costEur: String(actualCost),
    metadata: {
      durationMs,
      estimatedCostEur: input.estimatedCostEur,
      ...(input.metadata?.(result) ?? {}),
    },
  };

  // Build conditionally to satisfy exactOptionalPropertyTypes
  if (input.pipelineRunId !== undefined && input.articleId !== undefined) {
    await db.insert(costLogs).values({ ...base, pipelineRunId: input.pipelineRunId, articleId: input.articleId });
  } else if (input.pipelineRunId !== undefined) {
    await db.insert(costLogs).values({ ...base, pipelineRunId: input.pipelineRunId });
  } else if (input.articleId !== undefined) {
    await db.insert(costLogs).values({ ...base, articleId: input.articleId });
  } else {
    await db.insert(costLogs).values(base);
  }

  log.debug({
    projectId: input.projectId,
    service: input.service,
    operation: input.operation,
    costEur: actualCost,
    durationMs,
  }, "Cost logged");

  return result;
}

export { CostLimitExceeded };
