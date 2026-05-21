<template>
  <div>
    <GlassButton
      variant="primary"
      :loading="loading"
      :disabled="loading"
      @click="openDialog"
    >
      <span v-if="loading">{{ $t("planner.actions.generating") as string }}</span>
      <span v-else>
        {{ $t("planner.empty.cta", { n: isoWeek, year }) as string }}
      </span>
    </GlassButton>

    <q-dialog v-model="showConfirm">
      <div class="confirm-card">
        <h2 class="confirm-title">
          {{ $t("planner.generateConfirm.title", { n: isoWeek, year }) as string }}
        </h2>
        <p class="confirm-body text-secondary">
          {{ $t("planner.generateConfirm.body") as string }}
        </p>

        <!-- Spec 62.6.1: debug-mode toggle. When checked, the runner pauses
             after every pausable step so the user can inspect + resolve via
             the runs UI. -->
        <label class="debug-toggle">
          <input
            v-model="debugMode"
            type="checkbox"
            class="debug-checkbox"
            :disabled="loading"
          />
          <span class="debug-label">
            <strong>{{ $t("planner.generateConfirm.debugToggle") as string }}</strong>
            <span class="debug-hint text-tertiary text-xs">
              {{ $t("planner.generateConfirm.debugHint") as string }}
            </span>
          </span>
        </label>

        <div class="confirm-actions">
          <GlassButton variant="ghost" :disabled="loading" @click="showConfirm = false">
            {{ $t("planner.generateConfirm.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="loading" @click="onConfirm">
            {{ confirmLabel }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";

/**
 * Generate-Plan flow: button → confirm dialog → emit `confirmed`. The parent
 * owns the actual API call (so it can decide on 409-replace prompts etc).
 *
 * Spec 62.6.1: the confirm dialog exposes a "Debug-Mode" checkbox. When
 * checked, `confirmed` fires with `{ debug: true }` so the parent can forward
 * `debug: true` in the POST /plans/generate body. The runner then pauses
 * after every `pausableInDebug()` step for inspection via /runs/:runId.
 */
export default defineComponent({
  name: "PlannerGenerateButton",

  components: { GlassButton },

  emits: {
    confirmed: (payload: { debug: boolean }) =>
      typeof payload?.debug === "boolean",
  },

  props: {
    year: { type: Number, required: true },
    isoWeek: { type: Number, required: true },
    loading: { type: Boolean, default: false },
  },

  data: () => ({
    showConfirm: false,
    debugMode: false,
  }),

  computed: {
    confirmLabel(): string {
      return this.debugMode
        ? (this.$t("planner.generateConfirm.confirmDebug") as string)
        : (this.$t("planner.generateConfirm.confirm") as string);
    },
  },

  methods: {
    openDialog(): void {
      // Always reset the debug toggle on each open so a prior debug run does
      // not silently persist into the next generate click.
      this.debugMode = false;
      this.showConfirm = true;
    },
    onConfirm(): void {
      this.$emit("confirmed", { debug: this.debugMode });
      this.showConfirm = false;
    },
  },
});
</script>

<style scoped>
.confirm-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  width: 480px;
  max-width: 95vw;
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
}

.confirm-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.confirm-body {
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.debug-toggle {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  cursor: pointer;
  transition: border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .debug-toggle:hover {
    border-color: var(--border-strong);
    background: var(--bg-glass-strong);
  }
}

.debug-checkbox {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  margin-top: 2px;
  accent-color: var(--accent-primary, #ffbc00);
  cursor: pointer;
}

.debug-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: var(--text-primary);
}

.debug-hint {
  font-size: 11px;
  line-height: 1.4;
}
</style>
