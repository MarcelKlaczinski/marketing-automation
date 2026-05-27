<template>
  <div class="format-form">
    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.opinion.toolLabel") as string }}</span>
      <ToolPicker
        v-model="recommendedToolId"
        :hint="$t('recurringContent.wizard.config.opinion.toolHint') as string"
        @update:model-value="emit"
      />
    </div>

    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.opinion.stanceLabel") as string }}</span>
      <div class="radio-stack">
        <label class="radio-item">
          <input v-model="opinionStance" type="radio" value="enthusiastic" @change="emit" />
          <span>{{ $t("recurringContent.wizard.config.opinion.stanceEnthusiastic") as string }}</span>
        </label>
        <label class="radio-item">
          <input v-model="opinionStance" type="radio" value="critical-but-positive" @change="emit" />
          <span>{{ $t("recurringContent.wizard.config.opinion.stanceCritical") as string }}</span>
        </label>
        <label class="radio-item">
          <input v-model="opinionStance" type="radio" value="contrarian" @change="emit" />
          <span>{{ $t("recurringContent.wizard.config.opinion.stanceContrarian") as string }}</span>
        </label>
      </div>
    </div>

    <label class="checkbox-row">
      <input
        v-model="affiliateAngle"
        type="checkbox"
        class="checkbox-input"
        @change="emit"
      />
      <span>{{ $t("recurringContent.wizard.config.opinion.affiliateAngleLabel") as string }}</span>
    </label>
    <small class="hint">{{ $t("recurringContent.wizard.config.opinion.affiliateAngleHint") as string }}</small>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import ToolPicker from "./_shared/ToolPicker.vue";

interface OpinionConfig {
  recommendedToolId?: string;
  opinionStance?: "enthusiastic" | "critical-but-positive" | "contrarian";
  affiliateAngle?: boolean;
}

export default defineComponent({
  name: "OpinionRecommendationForm",

  components: { ToolPicker },

  props: {
    modelValue: { type: Object as PropType<OpinionConfig>, default: () => ({}) },
  },

  emits: ["update:modelValue"],

  data() {
    return {
      recommendedToolId: (this.modelValue.recommendedToolId ?? null) as string | null,
      opinionStance: this.modelValue.opinionStance ?? "enthusiastic",
      affiliateAngle: this.modelValue.affiliateAngle ?? true,
    };
  },

  methods: {
    emit(): void {
      const payload: OpinionConfig = {
        opinionStance: this.opinionStance,
        affiliateAngle: this.affiliateAngle,
      };
      if (this.recommendedToolId) payload.recommendedToolId = this.recommendedToolId;
      this.$emit("update:modelValue", payload);
    },
  },
});
</script>

<style scoped lang="scss">
@import "./_form-shared.scss";
</style>
