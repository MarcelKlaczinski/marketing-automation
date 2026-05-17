import { computed, ref } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";

export interface ClustersListFilters {
  generationStatus?: string;
  search?: string;
}

interface ClusterListItem {
  id: string;
  name: string;
  pillarName: string | null;
  generationStatus: string | null;
  articleCount: number;
  costEur: number | null;
  createdAt: string;
  updatedAt: string;
}

interface ClustersListPage {
  items: ClusterListItem[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

/**
 * Composable for cursor-paginated clusters list with filters.
 * Mirrors the useArticlesList pattern — Options API components
 * call it from setup() and spread the result.
 */
export function useClustersList() {
  const projectStore = useProjectStore();
  const filters = ref<ClustersListFilters>({});

  const query = useInfiniteQuery({
    queryKey: computed(() => [
      "clusters-list",
      projectStore.currentSlug,
      filters.value,
    ]),
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const slug = projectStore.currentSlug;
      const f = filters.value;
      const params = new URLSearchParams({ limit: "20" });
      if (f.generationStatus) params.set("generationStatus", f.generationStatus);
      if (f.search?.length && f.search.length >= 2) params.set("search", f.search);
      if (pageParam) params.set("cursor", pageParam);
      return apiGet<ClustersListPage>(
        `/projects/${slug}/clusters?${params.toString()}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ClustersListPage) => last.nextCursor ?? undefined,
  });

  const clusters = computed<ClusterListItem[]>(() =>
    query.data.value?.pages.flatMap((p) => p.items) ?? [],
  );

  const hasMore = computed<boolean>(() => {
    const pages = query.data.value?.pages;
    if (!pages?.length) return false;
    return pages[pages.length - 1]?.hasMore ?? false;
  });

  function setFilters(next: ClustersListFilters): void {
    filters.value = next;
  }

  return {
    clusters,
    hasMore,
    isLoading: query.isPending,
    isFetchingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
    setFilters,
    filters,
  };
}
