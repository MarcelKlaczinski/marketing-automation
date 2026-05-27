<template>
  <section class="step-shell">
    <header class="step-header">
      <p class="step-eyebrow mono">
        {{ $t("recurringContent.wizard.stepEyebrow", { current: stepNumber, total: 4 }) as string }}
      </p>
      <h2 class="step-title">{{ title }}</h2>
      <p v-if="description" class="step-description">{{ description }}</p>
    </header>

    <div class="step-body">
      <slot />
    </div>

    <footer class="step-footer">
      <q-btn
        v-if="canGoBack"
        flat
        :label="$t('common.back') as string"
        @click="$emit('back')"
      />
      <div class="footer-spacer" />
      <q-btn
        color="primary"
        :label="advanceLabel ?? ($t('common.continue') as string)"
        :loading="busy"
        :disable="!canAdvance"
        @click="$emit('advance')"
      />
    </footer>
  </section>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "WizardStepShell",

  props: {
    stepNumber: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    canGoBack: { type: Boolean, default: true },
    canAdvance: { type: Boolean, default: true },
    busy: { type: Boolean, default: false },
    advanceLabel: { type: String, default: "" },
  },

  emits: ["back", "advance"],
});
</script>

<style scoped>
.step-shell {
  display: flex;
  flex-direction: column;
  gap: 24px;
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 28px;
}

.step-eyebrow {
  margin: 0 0 6px 0;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.step-title {
  margin: 0 0 8px 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.step-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.step-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.footer-spacer {
  flex: 1;
}
</style>
