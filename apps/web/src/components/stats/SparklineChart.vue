<template>
  <svg
    class="sparkline"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <!-- Fill area under line -->
    <defs>
      <linearGradient :id="`sg-${uid}`" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="color" stop-opacity="0.3" />
        <stop offset="100%" :stop-color="color" stop-opacity="0" />
      </linearGradient>
    </defs>

    <path
      v-if="fillPath"
      :d="fillPath"
      :fill="`url(#sg-${uid})`"
    />
    <path
      v-if="linePath"
      :d="linePath"
      fill="none"
      :stroke="color"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<script lang="ts">
import { defineComponent } from "vue";

let _uid = 0;

/**
 * Lightweight SVG sparkline — no Chart.js dependency.
 * Renders a smooth polyline + gradient fill for stat cards.
 */
export default defineComponent({
  name: "SparklineChart",

  props: {
    /** Data points (raw numbers — normalized internally) */
    data: {
      type: Array as () => number[],
      default: () => [] as number[],
    },
    /** Stroke + fill gradient color */
    color: {
      type: String,
      default: "#7c5cff",
    },
    width: {
      type: Number,
      default: 120,
    },
    height: {
      type: Number,
      default: 36,
    },
  },

  data: () => ({
    uid: ++_uid,
  }),

  computed: {
    /** Normalized data clamped to [0, 1] */
    normalized(): number[] {
      const pts = this.data;
      if (pts.length < 2) return pts.map(() => 0.5);
      const min = Math.min(...pts);
      const max = Math.max(...pts);
      const range = max - min || 1;
      return pts.map((v) => (v - min) / range);
    },

    /** SVG coordinates — Y is inverted (0 = top) */
    points(): Array<{ x: number; y: number }> {
      const norm = this.normalized;
      const pad = 2; // vertical padding in px
      const usableH = this.height - pad * 2;
      const step = this.width / Math.max(norm.length - 1, 1);
      return norm.map((v, i) => ({
        x: i * step,
        y: pad + (1 - v) * usableH,
      }));
    },

    linePath(): string {
      const pts = this.points;
      if (pts.length < 2) return "";
      const d = pts
        .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
        .join(" ");
      return d;
    },

    fillPath(): string {
      const pts = this.points;
      if (pts.length < 2) return "";
      const last = pts[pts.length - 1];
      const first = pts[0];
      if (!last || !first) return "";
      return (
        this.linePath +
        ` L ${last.x} ${this.height} L ${first.x} ${this.height} Z`
      );
    },
  },
});
</script>

<style scoped>
.sparkline {
  display: block;
  overflow: visible;
}
</style>
