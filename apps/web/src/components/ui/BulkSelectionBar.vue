<template>
  <Transition name="slide-up">
    <div v-if="selectedCount > 0" class="bulk-bar">
      <!--
        Spec 64.17: "Select all N matching filter" banner. Renders only when
        ALL visible cards are checkbox-selected AND the server reports more
        rows match the current filter than the user has actually selected.
        Click switches the parent into Mode-2 (virtual selection by filter).
      -->
      <div
        v-if="showSelectAllMatching"
        class="select-all-row"
        role="button"
        tabindex="0"
        @click="$emit('select-all-matching')"
        @keydown.enter.prevent="$emit('select-all-matching')"
        @keydown.space.prevent="$emit('select-all-matching')"
      >
        <span class="select-all-text">
          {{ $t("briefs.bulk.selectAllMatching", { n: totalInFilter }) as string }}
        </span>
      </div>

      <div
        v-else-if="selectAllMatching"
        class="select-all-row select-all-row--active"
        role="status"
        :aria-label="$t('briefs.bulk.selectAllMatchingActive', { n: selectedCount }) as string"
      >
        <span class="select-all-text">
          {{ $t("briefs.bulk.selectAllMatchingActive", { n: selectedCount }) as string }}
        </span>
      </div>

      <div class="bulk-count">
        <span class="count-num mono">{{ selectedCount }}</span>
        {{ $t("common.selected") }}
      </div>
      <div class="bulk-actions">
        <slot name="actions" />
      </div>
      <GlassButton variant="ghost" @click="$emit('clear')">
        {{ $t("common.cancel") }}
      </GlassButton>
    </div>
  </Transition>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import GlassButton from "./GlassButton.vue";

export default defineComponent({
  name: "BulkSelectionBar",

  components: { GlassButton },

  emits: ["clear", "select-all-matching"],

  props: {
    selectedCount: { type: Number, required: true },
    /**
     * Spec 64.17 — total row count matching the active filter on the server.
     * `null` (default) means the parent hasn't fetched a server-side total and
     * the select-all-matching affordance stays hidden. When set AND
     * `totalInFilter > selectedCount`, the banner row offers Mode-2 promotion.
     */
    totalInFilter: {
      type: Number as unknown as PropType<number | null>,
      default: null,
    },
    /**
     * True when the parent has already promoted the selection to "all matching
     * filter" mode. Renders a passive confirmation row instead of the
     * clickable promotion banner.
     */
    selectAllMatching: { type: Boolean, default: false },
  },

  computed: {
    showSelectAllMatching(): boolean {
      // Hide the banner once the user opts in — the `selectAllMatching` branch
      // above renders the passive confirmation instead.
      if (this.selectAllMatching) return false;
      if (this.totalInFilter === null) return false;
      return this.totalInFilter > this.selectedCount;
    },
  },
});
</script>

<style scoped>
.bulk-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-soft);
  background: var(--bg-overlay);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  box-shadow: var(--shadow-elevated), 0 0 0 1px rgba(124, 92, 255, 0.2);
  white-space: nowrap;
}

.select-all-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-md);
  background: rgba(124, 92, 255, 0.12);
  color: var(--accent-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition:
    background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    transform 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .select-all-row:hover {
    background: rgba(124, 92, 255, 0.22);
  }
}

.select-all-row:active {
  transform: scale(0.97);
}

.select-all-row:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.select-all-row--active {
  background: rgba(124, 92, 255, 0.2);
  cursor: default;
}

.select-all-row--active:active {
  transform: none;
}

.select-all-text {
  line-height: 1.3;
}

.bulk-count {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.count-num {
  font-weight: 700;
  color: var(--accent-primary);
  font-size: 14px;
}

.bulk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Slide-up transition */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 240ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              opacity 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateX(-50%) translateY(20px);
  opacity: 0;
}

.slide-up-enter-to,
.slide-up-leave-from {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}
</style>
