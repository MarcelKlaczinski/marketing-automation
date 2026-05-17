<template>
  <div class="frontmatter-tab">
    <p class="tab-hint mono">{{ $t("articles.detailTabs.frontmatter") as string }}</p>

    <div v-if="isLoading" class="loading-state">
      <LoadingShimmer variant="card" :count="6" />
    </div>

    <div v-else-if="entries.length" class="fields-list">
      <div
        v-for="(entry, i) in entries"
        :key="i"
        class="field-row"
        :class="{ 'field-row--json': entry.isJson }"
      >
        <span class="field-key mono">{{ entry.key }}</span>
        <pre v-if="entry.isJson" class="field-json mono">{{ entry.display }}</pre>
        <span v-else class="field-value">{{ entry.display }}</span>
      </div>
    </div>

    <EmptyState
      v-else
      :title="$t('articles.frontmatter.empty') as string"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import { apiGet } from "src/lib/api";

interface FrontmatterData {
  fields: Record<string, unknown>;
  yaml: string;
  slug: string;
  extras: Record<string, unknown>;
  schema: unknown[] | null;
}

export default defineComponent({
  name: "ArticleFrontmatterTab",

  components: { EmptyState, LoadingShimmer },

  props: {
    articleId: { type: String, required: true },
  },

  data: () => ({
    isLoading: false,
    entries: [] as Array<{ key: string; display: string; isJson: boolean }>,
  }),

  mounted() {
    void this.loadFrontmatter();
  },

  methods: {
    async loadFrontmatter(): Promise<void> {
      this.isLoading = true;
      try {
        const res = await apiGet<FrontmatterData>(`/articles/${this.articleId}/frontmatter`);
        const fm = res.fields ?? res.extras ?? {};
        this.entries = Object.entries(fm).map(([key, val]) => {
          const isJson = val !== null && typeof val === "object";
          return {
            key,
            display: isJson ? JSON.stringify(val, null, 2) : this.formatValue(val),
            isJson,
          };
        });
      } catch {
        this.entries = [];
      } finally {
        this.isLoading = false;
      }
    },

    formatValue(v: unknown): string {
      if (v === null || v === undefined) return "—";
      if (typeof v === "string") return v.length > 200 ? v.substring(0, 200) + "…" : v;
      if (typeof v === "object") {
        const s = JSON.stringify(v);
        return s.length > 200 ? s.substring(0, 200) + "…" : s;
      }
      return String(v);
    },
  },
});
</script>

<style scoped>
.frontmatter-tab {
  padding: 16px;
}

.tab-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fields-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-row {
  display: flex;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-glass);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.field-row--json {
  flex-direction: column;
  gap: 6px;
}

.field-key {
  font-size: 11px;
  color: var(--text-tertiary);
  min-width: 140px;
  flex-shrink: 0;
}

.field-value {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-word;
}

.field-json {
  margin: 0;
  padding: 10px 12px;
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre;
  overflow-x: auto;
  tab-size: 2;
}
</style>
