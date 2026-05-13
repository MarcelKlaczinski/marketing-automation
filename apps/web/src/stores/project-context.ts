import { defineStore } from "pinia";
import { LocalStorage } from "quasar";
import { api } from "src/lib/api-client";

const STORAGE_KEY = "ma_current_project_slug";

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
}

export const useProjectContextStore = defineStore("projectContext", {
  state: () => ({
    currentProjectSlug: (LocalStorage.getItem(STORAGE_KEY) as string | null) ?? null,
    currentProjectId: null as string | null,
    allProjects: [] as ProjectSummary[],
    loading: false,
  }),

  getters: {
    currentProject(state): ProjectSummary | null {
      if (!state.currentProjectSlug) return null;
      return state.allProjects.find((p) => p.slug === state.currentProjectSlug) ?? null;
    },
  },

  actions: {
    async loadProjects() {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: ProjectSummary[] }>("/projects");
        this.allProjects = res.data.data;

        // Validate persisted slug still exists
        if (this.currentProjectSlug) {
          const found = this.allProjects.find((p) => p.slug === this.currentProjectSlug);
          if (!found && this.allProjects[0]) {
            this.setProject(this.allProjects[0].slug);
          } else if (found) {
            this.currentProjectId = found.id;
          }
        } else if (this.allProjects[0]) {
          this.setProject(this.allProjects[0].slug);
        }
      } finally {
        this.loading = false;
      }
    },

    setProject(slug: string) {
      const project = this.allProjects.find((p) => p.slug === slug);
      if (!project) return;
      this.currentProjectSlug = slug;
      this.currentProjectId = project.id;
      LocalStorage.set(STORAGE_KEY, slug);
    },

    clearProject() {
      this.currentProjectSlug = null;
      this.currentProjectId = null;
      LocalStorage.remove(STORAGE_KEY);
    },
  },
});
