import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { ProjectPickerEntry } from "src/types/ui";

/**
 * Returns the full ProjectPickerEntry for the currently selected project.
 * Data comes from the same "/projects/picker" query used by ProjectSelector —
 * both share the same TanStack Query cache key so only one fetch is made.
 */
export function useProjectContext() {
  const projectStore = useProjectStore();

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects", "picker"],
    queryFn: () => apiGet<ProjectPickerEntry[]>("/projects/picker"),
    staleTime: 30_000,
  });

  const currentProject = computed<ProjectPickerEntry | null>(
    () => (projects.value ?? []).find((p) => p.slug === projectStore.currentSlug) ?? null,
  );

  const runningCount = computed<number>(
    () => currentProject.value?.activity.runningCount ?? 0,
  );

  const failedCount = computed<number>(
    () => currentProject.value?.activity.failedLast24h ?? 0,
  );

  const todayCostEur = computed<number>(
    () => currentProject.value?.stats.costThisMonthEur ?? 0,
  );

  return {
    currentProject,
    runningCount,
    failedCount,
    todayCostEur,
    isLoading,
  };
}
