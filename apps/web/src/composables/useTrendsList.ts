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

export type SignalRefreshStatus =
  | "fresh"
  | "refreshed"
  | "skipped"
  | "no_credentials"
  | "filter_no_results"
  | "error";

export interface SignalRefreshSourceResult {
  source: "producthunt" | "hackernews" | "vendor_rss" | "reddit" | "github";
  status: SignalRefreshStatus;
  rowsAdded: number;
  lastCollectedAt: string | null;
  notes?: string;
  error?: string;
}

export interface SignalRefreshResult {
  projectId: string;
  triggeredAt: string;
  sourceResults: SignalRefreshSourceResult[];
  totalRowsAdded: number;
  durationMs: number;
}

export function useTrendsList() {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();
  const synthesizing = ref(false);
  const collecting = ref(false);
  const lastRefreshResult = ref<SignalRefreshResult | null>(null);

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

  /**
   * Fetches fresh signals from every enabled adapter (PH/HN/RSS/Reddit/GitHub)
   * into the pool. Returns the per-source result so the caller can render it.
   * Pass `force: true` to bypass the `signal_max_age_hours` staleness gate.
   */
  async function triggerCollect(opts?: { force?: boolean }): Promise<SignalRefreshResult | null> {
    if (collecting.value) return null;
    collecting.value = true;
    try {
      const result = await apiPost<SignalRefreshResult>(
        `/projects/${projectStore.currentSlug}/signals/refresh`,
        { force: opts?.force === true },
      );
      lastRefreshResult.value = result;
      return result;
    } finally {
      collecting.value = false;
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
    collecting,
    lastRefreshResult,
    triggerSynthesis,
    triggerCollect,
    findTrend,
    invalidate: () =>
      queryClient.invalidateQueries({
        queryKey: ["trends-pending", projectStore.currentSlug],
      }),
  };
}
