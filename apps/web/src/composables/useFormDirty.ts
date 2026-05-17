import { computed } from "vue";

/**
 * Tracks dirty state by deep-comparing current to original via JSON.stringify.
 * Both arguments are getter functions — compatible with Options API components
 * that pass `() => this.formData` and `() => this.originalData` from setup().
 */
export function useFormDirty<T>(current: () => T, original: () => T) {
  const dirty = computed(() => JSON.stringify(current()) !== JSON.stringify(original()));
  return { dirty };
}
