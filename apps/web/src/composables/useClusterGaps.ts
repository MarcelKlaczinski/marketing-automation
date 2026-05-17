import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet, apiPatch, apiPost } from "src/lib/api";

export type GapType = "missing_hub" | "missing_translation" | "missing_spoke_type" | "cluster_too_small";

export interface ContentGap {
  id: string;
  projectId: string;
  clusterId: string | null;
  gapType: GapType;
  priority: 1 | 2 | 3;
  status: "open" | "in_progress" | "resolved" | "dismissed";
  detectedAt: string;
  metadata: {
    suggestedTitle?: string;
    suggestedCornerstoneKeyword?: string;
    suggestedMetaDescription?: string;
    discoveredKeywords?: string[];
  } | null;
}

interface GapsResponse {
  gaps: ContentGap[];
  total: number;
  limit: number;
  offset: number;
}

export function useClusterGaps(clusterId: string) {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();
  const slug = projectStore.currentSlug;
  const detecting = ref(false);
  const suggesting = ref<string | null>(null);
  const generating = ref<string | null>(null);

  const { data, isPending, refetch } = useQuery({
    queryKey: ["content-gaps", slug, clusterId],
    queryFn: () =>
      apiGet<GapsResponse>(
        `/projects/${slug}/content-gaps?status=open&clusterId=${encodeURIComponent(clusterId)}&limit=50`,
      ),
  });

  const gaps = computed<ContentGap[]>(() => data.value?.gaps ?? []);

  async function detectGaps(): Promise<void> {
    detecting.value = true;
    try {
      await apiPost(`/projects/${slug}/detect-gaps`, {});
      await refetch();
    } finally {
      detecting.value = false;
    }
  }

  async function suggestGap(gapId: string): Promise<void> {
    suggesting.value = gapId;
    try {
      await apiPost(`/projects/${slug}/content-gaps/${gapId}/suggest`, {});
      await refetch();
    } finally {
      suggesting.value = null;
    }
  }

  async function generateGap(gapId: string): Promise<void> {
    generating.value = gapId;
    try {
      await apiPost(`/projects/${slug}/content-gaps/${gapId}/generate`, {});
      await refetch();
      void queryClient.invalidateQueries({
        queryKey: ["cluster-generation-status", clusterId],
      });
    } finally {
      generating.value = null;
    }
  }

  async function dismissGap(gapId: string): Promise<void> {
    await apiPatch(`/projects/${slug}/content-gaps/${gapId}`, { status: "dismissed" });
    await refetch();
  }

  return {
    gaps,
    isLoading: isPending,
    detecting,
    suggesting,
    generating,
    detectGaps,
    suggestGap,
    generateGap,
    dismissGap,
  };
}
