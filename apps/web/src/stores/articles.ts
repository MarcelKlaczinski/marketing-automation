import { defineStore } from "pinia";
import { api } from "src/lib/api-client";

export interface ArticleListItem {
  id: string;
  slug: string;
  title: string | null;
  cornerstoneKeyword: string;
  status: string;
  cornerstoneSpecId: string | null;
  clusterId: string | null;
  clusterName: string | null;
  pillarId: string | null;
  pillarName: string | null;
  pillarPosition: number | null;
  wordCount: number | null;
  publishedAt: string | null;
  astroSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  locale: string | null;
  source: string | null;
}

export interface ArticleDetail {
  article: Record<string, unknown>;
  cluster: Record<string, unknown> | null;
  pillar: Record<string, unknown> | null;
  recentRuns: {
    sync: Record<string, unknown>[];
    pagespeed: Record<string, unknown>[];
    schema: Record<string, unknown>[];
  };
}

export interface ArticleVersion {
  id: string;
  version: number;
  changeReason: string | null;
  createdAt: string;
}

interface PaginationState {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface ArticlesState {
  byProject: Record<string, ArticleListItem[]>;
  paginationByProject: Record<string, PaginationState>;
  paginationByLane: Record<string, Record<string, PaginationState>>;
  detailById: Record<string, ArticleDetail | null>;
  versionsByArticle: Record<string, ArticleVersion[]>;
  loading: boolean;
}

type PaginatedArticlesResponse = {
  ok: boolean;
  data: { items: ArticleListItem[]; total: number; limit: number; offset: number };
};

export const useArticlesStore = defineStore("articles", {
  state: (): ArticlesState => ({
    byProject: {},
    paginationByProject: {},
    paginationByLane: {},
    detailById: {},
    versionsByArticle: {},
    loading: false,
  }),

  actions: {
    async fetchForProject(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<PaginatedArticlesResponse>(
          `/articles?projectSlug=${encodeURIComponent(slug)}&limit=50&offset=0`
        );
        const { items, total, limit, offset } = res.data.data;
        this.byProject[slug] = items;
        this.paginationByProject[slug] = { total, limit, offset, hasMore: offset + items.length < total };
        this.paginationByLane[slug] = {};
      } finally {
        this.loading = false;
      }
    },

    async loadMoreForProject(slug: string): Promise<void> {
      const state = this.paginationByProject[slug];
      if (!state?.hasMore) return;
      const offset = state.offset + state.limit;
      const res = await api.get<PaginatedArticlesResponse>(
        `/articles?projectSlug=${encodeURIComponent(slug)}&limit=${state.limit}&offset=${offset}`
      );
      const { items, total, limit, offset: rOffset } = res.data.data;
      const existingIds = new Set((this.byProject[slug] ?? []).map((a) => a.id));
      const newOnes = items.filter((a) => !existingIds.has(a.id));
      this.byProject[slug] = [...(this.byProject[slug] ?? []), ...newOnes];
      this.paginationByProject[slug] = { total, limit, offset: rOffset, hasMore: rOffset + items.length < total };
    },

    async loadMoreForLane(slug: string, lane: string): Promise<void> {
      const laneState = this.paginationByLane[slug]?.[lane];
      const offset = laneState ? laneState.offset + laneState.limit : 0;

      const res = await api.get<PaginatedArticlesResponse>(
        `/articles?projectSlug=${encodeURIComponent(slug)}&lane=${encodeURIComponent(lane)}&limit=50&offset=${offset}`
      );
      const { items, total, limit, offset: rOffset } = res.data.data;

      const current = this.byProject[slug] ?? [];
      const existingIds = new Set(current.map((a) => a.id));
      const newOnes = items.filter((a) => !existingIds.has(a.id));
      this.byProject[slug] = [...current, ...newOnes];

      this.paginationByLane[slug] = this.paginationByLane[slug] ?? {};
      this.paginationByLane[slug][lane] = {
        total,
        limit,
        offset: rOffset,
        hasMore: rOffset + items.length < total,
      };
    },

    async fetchDetail(articleId: string): Promise<ArticleDetail | null> {
      try {
        const res = await api.get<{ ok: boolean; data: ArticleDetail }>(`/articles/${articleId}`);
        this.detailById[articleId] = res.data.data;
        return res.data.data;
      } catch {
        return null;
      }
    },

    async updateMetadata(articleId: string, patch: Record<string, unknown>): Promise<void> {
      await api.patch(`/articles/${articleId}`, patch);
      delete this.detailById[articleId];
      await this.fetchDetail(articleId);
    },

    async saveBody(articleId: string, bodyMd: string, changeReason?: string): Promise<number> {
      const payload: Record<string, unknown> = { bodyMd };
      if (changeReason) payload.changeReason = changeReason;
      const res = await api.post<{ ok: boolean; data: { version: number } }>(
        `/articles/${articleId}/body`,
        payload
      );
      delete this.detailById[articleId];
      delete this.versionsByArticle[articleId];
      return res.data.data.version;
    },

    async fetchVersions(articleId: string): Promise<ArticleVersion[]> {
      const res = await api.get<{ ok: boolean; data: ArticleVersion[] }>(
        `/articles/${articleId}/versions`
      );
      this.versionsByArticle[articleId] = res.data.data;
      return res.data.data;
    },

    async fetchVersionBody(articleId: string, version: number): Promise<string | null> {
      try {
        const res = await api.get<{ ok: boolean; data: { bodyMd: string } }>(
          `/articles/${articleId}/versions/${version}`
        );
        return res.data.data.bodyMd;
      } catch {
        return null;
      }
    },

    async triggerOutline(
      articleId: string
    ): Promise<{ runId: string; jobId: string; deduped: boolean }> {
      const res = await api.post<{
        ok: boolean;
        data: { runId: string; jobId: string; deduped: boolean };
      }>(`/articles/${articleId}/generate-outline`);
      return res.data.data;
    },

    async triggerDraft(
      articleId: string
    ): Promise<{ runId: string; jobId: string; deduped: boolean }> {
      const res = await api.post<{
        ok: boolean;
        data: { runId: string; jobId: string; deduped: boolean };
      }>(`/articles/${articleId}/generate-draft`);
      return res.data.data;
    },

    async triggerSync(
      articleId: string
    ): Promise<{ runId: string; jobId: string; deduped: boolean }> {
      const res = await api.post<{
        ok: boolean;
        data: { runId: string; jobId: string; deduped: boolean };
      }>(`/articles/${articleId}/sync`);
      return res.data.data;
    },

    async triggerPagespeedValidation(
      articleId: string,
      mode: "local" | "api" = "local"
    ): Promise<{ runId: string; jobId: string; deduped: boolean }> {
      const res = await api.post<{
        ok: boolean;
        data: { runId: string; jobId: string; deduped: boolean };
      }>(`/articles/${articleId}/validate-pagespeed`, { mode });
      return res.data.data;
    },

    async triggerSchemaExtension(
      articleId: string
    ): Promise<{ runId: string; jobId: string; deduped: boolean }> {
      const res = await api.post<{
        ok: boolean;
        data: { runId: string; jobId: string; deduped: boolean };
      }>(`/articles/${articleId}/extend-schema`);
      return res.data.data;
    },
  },
});
