<template>
  <FormInput
    :model-value="modelValue ?? ''"
    :placeholder="$t('articleTools.generate.placeholders.authorSlug') as string"
    autocomplete="off"
    @update:model-value="$emit('update:modelValue', $event || null)"
  />
</template>

<script lang="ts">
import { defineComponent } from "vue";
import FormInput from "src/components/forms/FormInput.vue";

export default defineComponent({
  name: "AuthorPicker",

  components: { FormInput },

  props: {
    modelValue: { type: String, default: null },
  },

  emits: ["update:modelValue"],
});
</script>
