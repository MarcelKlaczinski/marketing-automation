import { computed } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiDelete, apiGet, apiPost } from "src/lib/api";

export interface QualityFindings {
  outdatedClaims: Array<{ snippet: string; reason: string }>;
  missingCoverage: string[];
  staleReferences: Array<{ entity: string; note: string }>;
  overallRecommendation: "refresh-now" | "refresh-soon" | "no-action";
  confidence: "high" | "medium" | "low";
}

export interface RefreshSuggestion {
  id: string;
  source: "time" | "quality";
  reasoning: string;
  stalenessDays: number | null;
  qualityFindings: QualityFindings | null;
  generatedAt: string;
  articleId: string;
  articleTitle: string | null;
  articleSlug: string;
  articleLocale: string | null;
  articleLastRefreshedAt: string | null;
}

interface RefreshSuggestionsResponse {
  suggestions: RefreshSuggestion[];
}

export function useRefreshSuggestions() {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: computed(() => ["refresh-suggestions", projectStore.currentSlug]),
    queryFn: () =>
      apiGet<RefreshSuggestionsResponse>(
        `/projects/${projectStore.currentSlug}/refresh-suggestions`,
      ),
  });

  const suggestions = computed<RefreshSuggestion[]>(
    () => query.data.value?.suggestions ?? [],
  );

  async function dismissSuggestion(id: string): Promise<void> {
    await apiDelete(`/projects/${projectStore.currentSlug}/refresh-suggestions/${id}`);
    void queryClient.invalidateQueries({
      queryKey: ["refresh-suggestions", projectStore.currentSlug],
    });
  }

  async function markRefreshed(articleId: string): Promise<void> {
    await apiPost(
      `/projects/${projectStore.currentSlug}/articles/${articleId}/mark-refreshed`,
      {},
    );
    void queryClient.invalidateQueries({
      queryKey: ["refresh-suggestions", projectStore.currentSlug],
    });
    void queryClient.invalidateQueries({
      queryKey: ["refresh-candidates", projectStore.currentSlug],
    });
  }

  return {
    suggestions,
    isLoading: query.isPending,
    dismissSuggestion,
    markRefreshed,
  };
}
