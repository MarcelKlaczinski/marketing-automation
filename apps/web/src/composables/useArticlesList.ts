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
  // Spec 64.19 / Phase B: opt-in flag to include `superseded` rows.
  // Ignored by the backend when an explicit `status` is set.
  includeSuperseded?: boolean;
}

/**
 * Composable for cursor-paginated articles list.
 * Options API components call it from setup() and spread the result into data.
 * MaybeRef allows passing plain values without ref() from Options API.
 */
export function useArticlesList(initialFilters: MaybeRef<ArticlesListFilters> = {}) {
  const projectStore = useProjectStore();
  const filters = ref<ArticlesListFilters>(unref(initialFilters));

  const PAGE_SIZE = 20;

  const query = useInfiniteQuery({
    queryKey: computed(() => [
      "articles",
      projectStore.currentSlug,
      filters.value,
    ]),
    // Offset-based pagination — cursor mode is unsafe here because the backend
    // filters with strict lt(updatedAt, cursor) and many articles share the same
    // updatedAt after bulk imports (PostgreSQL now() is transaction-time, so
    // imports stamp identical timestamps). The cursor would silently skip every
    // article in a same-timestamp group beyond the page boundary.
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const slug = projectStore.currentSlug;
      const f = filters.value;
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      if (f.status) params.set("status", f.status);
      if (f.collection) params.set("collection", f.collection);
      if (f.locale) params.set("locale", f.locale);
      if (f.search) params.set("search", f.search);
      if (f.includeSuperseded) params.set("includeSuperseded", "true");
      return apiGet<ArticlesListResponse>(
        `/projects/${slug}/articles?${params.toString()}`,
      );
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage: ArticlesListResponse, _allPages, lastOffset: number) => {
      const total = lastPage.total ?? 0;
      const nextOffset = lastOffset + lastPage.items.length;
      return nextOffset < total ? nextOffset : undefined;
    },
  });

  const articles = computed<ArticleListItem[]>(() =>
    query.data.value?.pages.flatMap((p) => p.items) ?? [],
  );

  const hasMore = computed<boolean>(() => {
    const pages = query.data.value?.pages;
    if (!pages?.length) return false;
    const last = pages[pages.length - 1];
    if (!last) return false;
    const loaded = pages.reduce((sum, p) => sum + p.items.length, 0);
    return loaded < (last.total ?? 0);
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
