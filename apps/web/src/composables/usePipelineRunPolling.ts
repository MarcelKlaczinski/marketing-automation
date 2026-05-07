import { ref, watch, onUnmounted, type Ref } from 'vue';
import { api } from 'src/lib/api-client';
import { HttpError } from 'src/lib/http-error';

export interface PipelineRun {
  id: string;
  pipelineName: string;
  projectId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  stepName: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface UsePipelineRunPollingOptions {
  intervalMs?: number;
  pauseWhenHidden?: boolean;
}

export interface UsePipelineRunPollingResult {
  run: Ref<PipelineRun | null>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  terminal: Ref<boolean>;
  refresh: () => Promise<void>;
  start: (newRunId: string) => void;
  stop: () => void;
}

const TERMINAL_STATUSES = new Set<PipelineRun['status']>(['completed', 'failed', 'cancelled']);

export function usePipelineRunPolling(
  runIdRef: Ref<string | null> | string | null = null,
  options: UsePipelineRunPollingOptions = {},
): UsePipelineRunPollingResult {
  const intervalMs = options.intervalMs ?? 2500;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;

  const run = ref<PipelineRun | null>(null) as Ref<PipelineRun | null>;
  const loading = ref(false);
  const error = ref<Error | null>(null);
  const terminal = ref(false);

  let timer: ReturnType<typeof setInterval> | null = null;
  let currentRunId: string | null = typeof runIdRef === 'string' ? runIdRef : runIdRef?.value ?? null;

  async function fetchOnce(): Promise<void> {
    if (!currentRunId) return;
    if (pauseWhenHidden && document.hidden) return;

    loading.value = true;
    try {
      const res = await api.get<{ ok: boolean; data: PipelineRun }>(`/pipeline-runs/${currentRunId}`);
      run.value = res.data.data;
      terminal.value = TERMINAL_STATUSES.has(res.data.data.status);
      error.value = null;
      if (terminal.value) stop();
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
        stop();
        return;
      }
      error.value = e instanceof Error ? e : new Error(String(e));
    } finally {
      loading.value = false;
    }
  }

  function start(newRunId: string): void {
    stop();
    currentRunId = newRunId;
    terminal.value = false;
    run.value = null;
    void fetchOnce();
    timer = setInterval(() => { void fetchOnce(); }, intervalMs);
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  if (typeof runIdRef !== 'string' && runIdRef !== null) {
    watch(runIdRef, (newId) => {
      if (newId) start(newId);
      else stop();
    }, { immediate: true });
  } else if (currentRunId) {
    start(currentRunId);
  }

  onUnmounted(stop);

  return { run, loading, error, terminal, refresh: fetchOnce, start, stop };
}
