<template>
  <q-select
    v-model="model"
    :options="[]"
    :label="label"
    :hint="hint"
    use-input
    use-chips
    multiple
    new-value-mode="add-unique"
    hide-dropdown-icon
    dense
    outlined
    dark
    input-debounce="0"
    :input-class="model.length === 0 ? '' : 'q-pl-sm'"
  />
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

/**
 * Tag-input style multi-string editor. Marcel types a profession name + Enter
 * to add it; chips render the existing entries with a remove-X button.
 *
 * No autocomplete (the pool is user-defined per definition). The
 * `new-value-mode="add-unique"` prevents duplicate entries.
 */
export default defineComponent({
  name: "ProfessionPoolTagger",

  props: {
    modelValue: { type: Array as PropType<string[]>, default: () => [] },
    label: { type: String, default: "" },
    hint: { type: String, default: "" },
  },

  emits: ["update:modelValue"],

  computed: {
    model: {
      get(): string[] {
        return this.modelValue;
      },
      set(v: string[]) {
        this.$emit("update:modelValue", v);
      },
    },
  },
});
</script>
