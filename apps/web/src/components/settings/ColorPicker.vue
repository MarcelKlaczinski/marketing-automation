<template>
  <div class="color-picker">
    <label v-if="label" class="cp-label">{{ label }}</label>
    <div class="cp-row">
      <input
        type="color"
        class="cp-swatch"
        :value="effectiveHex"
        :aria-label="label || $t('settings.toolBrandAssets.modal.colorPickerAria') as string"
        @input="onSwatchInput"
      />
      <input
        type="text"
        class="cp-hex"
        :value="modelValue ?? ''"
        :placeholder="$t('settings.toolBrandAssets.modal.colorPlaceholder') as string"
        spellcheck="false"
        @input="onTextInput"
      />
      <button
        v-if="modelValue !== null"
        type="button"
        class="cp-clear"
        :aria-label="$t('settings.toolBrandAssets.modal.clearColor') as string"
        @click="$emit('update:modelValue', null)"
      >
        ×
      </button>
    </div>
    <div v-if="invalid" class="cp-error">
      {{ $t("settings.toolBrandAssets.modal.invalidHex") as string }}
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default defineComponent({
  name: "ColorPicker",

  props: {
    modelValue: {
      type: String as unknown as PropType<string | null>,
      default: null,
    },
    label: { type: String, default: "" },
  },

  emits: ["update:modelValue"],

  computed: {
    effectiveHex(): string {
      if (this.modelValue && HEX_RE.test(this.modelValue)) return this.modelValue;
      return "#7B61FF";
    },
    invalid(): boolean {
      if (this.modelValue === null || this.modelValue === "") return false;
      return !HEX_RE.test(this.modelValue);
    },
  },

  methods: {
    onSwatchInput(e: Event): void {
      const value = (e.target as HTMLInputElement).value.toUpperCase();
      this.$emit("update:modelValue", value);
    },
    onTextInput(e: Event): void {
      const raw = (e.target as HTMLInputElement).value.trim();
      this.$emit("update:modelValue", raw === "" ? null : raw);
    },
  },
});
</script>

<style scoped>
.color-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cp-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.cp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cp-swatch {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: transparent;
  padding: 0;
}
.cp-hex {
  flex: 1;
  height: 36px;
  padding: 0 10px;
  background: var(--bg-glass);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono, monospace);
  font-size: 13px;
}
.cp-clear {
  width: 28px;
  height: 28px;
  background: transparent;
  color: var(--text-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.cp-error {
  font-size: 11px;
  color: var(--color-danger, #ef4444);
}
</style>
