<template>
  <div class="manual-tab">
    <div class="search-bar">
      <FormInput
        v-model="searchQuery"
        :placeholder="$t('articleTools.manual.searchPlaceholder') as string"
        @input="onSearchInput"
      />
    </div>

    <div class="manual-content">
      <aside class="article-list">
        <div v-if="loading" class="list-loading">
          <LoadingShimmer v-for="i in 6" :key="i" class="shimmer-row" />
        </div>

        <EmptyState
          v-else-if="!searchResults.length"
          :title="$t('articleTools.manual.noResults') as string"
          :description="$t('articleTools.manual.noResultsDescription') as string"
          size="sm"
        />

        <ArticleListItem
          v-for="article in searchResults"
          v-else
          :key="article.id"
          :article="article"
          :selected="article.id === selectedArticleId"
          @click="selectArticle(article.id)"
        />
      </aside>

      <main class="trigger-panel">
        <EmptyState
          v-if="!selectedArticle"
          :title="$t('articleTools.manual.emptyTitle') as string"
          :description="$t('articleTools.manual.emptyDescription') as string"
        />

        <ArticleTriggersPanel
          v-else
          :article="selectedArticle"
          @triggered="onTriggered"
        />
      </main>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRoute } from "vue-router";
import FormInput from "src/components/forms/FormInput.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import ArticleListItem from "src/components/article-tools/ArticleListItem.vue";
import ArticleTriggersPanel from "src/components/article-tools/ArticleTriggersPanel.vue";
import { apiGet } from "src/lib/api";

interface ArticleEntry {
  id: string;
  slug: string;
  title: string | null;
  collection: string;
  locale: string;
  status: string;
}

interface ArticlesResponse {
  items: ArticleEntry[];
}

export default defineComponent({
  name: "ArticleManualTriggersTab",

  components: { FormInput, EmptyState, LoadingShimmer, ArticleListItem, ArticleTriggersPanel },

  setup() {
    const route = useRoute();
    return { slug: route.params.slug as string };
  },

  data: () => ({
    searchQuery: "",
    searchResults: [] as ArticleEntry[],
    selectedArticleId: null as string | null,
    loading: false,
    searchTimeout: null as ReturnType<typeof setTimeout> | null,
  }),

  computed: {
    selectedArticle(): ArticleEntry | null {
      return this.searchResults.find((a) => a.id === this.selectedArticleId) ?? null;
    },
  },

  mounted() {
    void this.fetchArticles("");
  },

  methods: {
    onSearchInput(): void {
      if (this.searchTimeout !== null) clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        void this.fetchArticles(this.searchQuery);
      }, 300);
    },

    async fetchArticles(query: string): Promise<void> {
      this.loading = true;
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (query.trim()) params.set("q", query.trim());

        const data = await apiGet<ArticlesResponse>(
          `/projects/${this.slug}/articles?${params.toString()}`,
        );
        this.searchResults = data.items ?? (data as unknown as ArticleEntry[]);
      } catch {
        this.searchResults = [];
      } finally {
        this.loading = false;
      }
    },

    selectArticle(id: string): void {
      this.selectedArticleId = id;
    },

    onTriggered(payload: { action: string; runId?: string }): void {
      this.$q.notify({
        type: "positive",
        message: this.$t("articleTools.manual.triggerSuccess", { action: payload.action }) as string,
      });
    },
  },
});
</script>

<style scoped>
.manual-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.search-bar {
  padding: 16px 32px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.manual-content {
  display: grid;
  grid-template-columns: 280px 1fr;
  flex: 1;
  overflow: hidden;
}

.article-list {
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
}

.list-loading {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 8px;
}

.shimmer-row {
  height: 52px;
  border-radius: var(--radius-sm);
}

.trigger-panel {
  overflow-y: auto;
}

@media (max-width: 767px) {
  .manual-content {
    grid-template-columns: 1fr;
    grid-template-rows: 240px 1fr;
  }

  .article-list {
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
  }
}
</style>
