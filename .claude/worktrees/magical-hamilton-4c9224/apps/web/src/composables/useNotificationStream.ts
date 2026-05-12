import { onBeforeUnmount, onMounted, ref } from "vue";
import { useNotificationsStore, type NotificationRow } from "src/stores/notifications";

export function useNotificationStream(): { connected: ReturnType<typeof ref<boolean>> } {
  const store = useNotificationsStore();
  const connected = ref(false);

  let eventSource: EventSource | null = null;
  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempts = 0;
  let stopped = false;

  function startSse(): void {
    if (stopped || eventSource) return;

    const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api";
    eventSource = new EventSource(`${base}/notifications/stream`, { withCredentials: true });

    eventSource.addEventListener("connected", () => {
      connected.value = true;
      store.setSseConnected(true);
      reconnectAttempts = 0;
      stopPolling();
    });

    eventSource.addEventListener("notification", (rawEvent) => {
      try {
        const data = JSON.parse((rawEvent as MessageEvent).data) as NotificationRow;
        store.addLive(data);
      } catch (e) {
        console.error("[notifications] Failed to parse SSE message:", e);
      }
    });

    eventSource.addEventListener("heartbeat", () => {
      // Connection healthy — no-op
    });

    eventSource.addEventListener("error", () => {
      connected.value = false;
      store.setSseConnected(false);
      reconnectAttempts += 1;
      if (reconnectAttempts >= 3) {
        eventSource?.close();
        eventSource = null;
        startPolling();
      }
    });
  }

  function startPolling(): void {
    if (pollingTimer) return;
    pollingTimer = setInterval(() => {
      void store.fetchList();
      if (!eventSource && reconnectAttempts < 10) {
        reconnectAttempts = 0;
        startSse();
      }
    }, 30_000);
  }

  function stopPolling(): void {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  onMounted(() => {
    void store.fetchList();
    startSse();
  });

  onBeforeUnmount(() => {
    stopped = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    stopPolling();
    connected.value = false;
    store.setSseConnected(false);
  });

  return { connected };
}
