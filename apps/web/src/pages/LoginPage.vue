<template>
  <div class="login-page">
    <!-- Gradient mesh background reuses global body::before/::after -->
    <div class="login-card">
      <div class="login-logo">
        <span class="login-logo-text text-gradient-accent">MA</span>
      </div>

      <h1 class="login-title">{{ $t("auth.login.title") }}</h1>
      <p class="login-subtitle text-secondary">{{ $t("auth.login.subtitle") }}</p>

      <!-- Success state after magic link sent -->
      <div v-if="sent" class="login-sent">
        <div class="login-sent-icon">✉️</div>
        <p class="login-sent-msg">{{ $t("auth.login.checkInbox") }}</p>
        <p class="login-sent-email mono text-dim">{{ email }}</p>
      </div>

      <!-- Email input form -->
      <form v-else class="login-form" @submit.prevent="submit">
        <div class="field">
          <label class="field-label label-caps" :for="inputId">
            {{ $t("auth.login.emailLabel") }}
          </label>
          <input
            :id="inputId"
            v-model="email"
            class="field-input mono"
            type="email"
            autocomplete="email"
            :placeholder="$t('auth.login.emailPlaceholder') as string"
            :disabled="loading"
            required
          />
        </div>

        <button
          type="submit"
          class="login-btn"
          :class="{ 'login-btn--loading': loading }"
          :disabled="loading || !email"
        >
          <span v-if="loading" class="btn-spinner" />
          <span v-else>{{ $t("auth.login.sendLink") }}</span>
        </button>

        <p v-if="errorMsg" class="login-error text-sm">{{ errorMsg }}</p>
      </form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useAuthStore } from "src/stores/auth";

/**
 * Magic-link login page.
 * Two states: email form → "check your inbox" confirmation.
 * Auth flow unchanged from Spec 31 (magic-link via /auth/magic-link).
 */
export default defineComponent({
  name: "LoginPage",

  data: () => ({
    email: "",
    loading: false,
    sent: false,
    errorMsg: "" as string,
    inputId: "login-email",
  }),

  methods: {
    async submit(): Promise<void> {
      if (!this.email || this.loading) return;
      this.loading = true;
      this.errorMsg = "";
      try {
        const auth = useAuthStore();
        await auth.requestMagicLink(this.email);
        this.sent = true;
      } catch (err) {
        this.errorMsg = err instanceof Error ? err.message : (this.$t("auth.login.error") as string);
      } finally {
        this.loading = false;
      }
    },
  },
});
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}

.login-card {
  width: 100%;
  max-width: 360px;
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  box-shadow: var(--shadow-elevated);
  animation: fadeInUp 500ms cubic-bezier(0.4, 0, 0.2, 1) backwards;
}

.login-logo {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-tertiary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--space-2);
}

.login-logo-text {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
  /* override gradient-text for white on gradient bg */
  background: none;
  -webkit-text-fill-color: white;
  color: white;
}

.login-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-primary);
  text-align: center;
}

.login-subtitle {
  font-size: 13px;
  text-align: center;
  margin-top: -var(--space-2);
}

/* Form */
.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field-label {
  color: var(--text-tertiary);
}

.field-input {
  background: var(--bg-glass);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  color: var(--text-primary);
  font-size: 13px;
  transition: border-color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

.field-input:focus {
  border-color: var(--accent-primary);
  outline: none;
}

.field-input::placeholder {
  color: var(--text-dim);
}

.login-btn {
  width: 100%;
  padding: 11px;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-tertiary) 100%);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(124, 92, 255, 0.3);
  transition: opacity var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              transform var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (hover: hover) and (pointer: fine) {
  .login-btn:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }
}

.login-btn:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 160ms;
}

.login-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.login-error {
  color: var(--status-failed);
  text-align: center;
}

/* Sent confirmation */
.login-sent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  text-align: center;
  animation: fadeInUp 400ms cubic-bezier(0.4, 0, 0.2, 1) backwards;
}

.login-sent-icon {
  font-size: 32px;
}

.login-sent-msg {
  font-size: 14px;
  color: var(--text-secondary);
}

.login-sent-email {
  font-size: 12px;
}
</style>
