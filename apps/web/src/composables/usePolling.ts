import { onUnmounted, ref } from "vue";

/**
 * Lightweight polling helper. Calls `poll()` on an interval until `shouldStop`
 * returns true, then invokes `onStop` with the final result.
 * Cleans up automatically via `onUnmounted`.
 *
 * Usage in Options API:
 *   const { isPolling, start, stop } = usePolling({ ... }) in setup()
 */
export function usePolling<T>(args: {
  poll: () => Promise<T>;
  shouldStop: (result: T) => boolean;
  intervalMs?: number;
  onStop?: (lastResult: T) => void;
}) {
  const isPolling = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    if (isPolling.value) return;
    isPolling.value = true;
    timer = setInterval(() => {
      void (async () => {
        const result = await args.poll();
        if (args.shouldStop(result)) {
          stop();
          args.onStop?.(result);
        }
      })();
    }, args.intervalMs ?? 3000);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    isPolling.value = false;
  }

  onUnmounted(stop);

  return { isPolling, start, stop };
}
