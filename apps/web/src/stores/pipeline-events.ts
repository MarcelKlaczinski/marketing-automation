import { defineStore } from "pinia";
import type { PipelineEvent } from "src/types/ui";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface PipelineEventsState {
  /** SSE event buffer, newest first, capped at 100 entries */
  events: PipelineEvent[];
  /** Current SSE connection status */
  connectionStatus: ConnectionStatus;
  /** ISO timestamp of the most recent event received */
  lastEventAt: string | null;
}

const MAX_EVENTS = 100;

/**
 * SSE pipeline event buffer store.
 * Populated by the usePipelineEvents composable.
 * UI components read this store to render real-time updates.
 */
export const usePipelineEventsStore = defineStore("pipeline-events", {
  state: (): PipelineEventsState => ({
    events: [],
    connectionStatus: "disconnected",
    lastEventAt: null,
  }),

  getters: {
    /** True when SSE is actively connected */
    isConnected: (state): boolean => state.connectionStatus === "connected",
  },

  actions: {
    /** Prepend a new event; prune to MAX_EVENTS. */
    addEvent(event: PipelineEvent): void {
      this.events.unshift(event);
      if (this.events.length > MAX_EVENTS) {
        this.events.length = MAX_EVENTS;
      }
      this.lastEventAt = event.timestamp;
    },

    /** Update the connection status indicator. */
    setConnectionStatus(status: ConnectionStatus): void {
      this.connectionStatus = status;
    },

    /** Clear all buffered events (called on project switch). */
    clearEvents(): void {
      this.events = [];
      this.lastEventAt = null;
    },
  },
});
