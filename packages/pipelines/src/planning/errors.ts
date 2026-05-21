// Spec 62.4: typed errors thrown by PlanWeekPipeline steps. Routes map these
// to specific HTTP codes (409 for PlanAlreadyExistsError, 422 for
// PlanGenerationError, 402 for BudgetExceededError).

export interface PlanGenerationDetail {
  code: string;
  message: string;
  details?: unknown;
}

export class PlanGenerationError extends Error {
  readonly issues: PlanGenerationDetail[];
  constructor(message: string, issues: PlanGenerationDetail[] = []) {
    super(message);
    this.name = "PlanGenerationError";
    this.issues = issues;
  }
}

export class BudgetExceededError extends Error {
  readonly bufferedEstimateEur: number;
  readonly budgetEur: number;
  readonly overrunEur: number;
  constructor(input: { bufferedEstimateEur: number; budgetEur: number; overrunEur: number }) {
    super(
      `Plan would cost €${input.bufferedEstimateEur.toFixed(2)} (budget: €${input.budgetEur.toFixed(2)}, overrun: €${input.overrunEur.toFixed(2)})`,
    );
    this.name = "BudgetExceededError";
    this.bufferedEstimateEur = input.bufferedEstimateEur;
    this.budgetEur = input.budgetEur;
    this.overrunEur = input.overrunEur;
  }
}
