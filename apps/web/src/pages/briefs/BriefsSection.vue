<template>
  <section class="briefs-section">
    <header class="section-header" @click="toggle">
      <div class="section-title-wrap">
        <h2 class="section-title">{{ title }}</h2>
        <span class="section-count mono">{{ briefs.length }}</span>
      </div>
      <button class="section-toggle" :aria-label="$t('common.toggle') as string">
        <svg
          class="toggle-icon"
          :class="{ rotated: isCollapsed }"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
        >
          <path
            d="M3 5L7 9L11 5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </header>

    <p v-if="!isCollapsed && description" class="section-description">
      {{ description }}
    </p>

    <Transition name="section-expand">
      <div v-if="!isCollapsed" class="section-body">
        <LoadingShimmer v-if="loading && !briefs.length" variant="card" :count="3" />
        <EmptyState
          v-else-if="!briefs.length && !loading"
          :title="emptyTitle"
        />
        <BriefCard
          v-for="brief in briefs"
          :key="brief.id"
          :brief="brief"
          :selectable="selectable"
          :selected="selectedIds.includes(brief.id)"
          @toggle-select="$emit('toggle-select', brief.id)"
          @select="$emit('select', brief)"
        />
        <LoadMoreButton
          v-if="hasMore"
          :has-more="hasMore"
          :loading="loading"
          :total-loaded="briefs.length"
          @load-more="$emit('load-more')"
        />
      </div>
    </Transition>
  </section>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import LoadMoreButton from "src/components/ui/LoadMoreButton.vue";
import BriefCard from "src/components/briefs/BriefCard.vue";
import type { BriefListItem } from "src/types/ui";

export default defineComponent({
  name: "BriefsSection",

  components: { LoadingShimmer, EmptyState, LoadMoreButton, BriefCard },

  emits: ["toggle-select", "select", "load-more"],

  props: {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    sectionKey: { type: String, required: true },
    emptyTitle: { type: String, default: "" },
    selectable: { type: Boolean, default: false },
    collapsed: { type: Boolean, default: false },
    briefs: { type: Array as PropType<BriefListItem[]>, default: () => [] },
    hasMore: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    selectedIds: { type: Array as PropType<string[]>, default: () => [] },
  },

  data() {
    return {
      isCollapsed: this.collapsed,
    };
  },

  methods: {
    toggle(): void {
      this.isCollapsed = !this.isCollapsed;
    },
  },
});
</script>

<style scoped>
.briefs-section {
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 8px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  cursor: pointer;
  user-select: none;
}

.section-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.section-count {
  font-size: 10px;
  color: var(--text-tertiary);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  padding: 1px 6px;
  border-radius: 8px;
}

.section-toggle {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.toggle-icon {
  transition: transform 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.toggle-icon.rotated {
  transform: rotate(-90deg);
}

.section-description {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0 0 8px;
}

.section-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 12px;
}

.section-expand-enter-active,
.section-expand-leave-active {
  transition: opacity 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              max-height 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  max-height: 1000px;
  overflow: hidden;
}

.section-expand-enter-from,
.section-expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
