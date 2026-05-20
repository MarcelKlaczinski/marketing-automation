<template>
  <!-- Spec 62.0a Section 7: stub page for the step-pause inspector.
       Full UI lands in 62.6 — for now we surface the route so the Cmd+K action,
       the notification deep-link, and direct URL access have somewhere to land. -->
  <div class="paused-runs-stub">
    <header class="page-header">
      <h1 class="page-title">{{ $t("pausedRuns.pageTitle") as string }}</h1>
      <p class="page-desc">{{ $t("pausedRuns.pageDescription") as string }}</p>
    </header>

    <section class="stub-card">
      <div class="stub-icon" aria-hidden="true">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="10" y1="9" x2="10" y2="15" />
          <line x1="14" y1="9" x2="14" y2="15" />
        </svg>
      </div>
      <h2 class="stub-title">{{ $t("pausedRuns.stubTitle") as string }}</h2>
      <p class="stub-body">{{ $t("pausedRuns.stubBody") as string }}</p>
      <p class="stub-meta mono text-xs text-dim">{{ $t("pausedRuns.stubMeta") as string }}</p>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

/**
 * Placeholder for the step-pause inspector page (Spec 62.0a Phase 5).
 * Full UI — list of unresolved step_pauses + 7-action resolve panel — lands in Spec 62.6.
 */
export default defineComponent({
  name: "PausedRunsStubPage",
});
</script>

<style scoped>
.paused-runs-stub {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-6);
  max-width: 720px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.page-title {
  font-size: var(--text-2xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.page-desc {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0;
}

.stub-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8);
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-xl);
  text-align: center;
}

.stub-icon {
  color: var(--text-tertiary);
  opacity: 0.6;
}

.stub-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.stub-body {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 0;
  max-width: 48ch;
}

.stub-meta {
  margin-top: var(--space-2);
}
</style>
