// Spec 62.6: load a single pipeline_runs row with steps + costs + pauses + article.

import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet } from "src/lib/api";
import { type Ref, computed } from "vue";

export interface RunDetailStep {
  id: string;
  stepName: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  pause: RunDetailPause | null;
}

export interface RunDetailPause {
  id: string;
  stepName: string;
  stepInput: Record<string, unknown>;
  stepOutput: Record<string, unknown>;
  promptUsed: string | null;
  action: string | null;
  userNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  requestedAt: string;
}

export interface RunDetailCost {
  id: string;
  operation: string;
  service: string;
  costEur: number;
  stepRunId: string | null;
  createdAt: string;
}

export interface RunDetailResponse {
  run: {
    id: string;
    pipelineName: string;
    projectId: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    durationMs: number | null;
    input: Record<string, unknown> | null;
    output: Record<string, unknown> | null;
    error: string | null;
    retriedFromRunId: string | null;
  };
  steps: RunDetailStep[];
  pauses: Array<{
    id: string;
    stepRunId: string;
    stepName: string;
    action: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null;
    requestedAt: string;
  }>;
  costs: RunDetailCost[];
  totalCostEur: number;
  article: {
    id: string;
    title: string | null;
    slug: string;
    status: string;
    locale: string | null;
    clusterId: string | null;
  } | null;
  brief: { id: string; source: string; topicTitle: string } | null;
}

export function useRunDetail(runId: Ref<string>): {
  detail: Ref<RunDetailResponse | null>;
  isPending: Ref<boolean>;
  refetch: () => Promise<void>;
} {
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: computed(() => ["pipeline-run-detail", runId.value]),
    queryFn: () => apiGet<RunDetailResponse>(`/pipeline-runs/${runId.value}`),
    enabled: computed(() => !!runId.value),
  });

  const detail = computed<RunDetailResponse | null>(() => detailQuery.data.value ?? null);
  const isPending = computed<boolean>(() => detailQuery.isPending.value);

  async function refetch(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: ["pipeline-run-detail", runId.value],
    });
  }

  return { detail, isPending, refetch };
}
