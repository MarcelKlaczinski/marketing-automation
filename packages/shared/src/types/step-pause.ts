import { z } from "zod";

/**
 * Spec 62.0a + 62.6: the 9 possible actions a user (or the system) can take on a paused step.
 *
 * - `approve`                  : accept stepOutput as-is, runner uses it as priorOutput and proceeds.
 * - `edit-output`              : caller supplies editedOutput; runner validates against step.outputSchema
 *                                and uses it as priorOutput. The step is NOT re-executed.
 * - `edit-prompt`              : caller supplies editedPrompt; runner re-executes the step with
 *                                ctx.promptOverride[stepName] set to the new text.
 * - `edit-input`               : caller supplies editedInput; runner re-executes the step with
 *                                the new input. priorOutput[stepName] is cleared.
 * - `rerun`                    : re-execute this step with the original input (no edits). Later
 *                                steps' outputs/pauses are invalidated and pipeline-specific
 *                                cleanup hooks run before re-enqueue. Spec 62.6 §6.8.
 * - `abort`                    : caller cancels the run. Parent pipeline_run → status='cancelled'.
 * - `promote-golden`           : in 62.0a behaves like approve; in 62.0b will write to prompt_versions.
 * - `extract-for-optimization` : the pipeline stays paused. The user_note is persisted; in 62.0b a
 *                                step_optimization_requests row is created.
 * - `auto-dismissed`           : system-set when the parent pipeline_run is cancelled/failed/superseded
 *                                before the user resolved the pause. NOT a user-facing action.
 */
export const STEP_ACTIONS = [
  "approve",
  "edit-output",
  "edit-prompt",
  "edit-input",
  "rerun",
  "abort",
  "promote-golden",
  "extract-for-optimization",
  "auto-dismissed",
] as const;

export const stepActionSchema = z.enum(STEP_ACTIONS);
export type StepAction = z.infer<typeof stepActionSchema>;

/**
 * Subset of actions a user can submit via the resolve API (excludes the system-only
 * `auto-dismissed`).
 */
export const userStepActionSchema = z.enum([
  "approve",
  "edit-output",
  "edit-prompt",
  "edit-input",
  "rerun",
  "abort",
  "promote-golden",
  "extract-for-optimization",
]);
export type UserStepAction = z.infer<typeof userStepActionSchema>;

/**
 * Body of POST /pipeline-runs/:id/step-pauses/:stepPauseId/resolve.
 *
 * Per-action field requirements are enforced via `.superRefine()` so the API can reject
 * malformed payloads (e.g. action='edit-output' without editedOutput) at the boundary.
 */
export const stepPausePayloadSchema = z
  .object({
    action: userStepActionSchema,
    editedInput: z.unknown().optional(),
    editedOutput: z.unknown().optional(),
    editedPrompt: z.string().min(1).optional(),
    userNote: z.string().max(4000).optional(),
    /**
     * Spec 62.6 §6.8 / §4: required to be `true` when the rerun-preflight reports
     * destructive impact (later steps had DB writes, items already enqueued). The
     * service layer re-runs the preflight at resolve time and rejects the request
     * with 409 `destructive_confirm_needed` when impact is destructive and this
     * field is missing.
     */
    confirmDestructive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "edit-input" && data.editedInput === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editedInput"],
        message: "editedInput is required when action='edit-input'",
      });
    }
    if (data.action === "edit-output" && data.editedOutput === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editedOutput"],
        message: "editedOutput is required when action='edit-output'",
      });
    }
    if (
      (data.action === "edit-prompt" || data.action === "promote-golden") &&
      data.editedPrompt === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["editedPrompt"],
        message: "editedPrompt is required when action='edit-prompt' or 'promote-golden'",
      });
    }
    if (data.action === "extract-for-optimization" && !data.userNote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["userNote"],
        message: "userNote is required when action='extract-for-optimization'",
      });
    }
  });
export type StepPausePayload = z.infer<typeof stepPausePayloadSchema>;
