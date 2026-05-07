import { defineStore } from "pinia";
import { api } from "src/lib/api-client";

export type PhaseStatusLabel = "pending" | "running" | "awaiting_review" | "complete";

export interface PhaseStatus {
  status: PhaseStatusLabel;
  count?: number;
  proposedCount?: number;
  approvedCount?: number;
}

export interface ColdStartStatus {
  voice: PhaseStatus;
  competitors: PhaseStatus;
  clusters: PhaseStatus & { count: number };
  cornerstones: PhaseStatus & { proposedCount: number; approvedCount: number };
  goLive: PhaseStatus;
}

export interface CornerstoneArticle {
  id: string;
  slug: string;
  cornerstoneKeyword: string;
  title: string | null;
  metaDescription: string | null;
  status: "proposed" | "approved" | "rejected";
  createdAt: string;
}

interface ColdStartState {
  statusByProject: Record<string, ColdStartStatus | null>;
  cornerstonesByProject: Record<string, CornerstoneArticle[]>;
  loading: boolean;
}

export const useColdStartStore = defineStore("coldStart", {
  state: (): ColdStartState => ({
    statusByProject: {},
    cornerstonesByProject: {},
    loading: false,
  }),

  actions: {
    async fetchStatus(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: ColdStartStatus }>(
          `/projects/${slug}/cold-start/status`
        );
        this.statusByProject[slug] = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async fetchCornerstones(slug: string): Promise<void> {
      const res = await api.get<{ ok: boolean; data: CornerstoneArticle[] }>(
        `/projects/${slug}/cold-start/cornerstones`
      );
      this.cornerstonesByProject[slug] = res.data.data;
    },

    async triggerVoiceQuestions(slug: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/voice-refinement/questions`
      );
      return res.data.data;
    },

    async triggerVoiceSynthesize(
      slug: string,
      answers: { questionIndex: number; answer: string }[]
    ): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/voice-refinement/synthesize`,
        { answers }
      );
      return res.data.data;
    },

    async triggerCompetitorQuestions(slug: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/competitor-analysis/questions`
      );
      return res.data.data;
    },

    async triggerCompetitorAnalysis(
      slug: string,
      competitors: { domain: string; why_relevant: string; expected_strengths: string[] }[]
    ): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/competitor-analysis/run`,
        { competitors }
      );
      return res.data.data;
    },

    async triggerClusterPlan(
      slug: string,
      payload?: { contentGaps?: string[]; topicsToAvoid?: string[] }
    ): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/cluster-plan`,
        payload ?? {}
      );
      return res.data.data;
    },

    async triggerCornerstoneList(
      slug: string,
      approvedClusters: {
        name: string;
        pillar: string;
        status: "proposed" | "approved" | "rejected";
        cornerstone_keyword: string;
        cornerstone_search_volume: number | null;
        cornerstone_difficulty: number | null;
        satellite_keywords: {
          keyword: string;
          search_volume: number | null;
          difficulty: number | null;
        }[];
      }[]
    ): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/cornerstones`,
        { approvedClusters }
      );
      return res.data.data;
    },

    async cornerstoneAction(
      slug: string,
      articleId: string,
      action: "approve" | "reject"
    ): Promise<void> {
      await api.post(`/projects/${slug}/cold-start/cornerstones/${articleId}/action`, { action });
    },

    async cornerstoneEdit(
      slug: string,
      articleId: string,
      patch: { title?: string; cornerstoneKeyword?: string; metaDescription?: string }
    ): Promise<void> {
      await api.patch(`/projects/${slug}/cold-start/cornerstones/${articleId}`, patch);
    },

    async triggerGoLive(slug: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/go-live-checklist`
      );
      return res.data.data;
    },
  },
});
