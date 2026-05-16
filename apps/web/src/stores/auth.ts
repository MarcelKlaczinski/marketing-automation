import { defineStore } from "pinia";
import type { AuthUser } from "src/types/ui";

interface AuthState {
  /** Currently authenticated user, null when unauthenticated */
  user: AuthUser | null;
  /** True while fetchCurrent() is in-flight */
  loading: boolean;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

/**
 * Authentication store.
 * Holds the current user session loaded from /auth/me.
 * Does NOT manage the httpOnly session cookie — that is the API's responsibility.
 */
export const useAuthStore = defineStore("auth", {
  state: (): AuthState => ({
    user: null,
    loading: false,
  }),

  getters: {
    isAuthenticated: (state): boolean => state.user !== null,
  },

  actions: {
    /** Fetch the current user from /auth/me. Called by the auth boot file. */
    async fetchCurrent(): Promise<void> {
      this.loading = true;
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          credentials: "include",
        });
        if (!res.ok) {
          this.user = null;
          return;
        }
        const body = (await res.json()) as { ok: boolean; data: AuthUser };
        this.user = body.data;
      } catch {
        this.user = null;
      } finally {
        this.loading = false;
      }
    },

    /** Send a magic-link email to the given address. */
    async requestMagicLink(email: string): Promise<void> {
      const res = await fetch(`${API_BASE}/auth/magic-link`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to send magic link");
      }
    },

    /** Clear local user state (does not invalidate the server session). */
    clearUser(): void {
      this.user = null;
    },
  },
});
