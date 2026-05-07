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

interface ArticlesState {
  byProject: Record<string, ArticleListItem[]>;
  detailById: Record<string, ArticleDetail | null>;
  versionsByArticle: Record<string, ArticleVersion[]>;
  loading: boolean;
}

export const useArticlesStore = defineStore("articles", {
  state: (): ArticlesState => ({
    byProject: {},
    detailById: {},
    versionsByArticle: {},
    loading: false,
  }),

  actions: {
    async fetchForProject(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: ArticleListItem[] }>(
          `/articles?projectSlug=${encodeURIComponent(slug)}`
        );
        this.byProject[slug] = res.data.data;
      } finally {
        this.loading = false;
      }
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
      articleId: string
    ): Promise<{ runId: string; jobId: string; deduped: boolean }> {
      const res = await api.post<{
        ok: boolean;
        data: { runId: string; jobId: string; deduped: boolean };
      }>(`/articles/${articleId}/validate-pagespeed`);
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
