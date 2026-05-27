<template>
  <div class="format-form">
    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.storyArc.professionPoolLabel") as string }}</span>
      <ProfessionPoolTagger
        v-model="professionPool"
        :hint="$t('recurringContent.wizard.config.storyArc.professionPoolHint') as string"
        @update:model-value="emit"
      />
    </div>

    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.storyArc.toolLabel") as string }}</span>
      <ToolPicker
        v-model="toolToFeature"
        :hint="$t('recurringContent.wizard.config.storyArc.toolHint') as string"
        @update:model-value="emit"
      />
    </div>

    <label class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.storyArc.angleLabel") as string }}</span>
      <select v-model="narrativeAngle" class="select-input" @change="emit">
        <option value="career-disruption">
          {{ $t("recurringContent.wizard.config.storyArc.angleCareerDisruption") as string }}
        </option>
        <option value="productivity-transformation">
          {{ $t("recurringContent.wizard.config.storyArc.angleProductivity") as string }}
        </option>
        <option value="lifestyle-shift">
          {{ $t("recurringContent.wizard.config.storyArc.angleLifestyle") as string }}
        </option>
      </select>
    </label>

    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.storyArc.toneLabel") as string }}</span>
      <div class="radio-stack">
        <label class="radio-item">
          <input v-model="toneIntensity" type="radio" value="dramatic" @change="emit" />
          <span>{{ $t("recurringContent.wizard.config.storyArc.toneDramatic") as string }}</span>
        </label>
        <label class="radio-item">
          <input v-model="toneIntensity" type="radio" value="subtle" @change="emit" />
          <span>{{ $t("recurringContent.wizard.config.storyArc.toneSubtle") as string }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import ToolPicker from "./_shared/ToolPicker.vue";
import ProfessionPoolTagger from "./_shared/ProfessionPoolTagger.vue";

interface StoryArcConfig {
  professionPool?: string[];
  toolToFeature?: string;
  narrativeAngle?: "career-disruption" | "productivity-transformation" | "lifestyle-shift";
  toneIntensity?: "dramatic" | "subtle";
}

export default defineComponent({
  name: "StoryArcClickbaitForm",

  components: { ToolPicker, ProfessionPoolTagger },

  props: {
    modelValue: { type: Object as PropType<StoryArcConfig>, default: () => ({}) },
  },

  emits: ["update:modelValue"],

  data() {
    return {
      professionPool: this.modelValue.professionPool ?? ([] as string[]),
      toolToFeature: (this.modelValue.toolToFeature ?? null) as string | null,
      narrativeAngle: this.modelValue.narrativeAngle ?? "career-disruption",
      toneIntensity: this.modelValue.toneIntensity ?? "dramatic",
    };
  },

  methods: {
    emit(): void {
      const payload: StoryArcConfig = {
        professionPool: this.professionPool,
        narrativeAngle: this.narrativeAngle,
        toneIntensity: this.toneIntensity,
      };
      if (this.toolToFeature) payload.toolToFeature = this.toolToFeature;
      this.$emit("update:modelValue", payload);
    },
  },
});
</script>

<style scoped lang="scss">
@import "./_form-shared.scss";
</style>
