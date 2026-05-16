<template>
  <div
    class="loading-shimmer"
    :class="`shimmer-${variant}`"
    :style="shimmerStyle"
    aria-hidden="true"
  />
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

type ShimmerVariant = "card" | "line" | "pill";

/**
 * Skeleton loading placeholder. Three shape variants:
 * - card: rounded rect for card/panel placeholders
 * - line: narrow rect for text line placeholders
 * - pill: rounded for badge/chip placeholders
 *
 * Uses `shimmerPass` keyframe from animations.css.
 */
export default defineComponent({
  name: "LoadingShimmer",

  props: {
    /** Visual shape variant */
    variant: {
      type: String as PropType<ShimmerVariant>,
      default: "card",
    },
    /** Override height (e.g. "44px", "16px") */
    height: {
      type: String,
      default: "",
    },
    /** Override width (e.g. "100%", "120px") */
    width: {
      type: String,
      default: "",
    },
  },

  computed: {
    shimmerStyle(): Record<string, string> {
      const style: Record<string, string> = {};
      if (this.height) style["height"] = this.height;
      if (this.width) style["width"] = this.width;
      return style;
    },
  },
});
</script>

<style scoped>
/* === Base shimmer === */
.loading-shimmer {
  background: linear-gradient(
    90deg,
    var(--bg-glass) 25%,
    var(--bg-glass-strong) 50%,
    var(--bg-glass) 75%
  );
  background-size: 400px 100%;
  animation: shimmerPass 1.4s ease-in-out infinite;
}

/* === Card (default) === */
.shimmer-card {
  height: 80px;
  width: 100%;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

/* === Line === */
.shimmer-line {
  height: 12px;
  width: 100%;
  border-radius: var(--radius-sm);
}

/* === Pill === */
.shimmer-pill {
  height: 22px;
  width: 64px;
  border-radius: 20px;
}
</style>
