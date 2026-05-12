import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import { type Ref, onBeforeUnmount, onMounted, ref, watch } from "vue";

export type ActivityType =
  | "cold_start"
  | "article_outline"
  | "article_draft"
  | "astro_sync"
  | "pagespeed"
  | "schema_extension"
  | "link_rebuild"
  | "other";

export type NormalizedStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ActivityEntry {
  id: string;
  source: string;
  type: ActivityType;
  status: NormalizedStatus;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  title: string;
  subtitle: string | null;
  errorMessage: string | null;
  articleId: string | null;
  articleSlug: string | null;
  clusterId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface ActiveRunsResponse {
  entries: ActivityEntry[];
  since: string;
  activeCount: number;
}

export interface UseActiveRunsPollingOptions {
  projectId?: Ref<string | null>;
  sinceHours?: Ref<number>;
  intervalMs?: number;
}

export interface UseActiveRunsPollingResult {
  entries: Ref<ActivityEntry[]>;
  activeCount: Ref<number>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  isPolling: Ref<boolean>;
  refresh: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

export function useActiveRunsPolling(
  opts: UseActiveRunsPollingOptions = {}
): UseActiveRunsPollingResult {
  const entries = ref<ActivityEntry[]>([]);
  const activeCount = ref<number>(0);
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);
  const isPolling = ref<boolean>(false);

  const intervalMs = opts.intervalMs ?? 2500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function fetchOnce(): Promise<void> {
    loading.value = true;
    try {
      const sinceMs = (opts.sinceHours?.value ?? 24) * 60 * 60 * 1000;
      const rawSince = Date.now() - sinceMs;
      // Round down to 5-minute boundary for cache-friendliness
      const ROUND_TO = 5 * 60 * 1000;
      const since = new Date(Math.floor(rawSince / ROUND_TO) * ROUND_TO).toISOString();
      const params = new URLSearchParams({ since });
      if (opts.projectId?.value) params.set("projectId", opts.projectId.value);

      const res = await api.get<{ ok: boolean; data: ActiveRunsResponse }>(
        `/pipeline-runs/active?${params.toString()}`
      );
      entries.value = res.data.data.entries;
      activeCount.value = res.data.data.activeCount;
      error.value = null;
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
        stop();
        return;
      }
      error.value = e instanceof Error ? e.message : "fetch_failed";
    } finally {
      loading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await fetchOnce();
  }

  function scheduleNext(): void {
    if (stopped) return;
    if (document.visibilityState !== "visible") return;
    timer = setTimeout(() => {
      void fetchOnce().then(() => scheduleNext());
    }, intervalMs);
  }

  function start(): void {
    stopped = false;
    isPolling.value = true;
    void fetchOnce().then(() => scheduleNext());
  }

  function stop(): void {
    stopped = true;
    isPolling.value = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === "visible" && isPolling.value && !timer) {
      void fetchOnce().then(() => scheduleNext());
    }
  }

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibilityChange);
    start();
  });

  onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    stop();
  });

  if (opts.projectId) {
    watch(opts.projectId, () => void refresh());
  }
  if (opts.sinceHours) {
    watch(opts.sinceHours, () => void refresh());
  }

  return { entries, activeCount, loading, error, isPolling, refresh, start, stop };
}
