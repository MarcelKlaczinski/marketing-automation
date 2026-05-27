/**
 * Spec 65.V1.5b — Auto-approve resolution for recurring-content briefs.
 *
 * Resolution hierarchy:
 *   1. If `definition.autoApproveOverride` is non-null → use it.
 *   2. Otherwise fall back to `project.recurringAutoApproveDefault`.
 *
 * Pure function — no DB. Caller loads both rows ahead of time.
 *
 * Default behaviour (V1): both project-default and per-definition-override
 * are FALSE, so briefs land in `plan_pending` for Marcel-review. Marcel
 * opts in to auto-approve by flipping the project toggle OR by flipping
 * the per-definition override.
 */

export interface ResolveAutoApproveInput {
  definitionAutoApproveOverride: boolean | null;
  projectRecurringAutoApproveDefault: boolean;
}

export function resolveAutoApprove(input: ResolveAutoApproveInput): boolean {
  if (input.definitionAutoApproveOverride !== null) {
    return input.definitionAutoApproveOverride;
  }
  return input.projectRecurringAutoApproveDefault;
}
