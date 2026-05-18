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

  function handleDiscoveryEvent(e: MessageEvent): void {
    const event = JSON.parse(e.data as string) as PipelineEvent;
    eventsStore.addEvent(event);

    const slug = projectStore.currentSlug;

    // Always refresh sidebar badge counts.
    void queryClient.invalidateQueries({ queryKey: ["discovery-counts", slug] });

    // Invalidate the relevant view's data query too.
    if (event.type === "trends.discovered") {
      void queryClient.invalidateQueries({ queryKey: ["trends-pending", slug] });
    } else if (event.type === "gaps.detected") {
      // Invalidate all content-gap queries for this project (all clusters).
      void queryClient.invalidateQueries({ queryKey: ["content-gaps", slug] });
    } else if (event.type === "refresh.detected") {
      void queryClient.invalidateQueries({ queryKey: ["refresh-candidates", slug] });
    } else if (event.type === "refresh.suggestion.created") {
      void queryClient.invalidateQueries({ queryKey: ["refresh-suggestions", slug] });
    }
  }

  function handleSocialRenderEvent(e: MessageEvent): void {
    const event = JSON.parse(e.data as string) as PipelineEvent;
    eventsStore.addEvent(event);

    // Invalidate social post queries so render-status chips + slide previews update.
    // Scope to the article when known; fall back to broader invalidation.
    if (event.articleId) {
      void queryClient.invalidateQueries({ queryKey: ["social-posts", event.articleId] });
    } else {
      void queryClient.invalidateQueries({ queryKey: ["social-posts"] });
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

    const discoveryEvents = [
      "trends.discovered",
      "gaps.detected",
      "refresh.detected",
      "refresh.suggestion.created",
    ] as const;

    for (const name of discoveryEvents) {
      eventSource.addEventListener(name, handleDiscoveryEvent);
    }

    const socialRenderEvents = [
      "social.render.started",
      "social.render.completed",
      "social.render.failed",
    ] as const;

    for (const name of socialRenderEvents) {
      eventSource.addEventListener(name, handleSocialRenderEvent);
    }

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
