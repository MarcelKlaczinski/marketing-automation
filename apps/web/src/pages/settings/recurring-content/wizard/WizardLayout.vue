<template>
  <div class="wizard-layout">
    <header class="wizard-header">
      <button class="wizard-cancel" type="button" @click="onCancel">
        {{ $t("common.cancel") as string }}
      </button>
      <h1 class="wizard-title">
        {{ $t("recurringContent.wizard.title") as string }}
      </h1>
      <div class="wizard-spacer" />
    </header>

    <nav class="wizard-progress" :aria-label="$t('recurringContent.wizard.progressLabel') as string">
      <ol class="step-list">
        <li
          v-for="(step, idx) in steps"
          :key="step.key"
          :class="stepClass(idx)"
        >
          <button
            class="step-button"
            type="button"
            :disabled="idx > furthestStep"
            @click="goToStep(idx)"
          >
            <span class="step-index">{{ idx + 1 }}</span>
            <span class="step-label">{{ $t(step.labelKey) as string }}</span>
          </button>
        </li>
      </ol>
    </nav>

    <main class="wizard-body">
      <div v-if="showRestoreDialog" class="restore-banner">
        <p>{{ $t("recurringContent.wizard.restorePrompt") as string }}</p>
        <div class="restore-actions">
          <q-btn
            flat
            dense
            :label="$t('recurringContent.wizard.restoreDiscard') as string"
            @click="onDiscardDraft"
          />
          <q-btn
            color="primary"
            dense
            :label="$t('recurringContent.wizard.restoreContinue') as string"
            @click="onContinueDraft"
          />
        </div>
      </div>

      <router-view v-else />
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRecurringWizardDraftStore } from "src/stores/recurring-wizard-draft";

const STEPS = [
  { key: "format-type", labelKey: "recurringContent.wizard.steps.formatType" },
  { key: "config", labelKey: "recurringContent.wizard.steps.config" },
  { key: "schedule", labelKey: "recurringContent.wizard.steps.schedule" },
  { key: "review", labelKey: "recurringContent.wizard.steps.review" },
] as const;

export default defineComponent({
  name: "WizardLayout",

  data: () => ({
    showRestoreDialog: false,
    steps: STEPS,
  }),

  computed: {
    slug(): string {
      const v = this.$route.params.slug;
      return Array.isArray(v) ? (v[0] ?? "") : v ?? "";
    },

    store() {
      return useRecurringWizardDraftStore();
    },

    furthestStep(): number {
      return this.store.draft.furthestStep;
    },

    currentStepIndex(): number {
      const seg = (this.$route.name as string) ?? "";
      const i = STEPS.findIndex((s) => `wizard-step-${s.key}` === seg);
      return i === -1 ? 0 : i;
    },
  },

  mounted() {
    this.store.loadDraft(this.slug);
    this.showRestoreDialog = this.store.hasRestorableDraft;

    // Persist on browser close so an interrupted user keeps their progress.
    globalThis.addEventListener("beforeunload", this.onBeforeUnload);
  },

  beforeUnmount() {
    globalThis.removeEventListener("beforeunload", this.onBeforeUnload);
  },

  methods: {
    stepClass(idx: number): Record<string, boolean> {
      return {
        "step-item": true,
        "step-current": idx === this.currentStepIndex,
        "step-reached": idx <= this.furthestStep,
        "step-locked": idx > this.furthestStep,
      };
    },

    goToStep(idx: number): void {
      if (idx > this.furthestStep) return;
      const step = STEPS[idx];
      if (!step) return;
      void this.$router.push({
        name: `wizard-step-${step.key}`,
        params: { slug: this.slug },
      });
    },

    onCancel(): void {
      this.$q.dialog({
        title: this.$t("recurringContent.wizard.cancelTitle") as string,
        message: this.$t("recurringContent.wizard.cancelMessage") as string,
        cancel: { flat: true, color: "white" },
        ok: { color: "negative", label: this.$t("common.discard") as string },
        dark: true,
      }).onOk(() => {
        this.store.clearDraft();
        void this.$router.push({ name: "settings-recurring-content", params: { slug: this.slug } });
      });
    },

    onContinueDraft(): void {
      this.showRestoreDialog = false;
      // Jump to the furthest step reached so Marcel picks up where he left off.
      this.goToStep(this.store.draft.furthestStep);
    },

    onDiscardDraft(): void {
      this.store.discardRestorable();
      this.showRestoreDialog = false;
    },

    onBeforeUnload(): void {
      // Pinia store already writes to LocalStorage on every patch — the
      // beforeunload listener is belt-and-suspenders for the edge case
      // where a pending patch hasn't flushed yet. The Pinia patchDraft
      // is synchronous so this is mostly a no-op.
    },
  },
});
</script>

<style scoped>
.wizard-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  color: var(--text-primary);
}

.wizard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--border-subtle);
}

.wizard-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.wizard-cancel {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  transition: background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.wizard-cancel:hover {
  background: var(--surface-hover);
}

.wizard-spacer {
  width: 60px;
}

.wizard-progress {
  padding: 16px 24px 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.step-list {
  display: flex;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
  max-width: 720px;
  margin-inline: auto;
}

.step-item {
  flex: 1;
}

.step-button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-subtle);
  border: 1px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition:
    border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
.step-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.step-current .step-button {
  border-color: var(--brand-primary);
  background: color-mix(in oklch, var(--brand-primary) 12%, transparent);
  color: var(--text-primary);
}
.step-reached .step-button:not(:disabled):hover {
  background: var(--surface-hover);
}

.step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface-strong);
  font-size: 12px;
  font-weight: 600;
}
.step-current .step-index {
  background: var(--brand-primary);
  color: var(--brand-primary-contrast, #fff);
}

.step-label {
  font-size: 13px;
  font-weight: 500;
}

.wizard-body {
  flex: 1;
  padding: 32px 24px;
  max-width: 720px;
  width: 100%;
  margin-inline: auto;
}

.restore-banner {
  background: color-mix(in oklch, var(--brand-primary) 10%, var(--surface-subtle));
  border: 1px solid var(--brand-primary);
  border-radius: 10px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.restore-banner p {
  margin: 0;
  font-size: 14px;
}
.restore-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
