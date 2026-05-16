import { onMounted, onUnmounted, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { usePipelineEventsStore } from "src/stores/pipeline-events";
import { useProjectStore } from "src/stores/project";
import type { PipelineEvent } from "src/types/ui";

const BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? "http://localhost:3000/api";

/**
 * SSE subscription to pipeline events for the currently selected project.
 * Pushes events into the pipeline-events Pinia store and invalidates relevant
 * TanStack Query caches so dependent UI refetches automatically.
 *
 * Lifecycle:
 * - Connects on mount, disconnects on unmount.
 * - Auto-reconnects after 5 s on error.
 * - Re-connects (and clears event buffer) when the active project slug changes.
 *
 * Intended to be called once from DashboardPage so the SSE connection lives
 * for the full page lifetime.
 */
export function usePipelineEvents() {
  const eventsStore = usePipelineEventsStore();
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();

  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Close current connection + pending reconnect timer. */
  function cleanup(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource !== null) {
      eventSource.close();
      eventSource = null;
    }
    eventsStore.setConnectionStatus("disconnected");
  }

  function handlePipelineEvent(e: MessageEvent): void {
    const event = JSON.parse(e.data as string) as PipelineEvent;
    eventsStore.addEvent(event);

    // Invalidate caches that depend on pipeline run state.
    void queryClient.invalidateQueries({ queryKey: ["pipeline-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["cost-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["activity-summary"] });

    if (event.runId) {
      void queryClient.invalidateQueries({
        queryKey: ["pipeline-run-detail", event.runId],
      });
    }
  }

  function handleClusterEvent(e: MessageEvent): void {
    const event = JSON.parse(e.data as string) as PipelineEvent;
    eventsStore.addEvent(event);
    if (event.clusterId) {
      void queryClient.invalidateQueries({
        queryKey: ["cluster-generation-status", event.clusterId],
      });
    }
  }

  function connect(): void {
    cleanup();

    const slug = projectStore.currentSlug;
    if (!slug) return;

    eventsStore.setConnectionStatus("connecting");

    const url = `${BASE}/projects/${slug}/pipeline-events`;
    eventSource = new EventSource(url, { withCredentials: true });

    eventSource.addEventListener("connected", () => {
      eventsStore.setConnectionStatus("connected");
    });

    const pipelineEvents = [
      "pipeline.started",
      "pipeline.step.started",
      "pipeline.step.completed",
      "pipeline.completed",
      "pipeline.failed",
      "pipeline.cancelled",
    ] as const;

    for (const name of pipelineEvents) {
      eventSource.addEventListener(name, handlePipelineEvent);
    }
    eventSource.addEventListener("cluster.status.changed", handleClusterEvent);

    eventSource.onerror = () => {
      eventsStore.setConnectionStatus("error");
      cleanup();
      // Reconnect after 5 s.
      reconnectTimer = setTimeout(connect, 5_000);
    };
  }

  onMounted(connect);
  onUnmounted(cleanup);

  // Re-connect when the active project changes.
  watch(
    () => projectStore.currentSlug,
    () => {
      eventsStore.clearEvents();
      connect();
    },
  );

  return {
    connectionStatus: () => eventsStore.connectionStatus,
    reconnect: connect,
  };
}
