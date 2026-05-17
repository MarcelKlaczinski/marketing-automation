import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet, apiPost } from "src/lib/api";
import type { CronStatusData } from "./useDiscoverySettings";

export interface TrendSignal {
  id: string;
  source: string;
  externalId: string;
  url: string | null;
  capturedAt: string;
}

export interface TrendScoreBreakdown {
  communityBuzz: number;
  searchVolumeGrowth: number;
  officialAnnouncement: number;
  serpVolatility: number;
  sourceDiversity?: number;
  existingCoveragePenalty: number;
}

export interface TrendMetadata {
  trendScore: number;
  freshnessWindow: "breaking" | "rising" | "stable";
  signals: TrendSignal[];
  scoreBreakdown: TrendScoreBreakdown | null;
  relatedEvent?: string;
}

export interface TrendBrief {
  id: string;
  topicTitle: string;
  primaryKeyword: string | null;
  locale: string | null;
  createdAt: string;
  updatedAt: string;
  clusterAction: "append_to_existing" | "create_new" | null;
  clusterId: string | null;
  clusterName: string | null;
  suggestedTitle: string | null;
  suggestedMeta: string | null;
  suggestedSlug: string | null;
  trendMetadata: TrendMetadata | null;
}

interface PendingBriefsResponse {
  briefs: TrendBrief[];
}

interface SynthesisStatusResponse {
  status: "idle" | "running" | "completed" | "failed";
  jobId: string | null;
}

export function useTrendsList() {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();
  const synthesizing = ref(false);

  const query = useQuery({
    queryKey: computed(() => ["trends-pending", projectStore.currentSlug]),
    queryFn: () =>
      apiGet<PendingBriefsResponse>(
        `/projects/${projectStore.currentSlug}/trends/pending-briefs`,
      ),
    refetchInterval: 60_000,
  });

  const cronQuery = useQuery({
    queryKey: computed(() => ["cron-status", projectStore.currentSlug]),
    queryFn: () =>
      apiGet<CronStatusData>(`/projects/${projectStore.currentSlug}/cron-status`),
    refetchInterval: 60_000,
  });

  const trends = computed<TrendBrief[]>(() => query.data.value?.briefs ?? []);

  async function triggerSynthesis(): Promise<void> {
    if (synthesizing.value) return;
    synthesizing.value = true;
    try {
      await apiPost(`/projects/${projectStore.currentSlug}/trends/synthesize`, {});
      void pollSynthesisStatus();
    } catch {
      synthesizing.value = false;
    }
  }

  async function pollSynthesisStatus(): Promise<void> {
    const checkOnce = async (): Promise<void> => {
      try {
        const result = await apiGet<SynthesisStatusResponse>(
          `/projects/${projectStore.currentSlug}/trends/synthesis-status`,
        );
        if (result.status === "running") {
          await new Promise<void>((resolve) => setTimeout(resolve, 3000));
          await checkOnce();
        } else {
          synthesizing.value = false;
          if (result.status === "completed") {
            void queryClient.invalidateQueries({
              queryKey: ["trends-pending", projectStore.currentSlug],
            });
          }
        }
      } catch {
        synthesizing.value = false;
      }
    };
    await checkOnce();
  }

  function findTrend(id: string): TrendBrief | undefined {
    return trends.value.find((t) => t.id === id);
  }

  return {
    trends,
    isLoading: query.isPending,
    cronStatus: computed(() => cronQuery.data.value ?? null),
    synthesizing,
    triggerSynthesis,
    findTrend,
    invalidate: () =>
      queryClient.invalidateQueries({
        queryKey: ["trends-pending", projectStore.currentSlug],
      }),
  };
}
