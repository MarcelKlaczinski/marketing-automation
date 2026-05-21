// Spec 62.7: list failed PlanWeekPipeline runs for the Planner Quarantine tab.
//
// Thin wrapper around the existing pipeline-runs list endpoint with two pinned
// filters: `pipelineNamePrefix=planning:weekly` (LIKE-match in the API) and
// `status=failed`. Lives in a Planner composable rather than reusing
// `useRunsList` directly so the query key + tab-poll cadence stay independent
// from the generic Runs Debug UI.

import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet } from "src/lib/api";
import { useProjectStore } from "src/stores/project";
import { type Ref, computed } from "vue";

export interface QuarantineRun {
  id: string;
  projectId: string;
  pipelineName: string;
  stepName: string | null;
  status: string;
  jobId: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface QuarantineListResponse {
  items: QuarantineRun[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * All inputs are plain literals (no Refs) so Options API components can call
 * `useQuarantineRuns()` directly from `setup()` without instantiating refs —
 * which would be a Composition API leak per the project's `setup()` rule.
 *
 * Pagination + autoRefresh values are static for the lifetime of a component
 * instance in this codebase (no pager UI on the badge nor on the tab itself),
 * so plain numbers/booleans are sufficient. If a future pager surfaces, switch
 * to `MaybeRef<T>` per `useCostSummary` and `unref()` inside the queryKey.
 */
export interface UseQuarantineRunsInput {
  limit?: number;
  offset?: number;
  /**
   * When `true`, refetch every 30s so the badge count + list stay roughly
   * current. Defaults to `true`. When the tab/page unmounts the query is
   * destroyed by TanStack — no manual gating needed.
   */
  autoRefresh?: boolean;
}

export function useQuarantineRuns(input: UseQuarantineRunsInput = {}): {
  runs: Ref<QuarantineRun[]>;
  total: Ref<number>;
  isPending: Ref<boolean>;
  refetch: () => Promise<void>;
} {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const autoRefresh = input.autoRefresh ?? true;

  const queryKey = computed(() => [
    "planner-quarantine",
    projectStore.currentSlug,
    limit,
    offset,
  ]);

  const listQuery = useQuery({
    queryKey,
    queryFn: () => {
      const slug = projectStore.currentSlug;
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      params.set("pipelineNamePrefix", "planning:weekly");
      params.set("status", "failed");
      return apiGet<QuarantineListResponse>(
        `/projects/${slug}/pipeline-runs?${params.toString()}`,
      );
    },
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  const runs = computed<QuarantineRun[]>(() => listQuery.data.value?.items ?? []);
  const total = computed<number>(() => listQuery.data.value?.total ?? 0);
  const isPending = computed<boolean>(() => listQuery.isPending.value);

  async function refetch(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["planner-quarantine"] });
  }

  return { runs, total, isPending, refetch };
}
