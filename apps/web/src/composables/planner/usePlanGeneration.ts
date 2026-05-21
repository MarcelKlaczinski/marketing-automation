import { ref, type Ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { apiPost } from "src/lib/api";
import { useProjectStore } from "src/stores/project";

/**
 * Wraps POST /projects/:slug/plans/generate. The route returns one of:
 *   - 202 / 200       new (or deduped) run started; we don't track the run-id
 *                     here — the calendar refetch picks up the new plan row.
 *   - 409             { error: 'plan_already_exists', existingPlanId }
 *                     caller decides whether to retry with `force: true`.
 *   - 402 / 423       budget/pause errors — surfaced via thrown Error message.
 */
export function usePlanGeneration(): {
  isGenerating: Ref<boolean>;
  generate: (input: {
    targetYear: number;
    targetIsoWeek: number;
    force?: boolean;
  }) => Promise<GenerateResult>;
} {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();
  const isGenerating = ref<boolean>(false);

  async function generate(input: {
    targetYear: number;
    targetIsoWeek: number;
    force?: boolean;
  }): Promise<GenerateResult> {
    isGenerating.value = true;
    try {
      const res = await apiPost<{ runId?: string; jobId?: string; deduped?: boolean }>(
        `/projects/${projectStore.currentSlug}/plans/generate`,
        {
          targetYear: input.targetYear,
          targetIsoWeek: input.targetIsoWeek,
          force: input.force ?? false,
        },
      );
      // Pipeline runs ~1-3s. The list endpoint becomes truthy when PersistPlanStep
      // commits — invalidate planner queries so the calendar polls.
      await queryClient.invalidateQueries({ queryKey: ["planner"] });
      return { kind: "ok", runId: res.runId ?? null, deduped: res.deduped ?? false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The api helper throws a plain Error with the API's `error` field as
      // its message — detect the well-known cases by string match.
      if (msg.includes("plan_already_exists")) {
        return { kind: "exists" };
      }
      if (msg.includes("budget") || msg.toLowerCase().includes("cost")) {
        return { kind: "budget_exceeded", message: msg };
      }
      if (msg.includes("paused")) {
        return { kind: "project_paused", message: msg };
      }
      return { kind: "error", message: msg };
    } finally {
      isGenerating.value = false;
    }
  }

  return { isGenerating, generate };
}

export type GenerateResult =
  | { kind: "ok"; runId: string | null; deduped: boolean }
  | { kind: "exists" }
  | { kind: "budget_exceeded"; message: string }
  | { kind: "project_paused"; message: string }
  | { kind: "error"; message: string };
