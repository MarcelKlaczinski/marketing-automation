<template>
  <GlassCard variant="strong" class="pillar-card">
    <div class="pillar-card-header">
      <span class="pillar-index mono text-dim">{{ index + 1 }}</span>
      <button
        type="button"
        class="pillar-remove-btn"
        :aria-label="$t('common.remove') as string"
        @click="$emit('remove')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <line x1="2" y1="2" x2="12" y2="12" />
          <line x1="12" y1="2" x2="2" y2="12" />
        </svg>
      </button>
    </div>

    <FormField :label="$t('coldStart.pillarCard.name') as string" required>
      <FormInput
        :model-value="pillar.name"
        :placeholder="$t('coldStart.pillarCard.namePlaceholder') as string"
        @update:model-value="emitUpdate('name', $event)"
      />
    </FormField>

    <FormField :label="$t('coldStart.pillarCard.description') as string">
      <FormTextarea
        :model-value="pillar.description"
        :placeholder="$t('coldStart.pillarCard.descriptionPlaceholder') as string"
        :rows="3"
        @update:model-value="emitUpdate('description', $event)"
      />
    </FormField>

    <FormField :label="$t('coldStart.pillarCard.keywords') as string">
      <div class="keyword-list">
        <span
          v-for="(kw, kwIdx) in pillar.keywords"
          :key="kwIdx"
          class="keyword-chip"
        >
          {{ kw }}
          <button
            type="button"
            class="keyword-remove"
            :aria-label="$t('common.remove') as string"
            @click="removeKeyword(kwIdx)"
          >×</button>
        </span>
      </div>
      <div class="keyword-add-row">
        <FormInput
          v-model="newKeyword"
          :placeholder="$t('common.addKeyword') as string"
          @keydown.enter.prevent="addKeyword"
        />
        <button type="button" class="keyword-add-btn" @click="addKeyword">+</button>
      </div>
    </FormField>
  </GlassCard>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FormTextarea from "src/components/forms/FormTextarea.vue";
import type { ColdStartPillar } from "src/types/cold-start";

export default defineComponent({
  name: "PillarCard",

  components: { GlassCard, FormField, FormInput, FormTextarea },

  emits: ["update", "remove"],

  props: {
    pillar: { type: Object as PropType<ColdStartPillar>, required: true },
    index: { type: Number, required: true },
  },

  data: () => ({
    newKeyword: "",
  }),

  methods: {
    emitUpdate(field: keyof ColdStartPillar, value: string): void {
      this.$emit("update", { ...this.pillar, [field]: value });
    },
    addKeyword(): void {
      const kw = this.newKeyword.trim();
      if (!kw) return;
      const keywords = [...(this.pillar.keywords ?? []), kw];
      this.$emit("update", { ...this.pillar, keywords });
      this.newKeyword = "";
    },
    removeKeyword(idx: number): void {
      const keywords = (this.pillar.keywords ?? []).filter((_, i) => i !== idx);
      this.$emit("update", { ...this.pillar, keywords });
    },
  },
});
</script>

<style scoped>
.pillar-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pillar-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pillar-index {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pillar-remove-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .pillar-remove-btn:hover {
    color: var(--status-failed);
    background: var(--status-failed-bg);
  }
}

@media (max-width: 767px) {
  .pillar-remove-btn {
    min-width: 44px;
    min-height: 44px;
  }
}

.keyword-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  min-height: 0;
}

.keyword-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: rgba(124, 92, 255, 0.1);
  border: 1px solid rgba(124, 92, 255, 0.25);
  border-radius: 20px;
  font-size: 12px;
  color: var(--text-primary);
}

.keyword-remove {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  padding: 0;
  display: flex;
  align-items: center;
}

@media (hover: hover) and (pointer: fine) {
  .keyword-remove:hover {
    color: var(--status-failed);
  }
}

.keyword-add-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.keyword-add-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .keyword-add-btn:hover {
    background: var(--bg-glass-hover);
    color: var(--text-primary);
  }
}
</style>
