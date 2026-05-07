import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

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

interface ClustersState {
  byProject: Record<string, Cluster[]>;
  loading: boolean;
}

export const useClustersStore = defineStore('clusters', {
  state: (): ClustersState => ({
    byProject: {},
    loading: false,
  }),

  actions: {
    async fetchForProject(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: Cluster[] }>(
          `/clusters?projectSlug=${encodeURIComponent(slug)}`,
        );
        this.byProject[slug] = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async create(
      slug: string,
      pillarId: string,
      name: string,
      primaryKeyword?: string,
    ): Promise<Cluster> {
      const body: { projectSlug: string; pillarId: string; name: string; primaryKeyword?: string } =
        { projectSlug: slug, pillarId, name };
      if (primaryKeyword !== undefined) body.primaryKeyword = primaryKeyword;
      const res = await api.post<{ ok: boolean; data: Cluster }>('/clusters', body);
      await this.fetchForProject(slug);
      return res.data.data;
    },

    async update(
      slug: string,
      id: string,
      patch: { name?: string; primaryKeyword?: string | null; pillarId?: string },
    ): Promise<void> {
      await api.patch(`/clusters/${id}`, patch);
      await this.fetchForProject(slug);
    },

    async delete(slug: string, id: string): Promise<{ articlesUncategorized: number }> {
      const res = await api.delete<{ ok: boolean; data: { articlesUncategorized: number } }>(
        `/clusters/${id}`,
      );
      await this.fetchForProject(slug);
      return res.data.data;
    },

    async move(slug: string, id: string, direction: 'up' | 'down'): Promise<void> {
      await api.post(`/clusters/${id}/move`, { direction });
      await this.fetchForProject(slug);
    },

    async moveArticles(
      slug: string,
      fromClusterId: string,
      articleIds: string[],
      toClusterId: string | null,
    ): Promise<void> {
      await api.post(`/clusters/${fromClusterId}/move-articles`, { articleIds, toClusterId });
      await this.fetchForProject(slug);
    },
  },
});
