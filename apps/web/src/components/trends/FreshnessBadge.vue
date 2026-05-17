<template>
  <span
    class="freshness-badge"
    :class="`freshness-${freshness ?? 'stable'}`"
    :aria-label="$t(`trends.freshness.${freshness ?? 'stable'}`) as string"
  >
    <span class="freshness-icon" aria-hidden="true">{{ icon }}</span>
    <span class="freshness-label">{{ $t(`trends.freshness.${freshness ?? 'stable'}`) as string }}</span>
  </span>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "FreshnessBadge",

  props: {
    freshness: {
      type: String as () => "breaking" | "rising" | "stable" | null,
      default: null,
    },
  },

  computed: {
    icon(): string {
      if (this.freshness === "breaking") return "⚡";
      if (this.freshness === "rising") return "↗";
      return "→";
    },
  },
});
</script>

<style scoped>
.freshness-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
}

.freshness-icon {
  font-size: 10px;
}

/* Breaking — red glow */
.freshness-breaking {
  background: color-mix(in oklch, #ef4444 15%, transparent);
  border-color: color-mix(in oklch, #ef4444 40%, transparent);
  color: #ef4444;
  box-shadow: 0 0 6px color-mix(in oklch, #ef4444 20%, transparent);
}

/* Rising — amber */
.freshness-rising {
  background: color-mix(in oklch, #f59e0b 15%, transparent);
  border-color: color-mix(in oklch, #f59e0b 40%, transparent);
  color: #f59e0b;
}

/* Stable — muted */
.freshness-stable {
  background: var(--bg-glass);
  border-color: var(--border-subtle);
  color: var(--text-tertiary);
}
</style>
