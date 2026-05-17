import { computed, ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";

interface UseSectionFormOptions<TFormData, TResponse> {
  initialData: () => TFormData;
  onSave: (data: TFormData) => Promise<TResponse>;
  invalidateKeys?: string[][];
  onSuccess?: (response: TResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Section-scoped form with explicit save pattern.
 *
 * Returns:
 * - formData: editable reactive copy (Ref<TFormData>)
 * - originalData: pristine reference (Ref<TFormData>)
 * - dirty: boolean computed — true when formData diverges from originalData
 * - saving: boolean Ref — true while save mutation is in-flight
 * - lastSavedAt: string | null — ISO timestamp of last successful save
 * - save: trigger save mutation with current formData
 * - cancel: revert formData to originalData
 * - resetFromUpstream: call when upstream data refetches to sync both refs
 *
 * All Composition API primitives live here so Options API components can call
 * this composable from setup() without violating the Options API rule.
 */
export function useSectionForm<TFormData, TResponse>(
  options: UseSectionFormOptions<TFormData, TResponse>,
) {
  const queryClient = useQueryClient();
  const formData = ref<TFormData>(options.initialData()) as import("vue").Ref<TFormData>;
  const originalData = ref<TFormData>(options.initialData()) as import("vue").Ref<TFormData>;
  const lastSavedAt = ref<string | null>(null);

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (data: TFormData) => options.onSave(data),
    onSuccess: (response) => {
      originalData.value = JSON.parse(JSON.stringify(formData.value)) as TFormData;
      lastSavedAt.value = new Date().toISOString();

      if (options.invalidateKeys) {
        for (const key of options.invalidateKeys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }

      options.onSuccess?.(response);
    },
    onError: (error) => {
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
    },
  });

  const dirty = computed(
    () => JSON.stringify(formData.value) !== JSON.stringify(originalData.value),
  );

  const save = () => mutateAsync(formData.value);

  const cancel = () => {
    formData.value = JSON.parse(JSON.stringify(originalData.value)) as TFormData;
  };

  const resetFromUpstream = () => {
    const fresh = options.initialData();
    formData.value = JSON.parse(JSON.stringify(fresh)) as TFormData;
    originalData.value = JSON.parse(JSON.stringify(fresh)) as TFormData;
  };

  return {
    formData,
    originalData,
    dirty,
    saving: isPending,
    lastSavedAt,
    save,
    cancel,
    resetFromUpstream,
  };
}
