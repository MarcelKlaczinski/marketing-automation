import { defineStore } from "pinia";
import type { ActivitySource } from "src/types/ui";

type StatusFilter = "all" | "running" | "queued" | "failed" | "completed";

interface UiState {
  /** ID of the pipeline run shown in the detail pane, null when nothing selected */
  selectedPipelineRunId: string | null;
  /** Source table of the selected run — determines which detail endpoint to use */
  selectedRunSource: ActivitySource | null;
  /** Whether the command palette modal is open */
  commandPaletteOpen: boolean;
  /** Active status filter applied to kanban lanes */
  statusFilter: StatusFilter;
  /** Whether the detail pane is visible (desktop: always; mobile: toggled) */
  detailPaneOpen: boolean;
  /** Whether the sidebar drawer is open (mobile only) */
  sidebarOpen: boolean;
}

/**
 * UI-only state store.
 * Selected items, modal toggles, filter state.
 * Does NOT contain API data — that lives in TanStack Query cache.
 */
export const useUiStore = defineStore("ui", {
  state: (): UiState => ({
    selectedPipelineRunId: null,
    selectedRunSource: null,
    commandPaletteOpen: false,
    statusFilter: "all",
    detailPaneOpen: true,
    sidebarOpen: false,
  }),

  actions: {
    /** Select a pipeline run for the detail pane. Pass null to deselect. */
    selectPipelineRun(runId: string | null, source: ActivitySource | null = null): void {
      this.selectedPipelineRunId = runId;
      this.selectedRunSource = source;
      if (runId) this.detailPaneOpen = true;
    },

    /** Toggle the command palette open/closed. */
    toggleCommandPalette(): void {
      this.commandPaletteOpen = !this.commandPaletteOpen;
    },

    /** Close the command palette. */
    closeCommandPalette(): void {
      this.commandPaletteOpen = false;
    },

    /** Update the kanban lane status filter. */
    setStatusFilter(filter: StatusFilter): void {
      this.statusFilter = filter;
    },

    /** Toggle the mobile sidebar drawer. */
    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen;
    },

    /** Close the mobile sidebar drawer. */
    closeSidebar(): void {
      this.sidebarOpen = false;
    },
  },
});
