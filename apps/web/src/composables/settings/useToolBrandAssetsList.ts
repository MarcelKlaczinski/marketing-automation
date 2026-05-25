// Spec 65.2 — Tool brand-assets list composable for the Settings page.
//
// Calls `GET /api/projects/:slug/tool-brand-assets` (optionally with
// `?needsReview=true|false&source=<src>`). Exposes refs for items + stats +
// loading + error, plus a `refetch(slug, filters)` action that takes the
// filter state by value — keeps Options-API consumers from having to push
// state through reactive getters in setup() (apps/web CLAUDE.md rule).

import { ref } from "vue";
import { apiGet } from "src/lib/api";

export interface ToolBrandAssetListItem {
  toolId: string;
  toolSlug: string;
  toolTitle: string;
  logoUrl: string | null;
  logoWordmarkUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  brandNameCanonical: string | null;
  source: string | null;
  needsReview: boolean | null;
  fetchedAt: string | null;
  updatedAt: string | null;
}

export interface ToolBrandAssetsStats {
  total: number;
  needsReview: number;
  complete: number;
  missing: number;
}

interface Response {
  items: ToolBrandAssetListItem[];
  stats: ToolBrandAssetsStats;
  bySource: Record<string, number>;
}

export interface RefetchInput {
  slug: string;
  needsReviewFilter: "all" | "true" | "false";
  sourceFilter: string | null;
}

export function useToolBrandAssetsList() {
  const items = ref<ToolBrandAssetListItem[]>([]);
  const stats = ref<ToolBrandAssetsStats>({
    total: 0,
    needsReview: 0,
    complete: 0,
    missing: 0,
  });
  const bySource = ref<Record<string, number>>({});
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function refetch(input: RefetchInput): Promise<void> {
    if (!input.slug) {
      items.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const params = new URLSearchParams();
      if (input.needsReviewFilter === "true") params.set("needsReview", "true");
      if (input.needsReviewFilter === "false") params.set("needsReview", "false");
      if (input.sourceFilter) params.set("source", input.sourceFilter);
      const qs = params.toString();
      const data = await apiGet<Response>(
        `/projects/${input.slug}/tool-brand-assets${qs ? `?${qs}` : ""}`,
      );
      items.value = data.items;
      stats.value = data.stats;
      bySource.value = data.bySource;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "load_failed";
      items.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { items, stats, bySource, loading, error, refetch };
}
