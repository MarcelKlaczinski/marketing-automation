// Spec 62.6: list paginated pipeline_runs with pipeline-name + status filtering.
// Wraps GET /api/projects/:slug/pipeline-runs and the pipeline-names endpoint.

import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet } from "src/lib/api";
import { useProjectStore } from "src/stores/project";
import { type Ref, computed } from "vue";

export interface PipelineRunRow {
  id: string;
  projectId: string;
  pipelineName: string;
  stepName: string | null;
  status: string;
  jobId: string | null;
  parentRunId: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  suspensionCheckpoint: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  // Spec 64.19 / Phase A: substep count (children with parent_run_id = this.id).
  // 0 means no children persisted yet (e.g. for runs that never reached step 1).
  stepCount: number;
}

export interface RunsListResponse {
  items: PipelineRunRow[];
  total: number;
  limit: number;
  offset: number;
}

export interface UseRunsListInput {
  pipelineName: Ref<string | null>;
  status: Ref<string[]>;
  limit: Ref<number>;
  offset: Ref<number>;
}

export function useRunsList(input: UseRunsListInput): {
  runs: Ref<PipelineRunRow[]>;
  total: Ref<number>;
  pipelineNames: Ref<string[]>;
  isPending: Ref<boolean>;
  refetch: () => Promise<void>;
} {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();

  const queryKey = computed(() => [
    "pipeline-runs",
    projectStore.currentSlug,
    input.pipelineName.value,
    [...input.status.value].sort().join(","),
    input.limit.value,
    input.offset.value,
  ]);

  const listQuery = useQuery({
    queryKey,
    queryFn: () => {
      const slug = projectStore.currentSlug;
      const params = new URLSearchParams();
      params.set("limit", String(input.limit.value));
      params.set("offset", String(input.offset.value));
      if (input.pipelineName.value) {
        params.set("pipelineNamePrefix", input.pipelineName.value);
      }
      if (input.status.value.length > 0) {
        params.set("status", input.status.value.join(","));
      }
      return apiGet<RunsListResponse>(`/projects/${slug}/pipeline-runs?${params.toString()}`);
    },
  });

  const pipelineNamesQuery = useQuery({
    queryKey: computed(() => ["pipeline-runs-names", projectStore.currentSlug]),
    queryFn: () =>
      apiGet<string[]>(`/projects/${projectStore.currentSlug}/pipeline-runs/pipeline-names`),
  });

  const runs = computed<PipelineRunRow[]>(() => listQuery.data.value?.items ?? []);
  const total = computed<number>(() => listQuery.data.value?.total ?? 0);
  const pipelineNames = computed<string[]>(() => pipelineNamesQuery.data.value ?? []);
  const isPending = computed<boolean>(() => listQuery.isPending.value);

  async function refetch(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["pipeline-runs"] });
  }

  return { runs, total, pipelineNames, isPending, refetch };
}
