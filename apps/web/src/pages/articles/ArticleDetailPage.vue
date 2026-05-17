<template>
  <DetailPageShell
    :title="article ? (article.title ?? article.cornerstoneKeyword ?? article.slug ?? '') : ''"
    :meta="article ? `${article.collection ?? '—'} · ${article.locale ?? '—'} · ${article.slug}` : ''"
    :tabs="tabs"
    :active-tab="activeTab"
    :back-route="backRoute"
    @change-tab="activeTab = ($event as TabKey)"
  >
    <template #eyebrow>
      <span
        v-if="article"
        :class="['status-chip', `status-${article.status}`]"
      >
        {{ statusLabel }}
      </span>
    </template>

    <template #actions>
      <button
        v-if="article?.translationSibling"
        class="locale-chip"
        :title="$t('articles.locale.viewSiblingLocale', { locale: article.translationSibling.locale?.toUpperCase() }) as string"
        @click="goToSibling"
      >
        {{ article.translationSibling.locale?.toUpperCase() ?? '?' }}
      </button>
      <GlassButton variant="secondary" size="sm" @click="onRefresh">
        {{ $t("articles.detailActions.refresh") as string }}
      </GlassButton>
      <GlassButton variant="primary" size="sm" @click="onSync">
        {{ $t("articles.detailActions.sync") as string }}
      </GlassButton>
    </template>

    <template v-if="article?.heroImagePublicUrl" #subheader>
      <div class="hero-banner">
        <img
          class="hero-img"
          :src="article.heroImagePublicUrl"
          :alt="article.heroImageAltText ?? (article.title ?? '')"
        />
      </div>
    </template>

    <div v-if="isPending" class="detail-loading">
      <LoadingShimmer variant="card" :count="3" />
    </div>

    <div v-else-if="!article" class="detail-error">
      {{ $t("articles.detail.notFound") as string }}
    </div>

    <template v-else>
      <ArticleBodyTab
        v-if="activeTab === 'body'"
        :article-id="articleId"
        :body-md="article.bodyMd ?? ''"
        @saved="onBodySaved"
      />
      <ArticleFrontmatterTab
        v-else-if="activeTab === 'frontmatter'"
        :article-id="articleId"
      />
      <ArticleVersionsTab
        v-else-if="activeTab === 'versions'"
        :article-id="articleId"
      />
      <ArticleRunsTab
        v-else-if="activeTab === 'runs'"
        :article-id="articleId"
      />
      <ArticleCostTab
        v-else-if="activeTab === 'cost'"
        :article-id="articleId"
      />
      <ArticleSocialTab
        v-else-if="activeTab === 'social'"
        :article-id="articleId"
      />
    </template>
  </DetailPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { apiGet, apiPost } from "src/lib/api";
import DetailPageShell from "src/components/ui/DetailPageShell.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import ArticleBodyTab from "src/pages/articles/tabs/ArticleBodyTab.vue";
import ArticleFrontmatterTab from "src/pages/articles/tabs/ArticleFrontmatterTab.vue";
import ArticleVersionsTab from "src/pages/articles/tabs/ArticleVersionsTab.vue";
import ArticleRunsTab from "src/pages/articles/tabs/ArticleRunsTab.vue";
import ArticleCostTab from "src/pages/articles/tabs/ArticleCostTab.vue";
import ArticleSocialTab from "src/pages/articles/tabs/ArticleSocialTab.vue";
import type { ArticleDetail } from "src/types/ui";

type TabKey = "body" | "frontmatter" | "versions" | "runs" | "cost" | "social";

const STATUS_LABEL: Record<string, string> = {
  proposed: "articles.status.proposed",
  approved: "articles.status.approved",
  generating: "articles.status.generating",
  outline_review: "articles.status.outline_review",
  drafting: "articles.status.drafting",
  final_review: "articles.status.final_review",
  schema_extending: "articles.status.schema_extending",
  ready_to_publish: "articles.status.ready_to_publish",
  validating: "articles.status.validating",
  published: "articles.status.published",
  blocked_by_pagespeed: "articles.status.blocked_by_pagespeed",
  failed: "articles.status.failed",
  rejected: "articles.status.rejected",
};

export default defineComponent({
  name: "ArticleDetailPage",

  components: {
    DetailPageShell,
    GlassButton,
    LoadingShimmer,
    ArticleBodyTab,
    ArticleFrontmatterTab,
    ArticleVersionsTab,
    ArticleRunsTab,
    ArticleCostTab,
    ArticleSocialTab,
  },

  setup() {
    // Route param is static for this component's lifetime — it remounts on navigation.
    const route = useRoute();
    const queryClient = useQueryClient();
    const articleId = route.params.articleId as string;

    const { data, isPending } = useQuery({
      queryKey: ["article", articleId],
      queryFn: () => apiGet<{ article: ArticleDetail }>(`/articles/${articleId}`),
    });

    return { articleId, data, isPending, queryClient };
  },

  data: () => ({
    activeTab: "body" as TabKey,
  }),

  computed: {
    article(): ArticleDetail | null {
      return (this.data as { article: ArticleDetail } | undefined)?.article ?? null;
    },
    statusLabel(): string {
      const key = STATUS_LABEL[this.article?.status ?? ""];
      return key ? (this.$t(key) as string) : (this.article?.status ?? "");
    },
    backRoute(): string {
      const slug = this.$route.params.slug as string;
      return `/projects/${slug}/articles`;
    },
    tabs() {
      return [
        { key: "body", label: this.$t("articles.detailTabs.body") as string },
        { key: "frontmatter", label: this.$t("articles.detailTabs.frontmatter") as string },
        { key: "versions", label: this.$t("articles.detailTabs.versions") as string },
        { key: "runs", label: this.$t("articles.detailTabs.runs") as string },
        { key: "cost", label: this.$t("articles.detailTabs.cost") as string },
        { key: "social", label: this.$t("articles.detailTabs.social") as string },
      ];
    },
  },

  methods: {
    goToSibling(): void {
      const sibling = this.article?.translationSibling;
      if (!sibling) return;
      const slug = this.$route.params.slug as string;
      void this.$router.push(`/projects/${slug}/articles/${sibling.id}`);
    },
    onBodySaved(): void {
      void this.queryClient.invalidateQueries({
        queryKey: ["article", this.articleId],
      });
      this.$q.notify({ type: "positive", message: this.$t("articles.bodyEditor.saveSuccess") as string });
    },
    async onRefresh(): Promise<void> {
      try {
        await apiPost(`/articles/${this.articleId}/refresh`);
        this.$q.notify({ type: "positive", message: this.$t("articles.detailActions.refresh") as string });
      } catch {
        // error handled by api.ts
      }
    },
    async onSync(): Promise<void> {
      try {
        await apiPost(`/articles/${this.articleId}/sync`);
        this.$q.notify({ type: "positive", message: this.$t("articles.detailActions.sync") as string });
      } catch {
        // error handled by api.ts
      }
    },
  },
});
</script>

<style scoped>
.detail-loading,
.detail-error {
  padding: 24px;
}

.locale-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .locale-chip:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-primary);
  }
}

.hero-banner {
  width: 100%;
  height: 96px;
  overflow: hidden;
  background: var(--bg-glass);
  border-bottom: 1px solid var(--border-subtle);
  transition: height 280ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  cursor: zoom-in;
}

@media (hover: hover) and (pointer: fine) {
  .hero-banner:hover {
    height: 300px;
    cursor: zoom-out;
  }
}

.hero-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.status-chip {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.status-published { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-failed, .status-blocked_by_pagespeed { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.status-generating, .status-drafting, .status-validating, .status-schema_extending {
  background: rgba(59, 130, 246, 0.15); color: #60a5fa;
}
.status-final_review, .status-outline_review, .status-approved {
  background: rgba(234, 179, 8, 0.15); color: #fbbf24;
}
.status-proposed, .status-rejected, .status-ready_to_publish {
  background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary);
}
</style>
