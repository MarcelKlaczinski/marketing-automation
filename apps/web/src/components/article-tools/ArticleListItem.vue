<template>
  <button
    class="article-list-item"
    :class="{ selected }"
    @click="$emit('click')"
  >
    <div class="item-content">
      <p class="item-title">{{ article.title ?? article.slug }}</p>
      <div class="item-meta mono">
        <span>{{ article.collection }}</span>
        <span class="sep">·</span>
        <span>{{ article.locale }}</span>
        <span class="sep">·</span>
        <span>{{ article.status }}</span>
      </div>
    </div>
  </button>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";

interface ArticleListEntry {
  id: string;
  slug: string;
  title: string | null;
  collection: string;
  locale: string;
  status: string;
}

export default defineComponent({
  name: "ArticleListItem",

  props: {
    article: { type: Object as PropType<ArticleListEntry>, required: true },
    selected: { type: Boolean, default: false },
  },

  emits: ["click"],
});
</script>

<style scoped>
.article-list-item {
  display: block;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  text-align: left;
  transition: background 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .article-list-item:hover {
    background: var(--surface-secondary, rgba(255, 255, 255, 0.04));
  }
}

.article-list-item.selected {
  background: color-mix(in oklch, var(--accent-primary, #7c5cff) 12%, transparent);
}

.item-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.sep {
  opacity: 0.4;
}
</style>
