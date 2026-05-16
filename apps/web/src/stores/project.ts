import { defineStore } from "pinia";

interface ProjectState {
  /** Slug of the currently selected project */
  currentSlug: string;
}

const STORAGE_KEY = "ma_current_project_slug";

/**
 * Project selection store.
 * Persists the active project slug to localStorage so it survives refreshes.
 * Project data is fetched via TanStack Query — this store tracks selection only.
 */
export const useProjectStore = defineStore("project", {
  state: (): ProjectState => ({
    currentSlug: localStorage.getItem(STORAGE_KEY) ?? "toolwiki",
  }),

  actions: {
    /** Switch to a different project and persist the selection. */
    setCurrentSlug(slug: string): void {
      this.currentSlug = slug;
      localStorage.setItem(STORAGE_KEY, slug);
    },
  },
});
