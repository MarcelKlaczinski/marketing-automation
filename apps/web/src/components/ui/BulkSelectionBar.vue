<template>
  <Transition name="slide-up">
    <div v-if="selectedCount > 0" class="bulk-bar">
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
import GlassButton from "./GlassButton.vue";

export default defineComponent({
  name: "BulkSelectionBar",

  components: { GlassButton },

  emits: ["clear"],

  props: {
    selectedCount: { type: Number, required: true },
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
