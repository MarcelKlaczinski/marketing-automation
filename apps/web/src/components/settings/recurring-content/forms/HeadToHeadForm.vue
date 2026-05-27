<template>
  <div class="format-form">
    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.headToHead.toolALabel") as string }}</span>
      <ToolPicker v-model="toolAId" @update:model-value="emit" />
    </div>

    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.headToHead.toolBLabel") as string }}</span>
      <ToolPicker v-model="toolBId" @update:model-value="emit" />
    </div>

    <label class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.headToHead.angleLabel") as string }}</span>
      <input
        v-model="angleHint"
        type="text"
        class="text-input"
        :placeholder="$t('recurringContent.wizard.config.headToHead.anglePlaceholder') as string"
        @blur="emit"
      />
      <small class="hint">{{ $t("recurringContent.wizard.config.headToHead.angleHint") as string }}</small>
    </label>

    <small v-if="sameToolWarning" class="hint hint-error">
      {{ $t("recurringContent.wizard.config.headToHead.sameToolWarning") as string }}
    </small>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import ToolPicker from "./_shared/ToolPicker.vue";

interface HeadToHeadConfig {
  toolAId?: string;
  toolBId?: string;
  angleHint?: string;
}

export default defineComponent({
  name: "HeadToHeadForm",

  components: { ToolPicker },

  props: {
    modelValue: { type: Object as PropType<HeadToHeadConfig>, default: () => ({}) },
  },

  emits: ["update:modelValue"],

  data() {
    return {
      toolAId: (this.modelValue.toolAId ?? null) as string | null,
      toolBId: (this.modelValue.toolBId ?? null) as string | null,
      angleHint: this.modelValue.angleHint ?? "",
    };
  },

  computed: {
    sameToolWarning(): boolean {
      return !!this.toolAId && this.toolAId === this.toolBId;
    },
  },

  methods: {
    emit(): void {
      const payload: HeadToHeadConfig = {};
      if (this.toolAId) payload.toolAId = this.toolAId;
      if (this.toolBId) payload.toolBId = this.toolBId;
      if (this.angleHint.trim()) payload.angleHint = this.angleHint.trim();
      this.$emit("update:modelValue", payload);
    },
  },
});
</script>

<style scoped lang="scss">
@import "./_form-shared.scss";
.hint-error {
  color: var(--text-error);
}
</style>
