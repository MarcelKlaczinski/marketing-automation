<template>
  <div class="articles-page">
    <aside class="list-pane">
      <FilterBar
        :available-filters="availableFilters"
        :active-filters="activeFilters"
        :search="searchQuery"
        @update:filters="onFiltersChange"
        @update:search="onSearchChange"
      />

      <div class="list-content">
        <LoadingShimmer v-if="isLoading && !articles.length" variant="card" :count="5" />
        <EmptyState
          v-else-if="!articles.length && !isLoading"
          :title="$t('articles.list.empty') as string"
          :description="$t('articles.list.emptyDescription') as string"
        />
        <template v-else>
          <ArticleCard
            v-for="group in articleGroups"
            :key="group.primary.id"
            :article="group.primary"
            :sibling="group.sibling"
            :selected="group.primary.id === selectedArticleId || group.sibling?.id === selectedArticleId"
            @select="onSelectArticle($event)"
          />
        </template>

        <LoadMoreButton
          :has-more="hasMore"
          :loading="isFetchingMore"
          :total-loaded="articles.length"
          @load-more="loadMore"
        />
      </div>
    </aside>

    <main class="detail-pane">
      <router-view v-if="selectedArticleId" />
      <EmptyState
        v-else
        :title="$t('articles.list.detailEmpty') as string"
        :description="$t('articles.list.detailEmptyDescription') as string"
      />
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useArticlesList, type ArticlesListFilters } from "src/composables/useArticlesList";
import type { ArticleListItem } from "src/types/ui";
import FilterBar from "src/components/ui/FilterBar.vue";
import LoadMoreButton from "src/components/ui/LoadMoreButton.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import ArticleCard from "src/components/articles/ArticleCard.vue";

export default defineComponent({
  name: "ArticlesListPage",

  components: {
    FilterBar,
    LoadMoreButton,
    LoadingShimmer,
    EmptyState,
    ArticleCard,
  },

  setup() {
    const list = useArticlesList();
    return {
      articles: list.articles,
      hasMore: list.hasMore,
      isLoading: list.isLoading,
      isFetchingMore: list.isFetchingMore,
      loadMore: list.loadMore,
      refetchList: list.refetch,
      setFilters: list.setFilters,
    };
  },

  data: () => ({
    activeFilters: {} as Record<string, string>,
    searchQuery: "",
  }),

  computed: {
    selectedArticleId(): string | null {
      const id = this.$route.params.articleId;
      return typeof id === "string" ? id : null;
    },
    articleGroups(): Array<{ primary: ArticleListItem; sibling: { id: string; locale: string | null; status: string } | null }> {
      const seen = new Set<string>();
      const groups: Array<{ primary: ArticleListItem; sibling: { id: string; locale: string | null; status: string } | null }> = [];
      const byKey = new Map<string, ArticleListItem[]>();

      for (const a of (this.articles as ArticleListItem[])) {
        if (a.translationKey) {
          const bucket = byKey.get(a.translationKey) ?? [];
          bucket.push(a);
          byKey.set(a.translationKey, bucket);
        }
      }

      for (const a of (this.articles as ArticleListItem[])) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);

        if (!a.translationKey) {
          groups.push({ primary: a, sibling: null });
          continue;
        }

        const bucket = byKey.get(a.translationKey) ?? [];
        const other = bucket.find((b) => b.id !== a.id);
        if (other) seen.add(other.id);

        // Prefer DE as primary
        const primary = a.locale === "de" ? a : (other?.locale === "de" ? other : a);
        const sibling = primary.id === a.id ? (other ?? null) : a;
        groups.push({
          primary,
          sibling: sibling ? { id: sibling.id, locale: sibling.locale, status: sibling.status } : null,
        });
      }

      return groups;
    },
    availableFilters() {
      return [
        {
          key: "status",
          label: this.$t("articles.filters.status") as string,
          options: [
            { value: "proposed", label: this.$t("articles.status.proposed") as string },
            { value: "approved", label: this.$t("articles.status.approved") as string },
            { value: "outline_review", label: this.$t("articles.status.outline_review") as string },
            { value: "final_review", label: this.$t("articles.status.final_review") as string },
            { value: "published", label: this.$t("articles.status.published") as string },
            { value: "failed", label: this.$t("articles.status.failed") as string },
          ],
        },
        {
          key: "collection",
          label: this.$t("articles.filters.collection") as string,
          options: [
            { value: "blog", label: this.$t("articles.filters.collections.blog") as string },
            { value: "tools", label: this.$t("articles.filters.collections.tools") as string },
            { value: "comparisons", label: this.$t("articles.filters.collections.comparisons") as string },
            { value: "ki-wissen", label: this.$t("articles.filters.collections.ki-wissen") as string },
            { value: "usecases", label: this.$t("articles.filters.collections.usecases") as string },
            { value: "tool-categories", label: this.$t("articles.filters.collections.tool-categories") as string },
          ],
        },
        {
          key: "locale",
          label: this.$t("articles.filters.locale") as string,
          options: [
            { value: "de", label: this.$t("articles.filters.locales.de") as string },
            { value: "en", label: this.$t("articles.filters.locales.en") as string },
          ],
        },
      ];
    },
  },

  methods: {
    onFiltersChange(newFilters: Record<string, string>): void {
      this.activeFilters = newFilters;
      this.applyFilters();
    },
    onSearchChange(search: string): void {
      this.searchQuery = search;
      this.applyFilters();
    },
    applyFilters(): void {
      const f: ArticlesListFilters = {};
      if (this.activeFilters.status) f.status = this.activeFilters.status;
      if (this.activeFilters.collection) f.collection = this.activeFilters.collection;
      if (this.activeFilters.locale) f.locale = this.activeFilters.locale;
      if (this.searchQuery.length >= 2) f.search = this.searchQuery;
      this.setFilters(f);
    },
    onSelectArticle(id: string): void {
      const slug = this.$route.params.slug as string;
      void this.$router.push(`/projects/${slug}/articles/${id}`);
    },
  },
});
</script>

<style scoped>
.articles-page {
  display: flex;
  height: 100%;
  overflow: hidden;
  gap: 0;
}

.list-pane {
  width: 340px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  overflow: hidden;
}

.list-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-pane {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}

@media (max-width: 767px) {
  .articles-page {
    flex-direction: column;
  }

  .list-pane {
    width: 100%;
    max-height: 50vh;
  }
}
</style>
