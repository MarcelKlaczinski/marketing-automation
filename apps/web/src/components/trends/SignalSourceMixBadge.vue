<template>
  <span class="source-mix">
    <q-chip
      v-for="src in uniqueSources"
      :key="src"
      dense
      size="xs"
      :color="sourceColor(src)"
      text-color="white"
      class="source-mix__chip"
    >
      {{ $t(`trends.sources.${src}`) }}
    </q-chip>
    <span v-if="uniqueSources.length === 0" class="text-grey-5 text-caption">—</span>
  </span>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

type SignalSource = "producthunt" | "hackernews" | "vendor_rss" | "reddit" | "github" | "dataforseo_trends";

const SOURCE_COLORS: Record<SignalSource, string> = {
  producthunt: "deep-orange",
  hackernews: "orange",
  vendor_rss: "teal",
  reddit: "red",
  github: "grey-8",
  dataforseo_trends: "indigo",
};

export default defineComponent({
  name: "SignalSourceMixBadge",

  props: {
    signals: {
      type: Array as PropType<Array<{ source: string }>>,
      default: () => [],
    },
  },

  computed: {
    uniqueSources(): SignalSource[] {
      const seen = new Set<string>();
      const result: SignalSource[] = [];
      for (const s of this.signals) {
        if (!seen.has(s.source)) {
          seen.add(s.source);
          result.push(s.source as SignalSource);
        }
      }
      return result;
    },
  },

  methods: {
    sourceColor(src: SignalSource): string {
      return SOURCE_COLORS[src] ?? "grey-6";
    },
  },
});
</script>

<style scoped>
.source-mix { display: inline-flex; flex-wrap: wrap; gap: 2px; align-items: center; }
.source-mix__chip { margin: 0; }
</style>
