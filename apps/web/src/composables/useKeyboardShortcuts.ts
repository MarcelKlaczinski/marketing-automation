import { onMounted, onUnmounted } from "vue";
import { useUiStore } from "src/stores/ui";

/**
 * Registers global keyboard shortcuts for the dashboard.
 * Must be called once at the AppShell or DashboardPage level.
 *
 * Shortcuts:
 *   ⌘K / Ctrl+K   — toggle command palette
 *   Escape         — close command palette (or deselect run)
 */
export function useKeyboardShortcuts(): void {
  const uiStore = useUiStore();

  function handleKeydown(e: KeyboardEvent): void {
    // ⌘K / Ctrl+K — command palette
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      uiStore.toggleCommandPalette();
      return;
    }

    // Escape — dismiss in order: palette → detail pane selection
    if (e.key === "Escape") {
      if (uiStore.commandPaletteOpen) {
        uiStore.toggleCommandPalette();
        return;
      }
      if (uiStore.selectedPipelineRunId !== null) {
        uiStore.selectPipelineRun(null);
      }
    }
  }

  onMounted(() => {
    globalThis.addEventListener("keydown", handleKeydown);
  });

  onUnmounted(() => {
    globalThis.removeEventListener("keydown", handleKeydown);
  });
}
