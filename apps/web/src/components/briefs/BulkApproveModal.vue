<template>
  <q-dialog v-model="isOpen" @hide="onHide">
    <div class="bulk-approve-modal">
      <h2 class="modal-title">{{ $t("briefs.bulk.confirmTitle") as string }}</h2>
      <p class="modal-description">
        {{ $t("briefs.bulk.confirmDescription", { count: briefIds.length }) as string }}
      </p>

      <div class="mode-selector">
        <label class="mode-option" :class="{ 'mode-active': mode === 'assist' }">
          <input type="radio" v-model="mode" value="assist" class="mode-radio" />
          <div class="mode-content">
            <span class="mode-label">{{ $t("briefs.bulk.modeAssist") as string }}</span>
          </div>
        </label>
        <label class="mode-option" :class="{ 'mode-active': mode === 'auto' }">
          <input type="radio" v-model="mode" value="auto" class="mode-radio" />
          <div class="mode-content">
            <span class="mode-label">{{ $t("briefs.bulk.modeAuto") as string }}</span>
          </div>
        </label>
      </div>

      <div class="modal-actions">
        <GlassButton variant="ghost" :disabled="processing" @click="close">
          {{ $t("common.cancel") as string }}
        </GlassButton>
        <GlassButton variant="primary" :loading="processing" @click="confirm">
          {{ $t("briefs.bulk.confirm") as string }}
        </GlassButton>
      </div>
    </div>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";

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
    mode: "assist" as "assist" | "auto",
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
      this.$emit("confirm", { mode: this.mode });
    },
    onHide(): void {
      this.mode = "assist";
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
  width: 380px;
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

.mode-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.mode-active {
  border-color: var(--accent-primary);
  background: rgba(var(--accent-primary-rgb, 99, 102, 241), 0.06);
}

.mode-radio {
  accent-color: var(--accent-primary);
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.mode-label {
  font-size: 13px;
  color: var(--text-primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
