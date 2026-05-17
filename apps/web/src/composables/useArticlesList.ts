import { type MaybeRef, unref, computed, ref } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { ArticleListItem, ArticlesListResponse } from "src/types/ui";

export interface ArticlesListFilters {
  status?: string;
  collection?: string;
  locale?: string;
  search?: string;
}

/**
 * Composable for cursor-paginated articles list.
 * Options API components call it from setup() and spread the result into data.
 * MaybeRef allows passing plain values without ref() from Options API.
 */
export function useArticlesList(initialFilters: MaybeRef<ArticlesListFilters> = {}) {
  const projectStore = useProjectStore();
  const filters = ref<ArticlesListFilters>(unref(initialFilters));

  const query = useInfiniteQuery({
    queryKey: computed(() => [
      "articles",
      projectStore.currentSlug,
      filters.value,
    ]),
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const slug = projectStore.currentSlug;
      const f = filters.value;
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (f.status) params.set("status", f.status);
      if (f.collection) params.set("collection", f.collection);
      if (f.locale) params.set("locale", f.locale);
      if (f.search) params.set("search", f.search);
      if (pageParam) params.set("cursor", pageParam);
      return apiGet<ArticlesListResponse>(
        `/projects/${slug}/articles?${params.toString()}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ArticlesListResponse) =>
      lastPage.nextCursor ?? undefined,
  });

  const articles = computed<ArticleListItem[]>(() =>
    query.data.value?.pages.flatMap((p) => p.items) ?? [],
  );

  const hasMore = computed<boolean>(() => {
    const pages = query.data.value?.pages;
    if (!pages?.length) return false;
    return pages[pages.length - 1]?.hasMore ?? false;
  });

  function setFilters(next: ArticlesListFilters): void {
    filters.value = next;
  }

  return {
    articles,
    hasMore,
    isLoading: query.isPending,
    isFetchingMore: query.isFetchingNextPage,
    loadMore: () => query.fetchNextPage(),
    refetch: () => query.refetch(),
    setFilters,
    filters,
  };
}
