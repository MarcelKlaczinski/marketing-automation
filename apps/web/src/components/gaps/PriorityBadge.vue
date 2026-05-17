<template>
  <span
    class="priority-badge"
    :class="`priority-${priority}`"
    :aria-label="$t(`gaps.priority.${priority}`) as string"
  >
    <span class="priority-dot" aria-hidden="true" />
    <span class="priority-label">{{ $t(`gaps.priority.${priority}`) as string }}</span>
  </span>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "PriorityBadge",

  props: {
    priority: { type: Number as () => 1 | 2 | 3, required: true },
  },
});
</script>

<style scoped>
.priority-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.priority-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.priority-1 .priority-dot { background: #ef4444; }
.priority-2 .priority-dot { background: #f59e0b; }
.priority-3 .priority-dot { background: var(--text-tertiary); }

.priority-1 .priority-label { color: #ef4444; }
.priority-2 .priority-label { color: #f59e0b; }
</style>
