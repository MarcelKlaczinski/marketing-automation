<template>
  <div class="palette-section">
    <h4 class="section-title label-caps text-xs text-dim">{{ title }}</h4>
    <ul class="section-list" role="listbox">
      <li
        v-for="item in items"
        :key="item.id"
        class="section-item"
        role="option"
        tabindex="0"
        @click="$emit('select', item)"
        @keydown.enter="$emit('select', item)"
        @keydown.space.prevent="$emit('select', item)"
      >
        <span class="item-title text-sm">{{ item.title }}</span>
        <span v-if="item.subtitle" class="item-subtitle text-xs text-dim">
          {{ item.subtitle }}
        </span>
        <span v-if="item.badge" class="item-badge mono text-xs text-dim">
          {{ item.badge }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  href?: string;
}

/**
 * A labelled group of search result items inside CommandPalette.
 * Each item is keyboard navigable and emits 'select' on activation.
 */
export default defineComponent({
  name: "CommandPaletteSection",

  emits: ["select"],

  props: {
    title: {
      type: String,
      required: true,
    },
    items: {
      type: Array as PropType<SearchResultItem[]>,
      required: true,
    },
  },
});
</script>

<style scoped>
.palette-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.section-title {
  margin: 0 0 var(--space-1);
  padding: 0 var(--space-4);
  letter-spacing: 0.06em;
}

.section-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.section-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 8px var(--space-4);
  border-radius: var(--radius-md);
  cursor: pointer;
  outline: none;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
  min-height: 36px;
}

@media (hover: hover) and (pointer: fine) {
  .section-item:hover {
    background: var(--bg-glass-strong);
  }
}

.section-item:focus-visible {
  background: var(--bg-glass-strong);
  box-shadow: inset 0 0 0 1px var(--accent-primary);
}

.item-title {
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.item-subtitle {
  flex-shrink: 0;
  white-space: nowrap;
}

.item-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-glass-strong);
  font-size: 9px;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
</style>
