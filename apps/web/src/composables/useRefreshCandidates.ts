import { computed } from "vue";
import { useInfiniteQuery, useQueryClient } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet, apiPost } from "src/lib/api";

export interface RefreshCandidate {
  id: string;
  title: string | null;
  slug: string;
  collection: string | null;
  locale: string | null;
  clusterId: string | null;
  publishedAt: string | null;
  updatedAt: string;
  daysSinceLastUpdate: number;
}

interface RefreshCandidatesPage {
  candidates: RefreshCandidate[];
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export function useRefreshCandidates() {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: computed(() => ["refresh-candidates", projectStore.currentSlug]),
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const slug = projectStore.currentSlug;
      const params = new URLSearchParams({ limit: "20" });
      if (pageParam) params.set("cursor", pageParam);
      return apiGet<RefreshCandidatesPage>(
        `/projects/${slug}/refresh-candidates?${params.toString()}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: RefreshCandidatesPage) => last.nextCursor ?? undefined,
  });

  const candidates = computed<RefreshCandidate[]>(() =>
    query.data.value?.pages.flatMap((p) => p.candidates) ?? [],
  );

  const hasMore = computed<boolean>(() => {
    const pages = query.data.value?.pages;
    if (!pages?.length) return false;
    return pages[pages.length - 1]?.hasMore ?? false;
  });

  async function triggerRefresh(articleId: string): Promise<void> {
    await apiPost(
      `/projects/${projectStore.currentSlug}/refresh-candidates/${articleId}/trigger`,
      {},
    );
    void queryClient.invalidateQueries({
      queryKey: ["refresh-candidates", projectStore.currentSlug],
    });
  }

  async function dismissCandidate(articleId: string): Promise<void> {
    await apiPost(
      `/projects/${projectStore.currentSlug}/refresh-candidates/${articleId}/dismiss`,
      {},
    );
    void queryClient.invalidateQueries({
      queryKey: ["refresh-candidates", projectStore.currentSlug],
    });
  }

  return {
    candidates,
    hasMore,
    isLoading: query.isPending,
    isFetchingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
    triggerRefresh,
    dismissCandidate,
  };
}
