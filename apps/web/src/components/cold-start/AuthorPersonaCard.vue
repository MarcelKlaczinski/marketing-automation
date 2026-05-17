<template>
  <GlassCard variant="strong" class="author-card">
    <div class="author-card-header">
      <div class="author-avatar" :aria-label="authorInitials">
        <span class="author-initials">{{ authorInitials }}</span>
      </div>
      <button
        type="button"
        class="author-remove-btn"
        :aria-label="$t('common.remove') as string"
        @click="$emit('remove')"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <line x1="2" y1="2" x2="12" y2="12" />
          <line x1="12" y1="2" x2="2" y2="12" />
        </svg>
      </button>
    </div>

    <div class="author-name-row">
      <FormField :label="$t('coldStart.authorCard.name') as string" required>
        <FormInput
          :model-value="author.name"
          :placeholder="$t('coldStart.authorCard.namePlaceholder') as string"
          @update:model-value="emitUpdate('name', $event)"
        />
      </FormField>
      <FormField :label="$t('coldStart.authorCard.role') as string">
        <FormInput
          :model-value="author.role"
          :placeholder="$t('coldStart.authorCard.rolePlaceholder') as string"
          @update:model-value="emitUpdate('role', $event)"
        />
      </FormField>
    </div>

    <FormField :label="$t('coldStart.authorCard.bio') as string">
      <FormTextarea
        :model-value="author.bio"
        :placeholder="$t('coldStart.authorCard.bioPlaceholder') as string"
        :rows="3"
        @update:model-value="emitUpdate('bio', $event)"
      />
    </FormField>

    <FormField :label="$t('coldStart.authorCard.expertise') as string">
      <div class="topic-list">
        <span
          v-for="(topic, tIdx) in author.expertiseTopics"
          :key="tIdx"
          class="topic-chip"
        >
          {{ topic }}
          <button
            type="button"
            class="topic-remove"
            :aria-label="$t('common.remove') as string"
            @click="removeTopic(tIdx)"
          >×</button>
        </span>
      </div>
      <div class="topic-add-row">
        <FormInput
          v-model="newTopic"
          :placeholder="$t('coldStart.authorCard.addTopic') as string"
          @keydown.enter.prevent="addTopic"
        />
        <button type="button" class="topic-add-btn" @click="addTopic">+</button>
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
import type { ColdStartAuthor } from "src/types/cold-start";

export default defineComponent({
  name: "AuthorPersonaCard",

  components: { GlassCard, FormField, FormInput, FormTextarea },

  emits: ["update", "remove"],

  props: {
    author: { type: Object as PropType<ColdStartAuthor>, required: true },
    index: { type: Number, required: true },
  },

  data: () => ({
    newTopic: "",
  }),

  computed: {
    authorInitials(): string {
      const parts = (this.author.name || "?").split(" ");
      return parts
        .slice(0, 2)
        .map((p) => p[0] ?? "")
        .join("")
        .toUpperCase();
    },
  },

  methods: {
    emitUpdate(field: keyof ColdStartAuthor, value: string): void {
      this.$emit("update", { ...this.author, [field]: value });
    },
    addTopic(): void {
      const topic = this.newTopic.trim();
      if (!topic) return;
      const expertiseTopics = [...(this.author.expertiseTopics ?? []), topic];
      this.$emit("update", { ...this.author, expertiseTopics });
      this.newTopic = "";
    },
    removeTopic(idx: number): void {
      const expertiseTopics = (this.author.expertiseTopics ?? []).filter((_, i) => i !== idx);
      this.$emit("update", { ...this.author, expertiseTopics });
    },
  },
});
</script>

<style scoped>
.author-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.author-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.author-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary, var(--accent-primary)));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.author-initials {
  font-size: 13px;
  font-weight: 700;
  color: white;
}

.author-remove-btn {
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
  .author-remove-btn:hover {
    color: var(--status-failed);
    background: var(--status-failed-bg);
  }
}

@media (max-width: 767px) {
  .author-remove-btn {
    min-width: 44px;
    min-height: 44px;
  }
}

.author-name-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 480px) {
  .author-name-row {
    grid-template-columns: 1fr;
  }
}

.topic-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.topic-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  background: rgba(220, 38, 127, 0.08);
  border: 1px solid rgba(220, 38, 127, 0.2);
  border-radius: 20px;
  font-size: 12px;
  color: var(--text-primary);
}

.topic-remove {
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
  .topic-remove:hover {
    color: var(--status-failed);
  }
}

.topic-add-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.topic-add-btn {
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
  .topic-add-btn:hover {
    background: var(--bg-glass-hover);
    color: var(--text-primary);
  }
}
</style>
