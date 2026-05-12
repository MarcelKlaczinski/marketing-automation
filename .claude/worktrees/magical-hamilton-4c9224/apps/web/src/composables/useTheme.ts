import { useQuasar } from "quasar";
import { useUiStore } from "src/stores/ui";
import { onMounted, watch } from "vue";

export function useThemeInit(): void {
  const $q = useQuasar();
  const uiStore = useUiStore();

  onMounted(() => {
    if (uiStore.darkMode === "auto") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      $q.dark.set(prefersDark);
    } else {
      $q.dark.set(uiStore.darkMode);
    }
  });

  watch(
    () => uiStore.darkMode,
    (mode) => {
      if (mode === "auto") {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        $q.dark.set(prefersDark);
      } else {
        $q.dark.set(mode);
      }
    }
  );
}
