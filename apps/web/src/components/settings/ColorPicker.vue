<template>
  <div class="color-picker">
    <label v-if="label" class="cp-label">{{ label }}</label>
    <div class="cp-row">
      <label class="cp-swatch-wrap" :class="{ 'is-empty': isEmpty }">
        <input
          type="color"
          class="cp-swatch"
          :value="effectiveHex"
          :aria-label="label || $t('settings.toolBrandAssets.modal.colorPickerAria') as string"
          @input="onSwatchInput"
        />
        <span v-if="isEmpty" class="cp-empty-icon" aria-hidden="true">+</span>
      </label>
      <input
        type="text"
        class="cp-hex"
        :value="modelValue ?? ''"
        :placeholder="$t('settings.toolBrandAssets.modal.colorPlaceholder') as string"
        spellcheck="false"
        @input="onTextInput"
      />
      <button
        v-if="!isEmpty"
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
    /**
     * Whether the picker has no user-set value. Used to switch the swatch into
     * an empty-state visual (dashed border + "+" icon) instead of showing the
     * `effectiveHex` purple fallback as if it were a saved color.
     */
    isEmpty(): boolean {
      return this.modelValue === null || this.modelValue === "";
    },
    /**
     * The native `<input type="color">` requires a valid hex even when no
     * color is set. We feed it `#7B61FF` as a neutral starting position for
     * the OS color picker — visually hidden via `.is-empty .cp-swatch`
     * opacity:0, so the user never sees the purple in the small swatch.
     */
    effectiveHex(): string {
      if (this.modelValue && HEX_RE.test(this.modelValue)) return this.modelValue;
      return "#7B61FF";
    },
    invalid(): boolean {
      if (this.isEmpty) return false;
      return !HEX_RE.test(this.modelValue ?? "");
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
.cp-swatch-wrap {
  position: relative;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  display: inline-block;
  flex-shrink: 0;
  cursor: pointer;
}
.cp-swatch-wrap.is-empty {
  border-style: dashed;
  background: transparent;
}
.cp-swatch {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: inherit;
  cursor: pointer;
  background: transparent;
  padding: 0;
}
.cp-swatch-wrap.is-empty .cp-swatch {
  opacity: 0;
}
.cp-empty-icon {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  color: var(--text-tertiary);
  font-size: 18px;
  line-height: 1;
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
