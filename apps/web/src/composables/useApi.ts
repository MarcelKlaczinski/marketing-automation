import { ref, type Ref } from 'vue';
import { api } from 'src/lib/api-client';
import { HttpError } from 'src/lib/http-error';

interface UseApiResult<T> {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<HttpError | null>;
  execute: () => Promise<T | null>;
}

export function useApi<T>(fn: () => Promise<{ data: T }>): UseApiResult<T> {
  const data = ref<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<HttpError | null>(null);

  async function execute(): Promise<T | null> {
    loading.value = true;
    error.value = null;
    try {
      const res = await fn();
      data.value = res.data;
      return res.data;
    } catch (e) {
      error.value = e instanceof HttpError ? e : null;
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, execute };
}

export { api };
