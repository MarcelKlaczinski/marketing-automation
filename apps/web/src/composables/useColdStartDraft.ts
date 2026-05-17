import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { apiGet, apiPatch, apiPost } from "src/lib/api";
import type {
  ColdStartDraft,
  ColdStartState,
  ColdStartFinalizeResult,
} from "src/types/cold-start";

/**
 * Shared composable for cold-start draft state across all wizard phases.
 * Loads draft from the :draftId URL param, exposes state + actions.
 * Call only from setup() in Options API components.
 */
export function useColdStartDraft() {
  const route = useRoute();
  const router = useRouter();
  const queryClient = useQueryClient();

  const draftId = route.params.draftId as string;

  const { data: draftData, isLoading } = useQuery({
    queryKey: ["cold-start-draft", draftId],
    queryFn: () => apiGet<ColdStartDraft>(`/cold-start/${draftId}`),
    enabled: !!draftId,
  });

  const { data: stateData } = useQuery({
    queryKey: ["cold-start-state", draftId],
    queryFn: () => apiGet<ColdStartState>(`/cold-start/${draftId}/state`),
    enabled: !!draftId,
    refetchInterval: (query) => {
      const state = query.state.data;
      if (state?.currentPhase === 2 && state?.brandDiscoveryStatus === "running") {
        return 2000;
      }
      return false;
    },
  });

  const updateDraft = useMutation({
    mutationFn: (updates: Partial<ColdStartDraft>) =>
      apiPatch<ColdStartDraft>(`/cold-start/${draftId}`, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cold-start-draft", draftId] });
    },
  });

  const advance = useMutation({
    mutationFn: () => apiPost<ColdStartState>(`/cold-start/${draftId}/advance`),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ["cold-start-state", draftId] });
      const nextPhase = response.currentPhase;
      if (nextPhase) {
        void router.push(`/cold-start/${draftId}/phase-${nextPhase}`);
      }
    },
  });

  const back = useMutation({
    mutationFn: () => apiPost<ColdStartState>(`/cold-start/${draftId}/back`),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ["cold-start-state", draftId] });
      const prevPhase = response.currentPhase;
      if (prevPhase) {
        void router.push(`/cold-start/${draftId}/phase-${prevPhase}`);
      }
    },
  });

  const finalize = useMutation({
    mutationFn: () => apiPost<ColdStartFinalizeResult>(`/cold-start/${draftId}/finalize`),
    onSuccess: (response) => {
      const projectSlug = response.project?.slug;
      if (projectSlug) {
        void router.push(`/projects/${projectSlug}/dashboard`);
      }
    },
  });

  return {
    draftId,
    draft: computed(() => draftData.value),
    state: computed(() => stateData.value),
    isLoading,
    updateDraft: updateDraft.mutateAsync,
    advance: advance.mutateAsync,
    back: back.mutateAsync,
    finalize: finalize.mutateAsync,
    finalizing: finalize.isPending,
  };
}
