<template>
  <div class="phase-shell">
    <GlassCard variant="elevated" class="phase-card">
      <header class="phase-card-header">
        <span class="phase-eyebrow mono">
          {{ $t("coldStart.phaseLabel", { current: currentPhase, total: 5 }) as string }}
        </span>
        <h2 class="phase-card-title">{{ title }}</h2>
        <p v-if="description" class="phase-card-description">{{ description }}</p>
      </header>

      <main class="phase-card-body">
        <slot />
      </main>

      <footer class="phase-card-footer">
        <GlassButton
          v-if="canGoBack"
          variant="ghost"
          :disabled="busy"
          @click="$emit('back')"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <polyline points="9,2 4,7 9,12" />
          </svg>
          {{ $t("common.back") as string }}
        </GlassButton>

        <div class="footer-spacer" />

        <GlassButton
          v-if="canSkip"
          variant="ghost"
          :disabled="busy"
          @click="$emit('skip')"
        >
          {{ $t("coldStart.skip") as string }}
        </GlassButton>

        <GlassButton
          variant="primary"
          :loading="busy"
          :disabled="!canAdvance"
          @click="$emit('advance')"
        >
          {{ computedAdvanceLabel }}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <polyline points="5,2 10,7 5,12" />
          </svg>
        </GlassButton>
      </footer>
    </GlassCard>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";

export default defineComponent({
  name: "PhaseShell",

  components: { GlassCard, GlassButton },

  emits: ["back", "advance", "skip"],

  props: {
    currentPhase: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    canGoBack: { type: Boolean, default: true },
    canSkip: { type: Boolean, default: false },
    canAdvance: { type: Boolean, default: true },
    busy: { type: Boolean, default: false },
    advanceLabel: { type: String, default: "" },
  },

  computed: {
    computedAdvanceLabel(): string {
      return this.advanceLabel || (this.$t("common.continue") as string);
    },
  },
});
</script>

<style scoped>
.phase-shell {
  width: 100%;
  max-width: 640px;
}

.phase-card {
  padding: 40px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.phase-card-header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.phase-eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
}

.phase-card-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 12px 0 8px;
  background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-primary) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.phase-card-description {
  font-size: 14px;
  color: var(--text-secondary);
  max-width: 480px;
  margin: 0 auto;
  line-height: 1.6;
}

.phase-card-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.phase-card-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.footer-spacer {
  flex: 1;
}

@media (max-width: 768px) {
  .phase-card {
    padding: 24px;
  }

  .phase-card-title {
    font-size: 22px;
  }
}

@media (max-width: 480px) {
  .phase-card-footer {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .footer-spacer {
    display: none;
  }

  .phase-card-footer :deep(.glass-button) {
    width: 100%;
    justify-content: center;
    min-height: 44px;
  }
}
</style>
