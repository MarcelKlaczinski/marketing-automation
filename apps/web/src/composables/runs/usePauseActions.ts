// Spec 62.6: action handlers for the 8 step-pause resolution actions.
//
// Each method posts to /api/pipeline-runs/:id/step-pauses/:stepPauseId/resolve
// and invalidates the relevant TanStack Query caches. The `rerun` handler is
// destructive-aware: a 409 with body `{ error: "destructive_confirm_needed", impact }`
// is surfaced to the caller via the returned shape so the UI can show a confirm
// dialog and re-call with confirmDestructive=true.
//
// Uses raw fetch (not apiPost) because apiPost throws a plain Error that drops
// the `impact` field on the 409 body — we need the structured response to drive
// the confirm dialog without an extra round-trip.

import { useQueryClient } from "@tanstack/vue-query";
import { type Ref, ref } from "vue";

const BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? "http://localhost:3000/api";

export interface RerunImpactPayload {
  safe: boolean;
  fromStepName: string;
  fromStepIndex: number;
  totalSteps: number;
  stepsToInvalidate: string[];
  dbWritesToRevert: string[];
  itemsToCancel: number;
  requiresConfirm: boolean;
}

export type PauseActionResult =
  | { ok: true; reEnqueued: boolean; jobId: string | null }
  | { ok: false; error: string; impact?: RerunImpactPayload };

export interface UsePauseActionsInput {
  runId: Ref<string>;
}

export interface ResolveActionBase {
  stepPauseId: string;
}
export type ResolveActionApprove = ResolveActionBase;
export interface ResolveActionEditInput extends ResolveActionBase {
  editedInput: unknown;
}
export interface ResolveActionEditOutput extends ResolveActionBase {
  editedOutput: unknown;
}
export interface ResolveActionEditPrompt extends ResolveActionBase {
  editedPrompt: string;
}
export interface ResolveActionPromote extends ResolveActionBase {
  editedPrompt: string;
}
export interface ResolveActionAbort extends ResolveActionBase {
  userNote?: string;
}
export interface ResolveActionExtract extends ResolveActionBase {
  userNote: string;
}
export interface ResolveActionRerun extends ResolveActionBase {
  confirmDestructive?: boolean;
}

export function usePauseActions(input: UsePauseActionsInput): {
  isBusy: Ref<boolean>;
  approve: (a: ResolveActionApprove) => Promise<PauseActionResult>;
  editInput: (a: ResolveActionEditInput) => Promise<PauseActionResult>;
  editOutput: (a: ResolveActionEditOutput) => Promise<PauseActionResult>;
  editPrompt: (a: ResolveActionEditPrompt) => Promise<PauseActionResult>;
  promote: (a: ResolveActionPromote) => Promise<PauseActionResult>;
  abort: (a: ResolveActionAbort) => Promise<PauseActionResult>;
  extract: (a: ResolveActionExtract) => Promise<PauseActionResult>;
  rerun: (a: ResolveActionRerun) => Promise<PauseActionResult>;
} {
  const queryClient = useQueryClient();
  const isBusy = ref(false);

  async function call(
    stepPauseId: string,
    payload: Record<string, unknown>
  ): Promise<PauseActionResult> {
    isBusy.value = true;
    try {
      // Raw fetch: 409 destructive-confirm-needed carries an `impact` body that
      // the apiPost wrapper drops (it only extracts `error` on non-OK).
      const res = await fetch(
        `${BASE}/pipeline-runs/${input.runId.value}/step-pauses/${stepPauseId}/resolve`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        impact?: RerunImpactPayload;
        data?: { reEnqueued: boolean; jobId: string | null };
      };

      if (!res.ok) {
        if (res.status === 409 && body.error === "destructive_confirm_needed" && body.impact) {
          return { ok: false, error: body.error, impact: body.impact };
        }
        return { ok: false, error: body.error ?? `HTTP ${res.status}` };
      }

      // Invalidate caches that depend on this run + the list.
      await queryClient.invalidateQueries({
        queryKey: ["pipeline-run-detail", input.runId.value],
      });
      await queryClient.invalidateQueries({ queryKey: ["pipeline-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["optimization-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["prompt-versions"] });
      return {
        ok: true,
        reEnqueued: body.data?.reEnqueued ?? false,
        jobId: body.data?.jobId ?? null,
      };
    } finally {
      isBusy.value = false;
    }
  }

  return {
    isBusy,
    approve: (a) => call(a.stepPauseId, { action: "approve" }),
    editInput: (a) => call(a.stepPauseId, { action: "edit-input", editedInput: a.editedInput }),
    editOutput: (a) => call(a.stepPauseId, { action: "edit-output", editedOutput: a.editedOutput }),
    editPrompt: (a) => call(a.stepPauseId, { action: "edit-prompt", editedPrompt: a.editedPrompt }),
    promote: (a) => call(a.stepPauseId, { action: "promote-golden", editedPrompt: a.editedPrompt }),
    abort: (a) => {
      const payload: Record<string, unknown> = { action: "abort" };
      if (a.userNote) payload.userNote = a.userNote;
      return call(a.stepPauseId, payload);
    },
    extract: (a) =>
      call(a.stepPauseId, { action: "extract-for-optimization", userNote: a.userNote }),
    rerun: (a) => {
      const payload: Record<string, unknown> = { action: "rerun" };
      if (a.confirmDestructive === true) payload.confirmDestructive = true;
      return call(a.stepPauseId, payload);
    },
  };
}
