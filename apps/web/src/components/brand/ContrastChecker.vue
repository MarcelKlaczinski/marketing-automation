<template>
  <div class="contrast-checker">
    <div class="text-caption text-grey-6 q-mb-xs">{{ $t('brand.colors.contrast') }}</div>
    <div class="row q-gutter-sm">
      <q-chip
        :color="meetsAA ? 'positive' : 'grey-4'"
        :text-color="meetsAA ? 'white' : 'grey-7'"
        dense
        square
      >
        {{ $t('brand.colors.wcagAA') }} {{ meetsAA ? '✓' : '✗' }}
        <q-tooltip>{{ ratio }}:1 (need 4.5:1)</q-tooltip>
      </q-chip>
      <q-chip
        :color="meetsAAA ? 'positive' : 'grey-4'"
        :text-color="meetsAAA ? 'white' : 'grey-7'"
        dense
        square
      >
        {{ $t('brand.colors.wcagAAA') }} {{ meetsAAA ? '✓' : '✗' }}
        <q-tooltip>{{ ratio }}:1 (need 7:1)</q-tooltip>
      </q-chip>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

type WcagFn = (a: string, b: string) => number;
let _wcagContrast: WcagFn | null = null;

async function getContrast(): Promise<WcagFn> {
  if (!_wcagContrast) {
    const culori = await import("culori");
    _wcagContrast = culori.wcagContrast as WcagFn;
  }
  return _wcagContrast;
}

export default defineComponent({
  name: "ContrastChecker",

  props: {
    colorA: {
      type: String,
      default: "#4F6FE5",
    },
    colorB: {
      type: String,
      default: "#ffffff",
    },
  },

  data: () => ({
    ratio: 1,
  }),

  computed: {
    meetsAA(): boolean {
      return this.ratio >= 4.5;
    },

    meetsAAA(): boolean {
      return this.ratio >= 7;
    },
  },

  watch: {
    colorA() {
      void this.compute();
    },
    colorB() {
      void this.compute();
    },
  },

  async mounted() {
    await this.compute();
  },

  methods: {
    async compute() {
      const wcag = await getContrast();
      try {
        this.ratio = Math.round(wcag(this.colorA, this.colorB) * 100) / 100;
      } catch {
        this.ratio = 1;
      }
    },
  },
});
</script>
