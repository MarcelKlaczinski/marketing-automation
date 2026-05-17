import { computed } from "vue";
import { useInfiniteQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { BriefListItem, BriefsListResponse } from "src/types/ui";

export function useBriefsSection(section: string) {
  const projectStore = useProjectStore();

  const query = useInfiniteQuery({
    queryKey: ["briefs", projectStore.currentSlug, section],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams({ section, limit: "50" });
      if (pageParam) params.set("cursor", pageParam);
      return apiGet<BriefsListResponse>(
        `/projects/${projectStore.currentSlug}/briefs?${params.toString()}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: BriefsListResponse) => last.nextCursor ?? undefined,
  });

  const briefs = computed<BriefListItem[]>(() =>
    query.data.value?.pages.flatMap((p) => p.items) ?? [],
  );
  const hasMore = computed<boolean>(() => {
    const pages = query.data.value?.pages;
    if (!pages?.length) return false;
    return pages[pages.length - 1]?.hasMore ?? false;
  });

  return {
    briefs,
    hasMore,
    loading: query.isPending,
    loadMore: () => query.fetchNextPage(),
    refetch: () => query.refetch(),
  };
}
