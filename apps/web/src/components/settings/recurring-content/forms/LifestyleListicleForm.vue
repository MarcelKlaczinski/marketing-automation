<template>
  <div class="format-form">
    <label class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.lifestyle.lifeAreaLabel") as string }}</span>
      <input
        v-model="lifeArea"
        type="text"
        class="text-input"
        :placeholder="$t('recurringContent.wizard.config.lifestyle.lifeAreaPlaceholder') as string"
        @blur="emit"
      />
      <small class="hint">{{ $t("recurringContent.wizard.config.lifestyle.lifeAreaHint") as string }}</small>
    </label>

    <label class="field">
      <span class="label">
        {{ $t("recurringContent.wizard.config.lifestyle.itemCountLabel") as string }}
        <span class="value-pill">{{ itemCount }}</span>
      </span>
      <input
        v-model.number="itemCount"
        type="range"
        min="3"
        max="10"
        step="1"
        class="slider-input"
        @change="emit"
      />
    </label>

    <details class="filter-collapse">
      <summary>{{ $t("recurringContent.wizard.config.lifestyle.filterHeading") as string }}</summary>
      <div class="filter-body">
        <label class="field">
          <span class="label">{{ $t("recurringContent.wizard.config.lifestyle.categoryFilterLabel") as string }}</span>
          <input
            v-model="categoryFilterRaw"
            type="text"
            class="text-input"
            :placeholder="$t('recurringContent.wizard.config.lifestyle.categoryFilterPlaceholder') as string"
            @blur="emit"
          />
          <small class="hint">{{ $t("recurringContent.wizard.config.lifestyle.categoryFilterHint") as string }}</small>
        </label>

        <label class="field">
          <span class="label">{{ $t("recurringContent.wizard.config.lifestyle.personaFilterLabel") as string }}</span>
          <input
            v-model="personaFilter"
            type="text"
            class="text-input"
            :placeholder="$t('recurringContent.wizard.config.lifestyle.personaFilterPlaceholder') as string"
            @blur="emit"
          />
        </label>
      </div>
    </details>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface LifestyleConfig {
  lifeArea?: string;
  itemCount?: number;
  toolFilter?: {
    categorySlugs?: string[];
    personaFilter?: string;
  };
}

export default defineComponent({
  name: "LifestyleListicleForm",

  props: {
    modelValue: { type: Object as PropType<LifestyleConfig>, default: () => ({}) },
  },

  emits: ["update:modelValue"],

  data() {
    return {
      lifeArea: this.modelValue.lifeArea ?? "",
      itemCount: this.modelValue.itemCount ?? 5,
      categoryFilterRaw: (this.modelValue.toolFilter?.categorySlugs ?? []).join(", "),
      personaFilter: this.modelValue.toolFilter?.personaFilter ?? "",
    };
  },

  methods: {
    emit(): void {
      // Build conditionally — `exactOptionalPropertyTypes` rejects
      // `field: value | undefined` when the field is declared as optional.
      const payload: LifestyleConfig = {
        itemCount: this.itemCount,
      };
      const trimmedLifeArea = this.lifeArea.trim();
      if (trimmedLifeArea) payload.lifeArea = trimmedLifeArea;
      // Parse the comma-separated category-slugs input + trim.
      const categorySlugs = this.categoryFilterRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const personaFilter = this.personaFilter.trim();
      if (categorySlugs.length > 0 || personaFilter) {
        payload.toolFilter = {};
        if (categorySlugs.length > 0) payload.toolFilter.categorySlugs = categorySlugs;
        if (personaFilter) payload.toolFilter.personaFilter = personaFilter;
      }
      this.$emit("update:modelValue", payload);
    },
  },
});
</script>

<style scoped lang="scss">
@import "./_form-shared.scss";

.filter-collapse {
  background: var(--surface-strong);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 10px 14px;
}
.filter-collapse summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  user-select: none;
}
.filter-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}
</style>
