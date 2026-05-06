import { defineStore } from 'pinia';
import { LocalStorage } from 'quasar';

interface UiState {
  sidebarOpen: boolean;
  darkMode: boolean | 'auto';
}

export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    sidebarOpen: true,
    darkMode: (LocalStorage.getItem('darkMode') as boolean | 'auto' | null) ?? 'auto',
  }),

  actions: {
    setDarkMode(value: boolean | 'auto'): void {
      this.darkMode = value;
      LocalStorage.set('darkMode', value);
    },

    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen;
    },
  },
});
