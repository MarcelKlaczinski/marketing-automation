<template>
  <div class="verify-page">
    <div class="verify-card">
      <div v-if="verifying" class="verify-state">
        <div class="verify-spinner" />
        <p class="text-secondary">{{ $t("auth.verify.verifying") }}</p>
      </div>
      <div v-else-if="error" class="verify-state">
        <p class="verify-error">{{ error }}</p>
        <router-link class="verify-link" to="/login">
          {{ $t("auth.verify.backToLogin") }}
        </router-link>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useAuthStore } from "src/stores/auth";
import { useProjectStore } from "src/stores/project";

/**
 * Magic-link verification page.
 * Reads `?token=` from URL query, hits /auth/verify, then redirects to dashboard.
 */
export default defineComponent({
  name: "AuthVerifyPage",

  data: () => ({
    verifying: true,
    error: "" as string,
  }),

  async mounted(): Promise<void> {
    const raw = this.$route.query["token"];
    const token = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");

    if (!token) {
      this.error = this.$t("auth.verify.noToken") as string;
      this.verifying = false;
      return;
    }

    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL as string;
      // Use the JSON verify endpoint (POST), not the legacy redirect-based GET /verify.
      // The POST endpoint sets the session cookie and returns JSON — no redirect complications.
      const res = await fetch(`${apiBase}/auth/magic-link/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        this.error = this.$t("auth.verify.invalid") as string;
        this.verifying = false;
        return;
      }
      // Refresh auth state then redirect
      await useAuthStore().fetchCurrent();
      const slug = useProjectStore().currentSlug;
      await this.$router.replace(`/projects/${slug}/dashboard`);
    } catch {
      this.error = this.$t("auth.verify.error") as string;
      this.verifying = false;
    }
  },
});
</script>

<style scoped>
.verify-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.verify-card {
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  padding: var(--space-10);
}

.verify-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
}

.verify-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-medium);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.verify-error {
  color: var(--status-failed);
  font-size: 13px;
}

.verify-link {
  color: var(--accent-primary);
  font-size: 13px;
  font-weight: 500;
}
</style>
