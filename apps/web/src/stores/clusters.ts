import { defineStore } from "pinia";
import { api } from "src/lib/api-client";

export interface Cluster {
  id: string;
  name: string;
  pillarId: string;
  pillarName: string | null;
  primaryKeyword: string | null;
  cornerstoneKeywords: string[];
  pillarArticleId: string | null;
  pillarArticleTitle: string | null;
  position: number;
  createdAt: string;
  articleCount: number;
  cornerstoneCount: number;
}

interface PaginationState {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface ClustersState {
  byProject: Record<string, Cluster[]>;
  paginationByProject: Record<string, PaginationState>;
  loading: boolean;
}

type PaginatedClustersResponse = {
  ok: boolean;
  data: { items: Cluster[]; total: number; limit: number; offset: number };
};

export const useClustersStore = defineStore("clusters", {
  state: (): ClustersState => ({
    byProject: {},
    paginationByProject: {},
    loading: false,
  }),

  actions: {
    async fetchForProject(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<PaginatedClustersResponse>(
          `/clusters?projectSlug=${encodeURIComponent(slug)}&limit=100&offset=0`
        );
        const { items, total, limit, offset } = res.data.data;
        this.byProject[slug] = items;
        this.paginationByProject[slug] = { total, limit, offset, hasMore: offset + items.length < total };
      } finally {
        this.loading = false;
      }
    },

    async loadMore(slug: string): Promise<void> {
      const state = this.paginationByProject[slug];
      if (!state?.hasMore) return;
      const offset = state.offset + state.limit;

      const res = await api.get<PaginatedClustersResponse>(
        `/clusters?projectSlug=${encodeURIComponent(slug)}&limit=${state.limit}&offset=${offset}`
      );
      const { items, total, limit, offset: rOffset } = res.data.data;
      const current = this.byProject[slug] ?? [];
      const existingIds = new Set(current.map((c) => c.id));
      const newOnes = items.filter((c) => !existingIds.has(c.id));
      this.byProject[slug] = [...current, ...newOnes];
      this.paginationByProject[slug] = { total, limit, offset: rOffset, hasMore: rOffset + items.length < total };
    },

    async create(
      slug: string,
      pillarId: string,
      name: string,
      primaryKeyword?: string
    ): Promise<Cluster> {
      const body: { projectSlug: string; pillarId: string; name: string; primaryKeyword?: string } =
        { projectSlug: slug, pillarId, name };
      if (primaryKeyword !== undefined) body.primaryKeyword = primaryKeyword;
      const res = await api.post<{ ok: boolean; data: Cluster }>("/clusters", body);
      await this.fetchForProject(slug);
      return res.data.data;
    },

    async update(
      slug: string,
      id: string,
      patch: { name?: string; primaryKeyword?: string | null; pillarId?: string }
    ): Promise<void> {
      await api.patch(`/clusters/${id}`, patch);
      await this.fetchForProject(slug);
    },

    async delete(slug: string, id: string): Promise<{ articlesUncategorized: number }> {
      const res = await api.delete<{ ok: boolean; data: { articlesUncategorized: number } }>(
        `/clusters/${id}`
      );
      await this.fetchForProject(slug);
      return res.data.data;
    },

    async move(slug: string, id: string, direction: "up" | "down"): Promise<void> {
      await api.post(`/clusters/${id}/move`, { direction });
      await this.fetchForProject(slug);
    },

    async moveArticles(
      slug: string,
      fromClusterId: string,
      articleIds: string[],
      toClusterId: string | null
    ): Promise<void> {
      await api.post(`/clusters/${fromClusterId}/move-articles`, { articleIds, toClusterId });
      await this.fetchForProject(slug);
    },
  },
});
