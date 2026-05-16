import { defineStore } from "pinia";
import { LocalStorage } from "quasar";

interface ProjectState {
  /** Slug of the currently selected project */
  currentSlug: string;
}

const STORAGE_KEY = "ma_current_project_slug";

/**
 * Project selection store.
 * Persists the active project slug via Quasar LocalStorage plugin so it survives refreshes.
 * Project data is fetched via TanStack Query — this store tracks selection only.
 */
export const useProjectStore = defineStore("project", {
  state: (): ProjectState => ({
    // LocalStorage.getItem returns null when key absent; fall back to dev default
    currentSlug: (LocalStorage.getItem(STORAGE_KEY) as string | null) ?? "toolwiki",
  }),

  actions: {
    /** Switch to a different project and persist the selection. */
    setCurrentSlug(slug: string): void {
      this.currentSlug = slug;
      LocalStorage.set(STORAGE_KEY, slug);
    },
  },
});
