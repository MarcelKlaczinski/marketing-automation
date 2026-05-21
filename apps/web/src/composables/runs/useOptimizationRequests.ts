// Spec 62.6: list + mark-resolved/dismissed for step_optimization_requests.

import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet, apiPatch } from "src/lib/api";
import { useProjectStore } from "src/stores/project";
import { type Ref, computed } from "vue";

export type OptimizationRequestStatus = "open" | "resolved" | "dismissed";

export interface OptimizationRequest {
  id: string;
  sourcePauseId: string | null;
  stepName: string;
  pipelineName: string;
  projectId: string;
  stepInput: Record<string, unknown>;
  stepOutput: Record<string, unknown>;
  promptUsed: string | null;
  userNote: string;
  requestedBy: string;
  status: OptimizationRequestStatus;
  addressedNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

export function useOptimizationRequests(input: {
  status: Ref<OptimizationRequestStatus | "all">;
}): {
  requests: Ref<OptimizationRequest[]>;
  isPending: Ref<boolean>;
  refetch: () => Promise<void>;
  markResolved: (id: string, addressedNote?: string) => Promise<void>;
  markDismissed: (id: string, addressedNote?: string) => Promise<void>;
} {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: computed(() => [
      "optimization-requests",
      projectStore.currentSlug,
      input.status.value,
    ]),
    queryFn: () => {
      const slug = projectStore.currentSlug;
      const qs = input.status.value === "all" ? "" : `?status=${input.status.value}`;
      return apiGet<OptimizationRequest[]>(`/projects/${slug}/optimization-requests${qs}`);
    },
  });

  const requests = computed<OptimizationRequest[]>(() => listQuery.data.value ?? []);
  const isPending = computed<boolean>(() => listQuery.isPending.value);

  async function refetch(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["optimization-requests"] });
  }

  async function mutateStatus(
    id: string,
    status: "resolved" | "dismissed",
    addressedNote?: string
  ): Promise<void> {
    const payload: Record<string, unknown> = { status };
    if (addressedNote !== undefined && addressedNote.length > 0) {
      payload.addressedNote = addressedNote;
    }
    await apiPatch(`/optimization-requests/${id}`, payload);
    await refetch();
  }

  return {
    requests,
    isPending,
    refetch,
    markResolved: (id, note) => mutateStatus(id, "resolved", note),
    markDismissed: (id, note) => mutateStatus(id, "dismissed", note),
  };
}
