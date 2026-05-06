import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

export interface AstroRepoConfig {
  owner: string;
  name: string;
  installationId: number;
  defaultBranch: string;
  contentRoot: string;
  assetsRoot: string;
}

export interface PagespeedThresholds {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface ProjectStats {
  clusterCount: number;
  articleCounts: Record<string, number>;
  totalArticles: number;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  industry: string;
  lifecycleStage: string;
  pipelineTemplate: string;
  marketingContextMd: string | null;
  astroRepo: AstroRepoConfig | null;
  pagespeedThresholds: PagespeedThresholds;
  linkRebuildBudgetMonthly: string;
  costLimits: {
    daily: Record<string, number>;
    monthly: Record<string, number>;
  };
  createdAt: string;
  updatedAt: string;
  stats?: ProjectStats;
}

interface ProjectsState {
  list: Project[];
  current: Project | null;
  loading: boolean;
}

export const useProjectsStore = defineStore('projects', {
  state: (): ProjectsState => ({
    list: [],
    current: null,
    loading: false,
  }),

  actions: {
    async fetchList(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: Project[] }>('/projects');
        this.list = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(slug: string): Promise<Project | null> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: Project }>(`/projects/${slug}`);
        this.current = res.data.data;
        return this.current;
      } finally {
        this.loading = false;
      }
    },

    async create(input: {
      slug: string;
      name: string;
      industry: string;
      pipelineTemplate: string;
      marketingContextMd?: string;
    }): Promise<Project> {
      const res = await api.post<{ ok: boolean; data: Project }>('/projects', input);
      const created = res.data.data;
      this.list.push(created);
      return created;
    },

    async update(slug: string, patch: Partial<Project>): Promise<Project> {
      const res = await api.patch<{ ok: boolean; data: Project }>(`/projects/${slug}`, patch);
      const updated = res.data.data;
      const idx = this.list.findIndex((p) => p.slug === slug);
      if (idx >= 0) this.list[idx] = updated;
      if (this.current?.slug === slug) this.current = updated;
      return updated;
    },
  },
});
