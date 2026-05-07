import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';
import { HttpError } from 'src/lib/http-error';

export interface Pillar {
  id: string;
  name: string;
  description: string | null;
  position: number;
  createdAt: string;
  clusterCount: number;
}

interface PillarsState {
  byProject: Record<string, Pillar[]>;
  loading: boolean;
}

export const usePillarsStore = defineStore('pillars', {
  state: (): PillarsState => ({
    byProject: {},
    loading: false,
  }),

  actions: {
    async fetchForProject(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: Pillar[] }>(
          `/pillars?projectSlug=${encodeURIComponent(slug)}`,
        );
        this.byProject[slug] = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async create(slug: string, name: string, description?: string): Promise<Pillar> {
      const body: { projectSlug: string; name: string; description?: string } = {
        projectSlug: slug,
        name,
      };
      if (description !== undefined) body.description = description;
      const res = await api.post<{ ok: boolean; data: Pillar }>('/pillars', body);
      await this.fetchForProject(slug);
      return res.data.data;
    },

    async update(
      slug: string,
      id: string,
      patch: { name?: string; description?: string | null },
    ): Promise<void> {
      await api.patch(`/pillars/${id}`, patch);
      await this.fetchForProject(slug);
    },

    async delete(slug: string, id: string): Promise<{ deleted: boolean; clusterCount?: number }> {
      try {
        await api.delete(`/pillars/${id}`);
        await this.fetchForProject(slug);
        return { deleted: true };
      } catch (e) {
        if (e instanceof HttpError && e.body && typeof e.body === 'object' && 'error' in e.body) {
          // Cast justified: guarded by instanceof HttpError + 'error' in e.body above
          const body = e.body as { error: string; data?: { clusterCount: number } };
          if (body.error === 'pillar_has_clusters') {
            return { deleted: false, clusterCount: body.data?.clusterCount };
          }
        }
        throw e;
      }
    },

    async move(slug: string, id: string, direction: 'up' | 'down'): Promise<void> {
      await api.post(`/pillars/${id}/move`, { direction });
      await this.fetchForProject(slug);
    },
  },
});
