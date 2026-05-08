<template>
  <div class="frontmatter-display q-mb-md">
    <q-list dense>
      <q-item v-for="(value, key) in displayData" :key="key">
        <q-item-section side class="text-caption text-grey-7" style="min-width: 120px;">
          {{ key }}
        </q-item-section>
        <q-item-section>
          <code class="text-caption">{{ formatValue(value) }}</code>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

export default defineComponent({
  name: "FrontmatterDisplay",
  props: {
    data: { type: Object as PropType<Record<string, unknown>>, required: true },
  },
  computed: {
    displayData(): Record<string, unknown> {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(this.data)) {
        if (v !== null && v !== undefined && v !== "") filtered[k] = v;
      }
      return filtered;
    },
  },
  methods: {
    formatValue(v: unknown): string {
      if (Array.isArray(v)) return v.join(", ");
      if (v instanceof Date) return v.toISOString().split("T")[0]!;
      if (typeof v === "object" && v !== null) return JSON.stringify(v);
      return String(v);
    },
  },
});
</script>
