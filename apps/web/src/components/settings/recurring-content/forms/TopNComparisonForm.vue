<template>
  <div class="format-form">
    <label class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.topN.categoryLabel") as string }}</span>
      <input
        v-model="categorySlug"
        type="text"
        class="text-input"
        :placeholder="$t('recurringContent.wizard.config.topN.categoryPlaceholder') as string"
        @blur="emit"
      />
      <small class="hint">{{ $t("recurringContent.wizard.config.topN.categoryHint") as string }}</small>
    </label>

    <label class="field">
      <span class="label">
        {{ $t("recurringContent.wizard.config.topN.topNLabel") as string }}
        <span class="value-pill">{{ topN }}</span>
      </span>
      <input
        v-model.number="topN"
        type="range"
        min="3"
        max="10"
        step="1"
        class="slider-input"
        @change="emit"
      />
    </label>

    <label class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.topN.rankingLabel") as string }}</span>
      <select v-model="rankingSource" class="select-input" @change="emit">
        <option value="llm-curated">
          {{ $t("recurringContent.wizard.config.topN.rankingLlm") as string }}
        </option>
        <option value="auto-by-stars">
          {{ $t("recurringContent.wizard.config.topN.rankingStars") as string }}
        </option>
        <option value="manual">
          {{ $t("recurringContent.wizard.config.topN.rankingManual") as string }}
        </option>
      </select>
    </label>

    <div v-if="rankingSource === 'manual'" class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.topN.manualToolsLabel") as string }}</span>
      <ToolPicker
        v-model="manualToolIds"
        :multiple="true"
        :max-values="topN"
        :hint="$t('recurringContent.wizard.config.topN.manualToolsHint', { n: topN }) as string"
        @update:model-value="emit"
      />
    </div>

    <label class="checkbox-row">
      <input
        v-model="excludeRecentlyUsed"
        type="checkbox"
        class="checkbox-input"
        @change="emit"
      />
      <span>{{ $t("recurringContent.wizard.config.topN.excludeRecentlyUsed") as string }}</span>
    </label>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import ToolPicker from "./_shared/ToolPicker.vue";

interface TopNConfig {
  categorySlug?: string;
  topN?: number;
  rankingSource?: "manual" | "auto-by-stars" | "llm-curated";
  manualToolIds?: string[];
  excludeRecentlyUsed?: boolean;
}

export default defineComponent({
  name: "TopNComparisonForm",

  components: { ToolPicker },

  props: {
    modelValue: { type: Object as PropType<TopNConfig>, default: () => ({}) },
  },

  emits: ["update:modelValue"],

  data() {
    return {
      categorySlug: this.modelValue.categorySlug ?? "",
      topN: this.modelValue.topN ?? 5,
      rankingSource: this.modelValue.rankingSource ?? "llm-curated",
      manualToolIds: this.modelValue.manualToolIds ?? ([] as string[]),
      excludeRecentlyUsed: this.modelValue.excludeRecentlyUsed ?? true,
    };
  },

  methods: {
    emit(): void {
      // Build conditionally — `exactOptionalPropertyTypes` rejects
      // `field: value | undefined` when the field is declared as optional.
      const payload: TopNConfig = {
        topN: this.topN,
        rankingSource: this.rankingSource,
        excludeRecentlyUsed: this.excludeRecentlyUsed,
      };
      const trimmed = this.categorySlug.trim();
      if (trimmed) payload.categorySlug = trimmed;
      // Only include manualToolIds when the ranking source is manual — keeps
      // the persisted blob clean when Marcel toggles away from manual.
      if (this.rankingSource === "manual" && this.manualToolIds.length > 0) {
        payload.manualToolIds = this.manualToolIds;
      }
      this.$emit("update:modelValue", payload);
    },
  },
});
</script>

<style scoped>
@import "./_form-shared.scss";
</style>
