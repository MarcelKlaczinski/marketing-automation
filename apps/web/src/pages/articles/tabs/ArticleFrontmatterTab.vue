<template>
  <div class="frontmatter-tab">
    <p class="tab-hint mono">{{ $t("articles.detailTabs.frontmatter") as string }}</p>
    <div v-if="frontmatterExtras && Object.keys(frontmatterExtras).length" class="fields-list">
      <div
        v-for="(value, key) in frontmatterExtras"
        :key="key"
        class="field-row"
      >
        <span class="field-key mono">{{ key }}</span>
        <span class="field-value">{{ formatValue(value) }}</span>
      </div>
    </div>
    <EmptyState
      v-else
      :title="$t('articles.frontmatter.empty') as string"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import EmptyState from "src/components/ui/EmptyState.vue";

export default defineComponent({
  name: "ArticleFrontmatterTab",

  components: { EmptyState },

  props: {
    articleId: { type: String, required: true },
    frontmatterExtras: {
      type: Object as PropType<Record<string, unknown> | null>,
      default: null,
    },
  },

  methods: {
    formatValue(v: unknown): string {
      if (v === null || v === undefined) return "—";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    },
  },
});
</script>

<style scoped>
.frontmatter-tab {
  padding: 16px;
}

.tab-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.fields-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-row {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-glass);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.field-key {
  font-size: 11px;
  color: var(--text-tertiary);
  min-width: 140px;
  flex-shrink: 0;
}

.field-value {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-word;
}
</style>
