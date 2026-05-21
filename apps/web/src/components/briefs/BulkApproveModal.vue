<template>
  <q-dialog v-model="isOpen" @hide="onHide">
    <div class="bulk-approve-modal">
      <h2 class="modal-title">{{ $t("briefs.bulk.confirmTitle") as string }}</h2>
      <p class="modal-description">
        {{ $t("briefs.bulk.confirmDescription", { count: briefIds.length }) as string }}
      </p>

      <!-- Spec 63.6: dispatch picker — 'plan' (default, safer) vs 'immediate' (override). -->
      <div class="dispatch-selector" role="radiogroup" :aria-label="$t('briefs.bulkApprove.dispatchLabel') as string">
        <label class="dispatch-option" :class="{ 'dispatch-active': dispatch === 'plan' }">
          <input type="radio" v-model="dispatch" value="plan" class="dispatch-radio" />
          <div class="dispatch-content">
            <span class="dispatch-label">{{ $t("briefs.bulkApprove.plan") as string }}</span>
            <span class="dispatch-hint">{{ $t("briefs.bulkApprove.planHint") as string }}</span>
          </div>
        </label>
        <label class="dispatch-option" :class="{ 'dispatch-active': dispatch === 'immediate' }">
          <input type="radio" v-model="dispatch" value="immediate" class="dispatch-radio" />
          <div class="dispatch-content">
            <span class="dispatch-label">{{ $t("briefs.bulkApprove.immediate") as string }}</span>
            <span class="dispatch-hint dispatch-hint--warn">
              {{ $t("briefs.bulkApprove.immediateHint") as string }}
            </span>
          </div>
        </label>
      </div>

      <div class="modal-actions">
        <GlassButton variant="ghost" :disabled="processing" @click="close">
          {{ $t("common.cancel") as string }}
        </GlassButton>
        <GlassButton
          :variant="dispatch === 'immediate' ? 'secondary' : 'primary'"
          :loading="processing"
          @click="confirm"
        >
          {{
            dispatch === "immediate"
              ? ($t("briefs.bulkApprove.immediate") as string)
              : ($t("briefs.bulkApprove.plan") as string)
          }}
        </GlassButton>
      </div>
    </div>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";

export type Dispatch = "plan" | "immediate";

export default defineComponent({
  name: "BulkApproveModal",

  components: { GlassButton },

  props: {
    modelValue: { type: Boolean, required: true },
    briefIds: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    processing: { type: Boolean, default: false },
  },

  emits: ["update:modelValue", "confirm"],

  data: () => ({
    // Spec 63.6: default to 'plan' — the safer path that respects the Budget Gate.
    dispatch: "plan" as Dispatch,
  }),

  computed: {
    isOpen: {
      get(): boolean {
        return this.modelValue;
      },
      set(val: boolean): void {
        this.$emit("update:modelValue", val);
      },
    },
  },

  methods: {
    close(): void {
      this.isOpen = false;
    },
    confirm(): void {
      // `mode` is still emitted for back-compat with the existing handler signature;
      // the bulk-approve endpoint accepts assist/auto/plan/immediate independently.
      this.$emit("confirm", { dispatch: this.dispatch, mode: "assist" as const });
    },
    onHide(): void {
      this.dispatch = "plan";
    },
  },
});
</script>

<style scoped>
.bulk-approve-modal {
  background: var(--bg-surface);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 440px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.modal-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.dispatch-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dispatch-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.dispatch-active {
  border-color: var(--accent-primary);
  background: rgba(var(--accent-primary-rgb, 99, 102, 241), 0.06);
}

.dispatch-radio {
  accent-color: var(--accent-primary);
  width: 16px;
  height: 16px;
  margin-top: 2px;
  flex-shrink: 0;
}

.dispatch-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dispatch-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.dispatch-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.dispatch-hint--warn {
  color: var(--warn-fg, #d97706);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
