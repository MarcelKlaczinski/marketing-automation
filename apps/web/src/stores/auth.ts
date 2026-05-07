import { defineStore } from "pinia";
import { api } from "src/lib/api-client";

interface User {
  id: string;
  email: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    user: null,
    loading: false,
  }),

  getters: {
    isAuthenticated: (state): boolean => state.user !== null,
  },

  actions: {
    async fetchCurrent(): Promise<User | null> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: User }>("/auth/me");
        this.user = res.data.data;
        return this.user;
      } catch {
        this.user = null;
        return null;
      } finally {
        this.loading = false;
      }
    },

    async logout(): Promise<void> {
      try {
        await api.post("/auth/logout");
      } catch {
        // Ignore — local state cleanup is what matters
      }
      this.user = null;
    },
  },
});
