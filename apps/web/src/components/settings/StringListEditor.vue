<template>
  <div class="string-list-editor">
    <div v-if="modelValue.length > 0" class="pills">
      <span
        v-for="(item, i) in modelValue"
        :key="item + String(i)"
        class="pill"
      >
        {{ item }}
        <button
          type="button"
          class="pill-remove"
          :aria-label="$t('common.remove') as string"
          @click="onRemove(i)"
        >
          ×
        </button>
      </span>
    </div>

    <div class="add-row">
      <input
        v-model="newItem"
        type="text"
        class="add-input"
        :placeholder="placeholder"
        @keydown.enter.prevent="onAdd"
      />
      <GlassButton
        variant="ghost"
        size="sm"
        :disabled="!canAdd"
        @click="onAdd"
      >
        {{ $t("common.add") as string }}
      </GlassButton>
    </div>

    <p v-if="isDuplicate" class="hint-error">
      {{ $t("settings.signalSources.duplicateItem") as string }}
    </p>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";

export default defineComponent({
  name: "StringListEditor",

  components: { GlassButton },

  emits: ["update:modelValue"],

  props: {
    modelValue: { type: Array as PropType<string[]>, default: () => [] },
    placeholder: { type: String, default: "" },
  },

  data: () => ({
    newItem: "",
  }),

  computed: {
    isDuplicate(): boolean {
      const trimmed = this.newItem.trim();
      return !!trimmed && this.modelValue.includes(trimmed);
    },
    canAdd(): boolean {
      return !!this.newItem.trim() && !this.isDuplicate;
    },
  },

  methods: {
    onAdd() {
      const trimmed = this.newItem.trim();
      if (!trimmed || this.isDuplicate) return;
      this.$emit("update:modelValue", [...this.modelValue, trimmed]);
      this.newItem = "";
    },

    onRemove(index: number) {
      const next = [...this.modelValue];
      next.splice(index, 1);
      this.$emit("update:modelValue", next);
    },
  },
});
</script>

<style scoped>
.string-list-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: color-mix(in oklch, var(--brand, #6366f1) 15%, transparent);
  border: 1px solid color-mix(in oklch, var(--brand, #6366f1) 30%, transparent);
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-primary);
}

.pill-remove {
  background: none;
  border: none;
  padding: 0;
  line-height: 1;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 14px;
  display: flex;
  align-items: center;
  transition: color 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .pill-remove:hover {
    color: var(--text-primary);
  }
}

.add-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.add-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--glass-bg, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm, 6px);
  color: var(--text-primary);
  outline: none;
  transition: border-color 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.add-input:focus {
  border-color: var(--brand, #6366f1);
}

.add-input::placeholder {
  color: var(--text-tertiary);
}

.hint-error {
  font-size: 11px;
  color: var(--status-failed, #f87171);
  margin: 0;
}
</style>
