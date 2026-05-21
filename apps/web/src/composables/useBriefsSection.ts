import { computed } from "vue";
import { useRoute } from "vue-router";
import { useInfiniteQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { BriefListItem, BriefsListResponse } from "src/types/ui";

/**
 * Reads the active source filter from the URL query (`?source=a,b`).
 * Returns a stable comma-joined string used in queryKey + request URL.
 */
function readSourceFromQuery(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string").join(",");
  }
  return "";
}

export function useBriefsSection(section: string) {
  const projectStore = useProjectStore();
  const route = useRoute();

  const sourceFilter = computed<string>(() => readSourceFromQuery(route.query.source));
  const readinessFilter = computed<string>(() => {
    const raw = route.query.readiness;
    const v = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
    return v === "ready" || v === "unready" ? v : "";
  });

  const query = useInfiniteQuery({
    queryKey: ["briefs", projectStore.currentSlug, section, sourceFilter, readinessFilter],
    queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams({ section, limit: "50" });
      if (pageParam) params.set("cursor", pageParam);
      if (sourceFilter.value) params.set("source", sourceFilter.value);
      if (readinessFilter.value) params.set("readiness", readinessFilter.value);
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
