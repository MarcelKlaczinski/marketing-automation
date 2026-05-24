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

        <div
          v-if="hasMore"
          ref="loadMoreSentinel"
          class="load-more-sentinel"
          aria-hidden="true"
        />

        <div v-if="isFetchingMore" class="load-more-status mono">
          {{ $t("common.loadingMore") }}
        </div>
        <div v-else-if="articles.length && !hasMore" class="load-more-status mono">
          {{ articles.length }} {{ $t("common.loaded") }}
        </div>
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
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import ArticleCard from "src/components/articles/ArticleCard.vue";

export default defineComponent({
  name: "ArticlesListPage",

  components: {
    FilterBar,
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
    // Non-reactive — underscore prefix convention; IntersectionObserver must not be
    // wrapped in Vue's reactive proxy (per apps/web/CLAUDE.md).
    _observer: null as IntersectionObserver | null,
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

  mounted() {
    this.attachObserver();
  },

  beforeUnmount() {
    this._observer?.disconnect();
    this._observer = null;
  },

  watch: {
    hasMore() {
      // Sentinel mounts/unmounts when hasMore flips — reattach so v-if re-render
      // does not leave the observer pointing at a detached node.
      void this.$nextTick(() => this.attachObserver());
    },
    isLoading() {
      void this.$nextTick(() => this.attachObserver());
    },
    isFetchingMore(next: boolean) {
      // After a page finishes loading, re-attach so the observer re-checks
      // intersection synchronously. Without this, a sentinel that was already
      // intersecting before the fetch never re-fires (IntersectionObserver only
      // emits on transitions), and scrolling stalls after the first load.
      if (!next) void this.$nextTick(() => this.attachObserver());
    },
  },

  methods: {
    attachObserver(): void {
      this._observer?.disconnect();
      // Vue's $refs is typed as Record<string, unknown>; narrow to the actual DOM node.
      const sentinel = this.$refs.loadMoreSentinel as Element | undefined;
      if (!sentinel) return;

      const root = sentinel.closest(".list-content");
      this._observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && this.hasMore && !this.isFetchingMore) {
              void this.loadMore();
            }
          }
        },
        { root, rootMargin: "200px" },
      );
      this._observer.observe(sentinel);
    },
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

.load-more-sentinel {
  height: 1px;
  flex-shrink: 0;
}

.load-more-status {
  padding: 12px 16px;
  text-align: center;
  font-size: 11px;
  color: var(--text-tertiary);
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
