import { api } from "src/lib/api-client";
import { onBeforeUnmount, onMounted, ref } from "vue";

export interface PauseInfo {
  pausedAt: string;
  reason: string;
  reasonDetails: Record<string, unknown>;
  service: string | null;
}

export function useProjectPauseState(slug: string) {
  const pauseInfo = ref<PauseInfo | null>(null);
  const loading = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function fetchOnce(): Promise<void> {
    loading.value = true;
    try {
      const res = await api.get<{ ok: boolean; data: PauseInfo | null }>(
        `/projects/${slug}/pause-state`
      );
      pauseInfo.value = res.data.data;
    } finally {
      loading.value = false;
    }
  }

  async function resume(): Promise<void> {
    await api.post(`/projects/${slug}/resume-queues`);
    await fetchOnce();
  }

  onMounted(() => {
    void fetchOnce();
    timer = setInterval(() => void fetchOnce(), 30000);
  });

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });

  return { pauseInfo, loading, refresh: fetchOnce, resume };
}
