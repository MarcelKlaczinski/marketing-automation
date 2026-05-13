<template>
  <div class="oklch-slider">
    <div class="row items-center q-mb-sm">
      <div class="col text-subtitle2">{{ label }}</div>
      <div class="col-auto text-caption text-mono q-mr-sm">{{ hexValue }}</div>
      <div
        class="color-swatch"
        :style="{ background: hexValue }"
      />
      <q-icon
        v-if="outOfGamut"
        name="warning"
        color="warning"
        size="xs"
        class="q-ml-xs"
      >
        <q-tooltip>{{ $t('brand.colors.outOfGamut') }}</q-tooltip>
      </q-icon>
    </div>

    <div class="row items-center q-mb-xs">
      <div class="col-2 text-caption text-grey-6">{{ $t('brand.colors.lightness') }}</div>
      <div class="col">
        <q-slider
          :model-value="l"
          :min="0"
          :max="100"
          :step="1"
          color="primary"
          @update:model-value="onL"
        />
      </div>
      <div class="col-2 text-caption text-right">{{ l }}%</div>
    </div>

    <div class="row items-center q-mb-xs">
      <div class="col-2 text-caption text-grey-6">{{ $t('brand.colors.chroma') }}</div>
      <div class="col">
        <q-slider
          :model-value="c"
          :min="0"
          :max="0.4"
          :step="0.001"
          color="primary"
          @update:model-value="onC"
        />
      </div>
      <div class="col-2 text-caption text-right">{{ c.toFixed(3) }}</div>
    </div>

    <div class="row items-center">
      <div class="col-2 text-caption text-grey-6">{{ $t('brand.colors.hue') }}</div>
      <div class="col">
        <q-slider
          :model-value="h"
          :min="0"
          :max="360"
          :step="1"
          color="primary"
          @update:model-value="onH"
        />
      </div>
      <div class="col-2 text-caption text-right">{{ h }}°</div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

type FormatHexFn = (c: { mode: string; l: number; c: number; h: number }) => string | undefined;
type ToOklchFn = (color: string) => { l?: number; c?: number; h?: number } | undefined;

let _formatHex: FormatHexFn | null = null;
let _toOklch: ToOklchFn | null = null;

async function getConverters(): Promise<{ formatHex: FormatHexFn; toOklch: ToOklchFn }> {
  if (!_formatHex) {
    const culori = await import("culori");
    _formatHex = culori.formatHex as FormatHexFn;
    _toOklch = culori.converter("oklch") as ToOklchFn;
  }
  return { formatHex: _formatHex as FormatHexFn, toOklch: _toOklch as ToOklchFn };
}

function inSrgbGamut(l: number, c: number, h: number): boolean {
  // Approximate sRGB gamut check: if l>95 with high c or very saturated, likely out-of-gamut
  const rApprox = l / 100 + c * Math.cos((h * Math.PI) / 180);
  const bApprox = l / 100 - c * 0.5;
  return rApprox >= 0 && rApprox <= 1 && bApprox >= 0 && bApprox <= 1;
}

export default defineComponent({
  name: "OklchSlider",

  props: {
    label: {
      type: String,
      required: true,
    },
    modelValue: {
      type: String,
      default: "#4F6FE5",
    },
  },

  emits: ["update:modelValue"],

  data: () => ({
    l: 64,
    c: 0.16,
    h: 248,
    hexValue: "#4F6FE5",
    outOfGamut: false,
  }),

  async mounted() {
    await this.parseHex(this.modelValue);
  },

  watch: {
    async modelValue(v: string) {
      await this.parseHex(v);
    },
  },

  methods: {
    async parseHex(hex: string) {
      if (!hex) return;
      const { toOklch, formatHex } = await getConverters();
      const result = toOklch(hex);
      if (result) {
        this.l = Math.round((result.l ?? 0) * 100);
        this.c = Math.round((result.c ?? 0) * 1000) / 1000;
        this.h = Math.round(result.h ?? 0);
        // Always store a proper hex regardless of input format (hex or CSS oklch string)
        this.hexValue = formatHex({ mode: "oklch", l: this.l / 100, c: this.c, h: this.h }) ?? hex;
      }
    },

    async recompute() {
      const { formatHex } = await getConverters();
      const hex = formatHex({ mode: "oklch", l: this.l / 100, c: this.c, h: this.h }) ?? "#000000";
      this.hexValue = hex;
      this.outOfGamut = !inSrgbGamut(this.l, this.c, this.h);
      this.$emit("update:modelValue", hex);
    },

    onL(v: number | null) {
      if (v == null) return;
      this.l = v;
      void this.recompute();
    },

    onC(v: number | null) {
      if (v == null) return;
      this.c = v;
      void this.recompute();
    },

    onH(v: number | null) {
      if (v == null) return;
      this.h = v;
      void this.recompute();
    },
  },
});
</script>

<style scoped>
.color-swatch {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}

.text-mono {
  font-family: monospace;
}
</style>
