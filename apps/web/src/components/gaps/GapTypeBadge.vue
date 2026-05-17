<template>
  <span class="gap-type-badge" :class="`gap-type-${type}`">
    <span class="badge-icon" aria-hidden="true">{{ icon }}</span>
    <span class="badge-label">{{ $t(`clusters.gapType.${type}`) as string }}</span>
  </span>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { GapType } from "src/composables/useClusterGaps";

const ICONS: Record<GapType, string> = {
  missing_hub: "♛",
  missing_spoke_type: "◉",
  missing_translation: "⇄",
  cluster_too_small: "⊕",
};

export default defineComponent({
  name: "GapTypeBadge",

  props: {
    type: { type: String as () => GapType, required: true },
  },

  computed: {
    icon(): string {
      return ICONS[this.type] ?? "·";
    },
  },
});
</script>

<style scoped>
.gap-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid transparent;
}

.gap-type-missing_hub {
  background: color-mix(in oklch, #a855f7 12%, transparent);
  border-color: color-mix(in oklch, #a855f7 35%, transparent);
  color: #a855f7;
}
.gap-type-missing_spoke_type {
  background: color-mix(in oklch, #06b6d4 12%, transparent);
  border-color: color-mix(in oklch, #06b6d4 35%, transparent);
  color: #06b6d4;
}
.gap-type-missing_translation {
  background: color-mix(in oklch, #ec4899 12%, transparent);
  border-color: color-mix(in oklch, #ec4899 35%, transparent);
  color: #ec4899;
}
.gap-type-cluster_too_small {
  background: color-mix(in oklch, #eab308 12%, transparent);
  border-color: color-mix(in oklch, #eab308 35%, transparent);
  color: #eab308;
}
</style>
