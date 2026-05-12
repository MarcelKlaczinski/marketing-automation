<template>
  <q-page padding>
    <div v-if="loading && !detail" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="!detail" class="text-center q-pa-xl">
      <q-icon name="error_outline" size="64px" color="negative" />
      <p class="text-body1 q-mt-md">{{ $t('articles.detail.notFound') }}</p>
      <q-btn flat :label="$t('articles.header.back')" icon="arrow_back" @click="$router.back()" />
    </div>

    <template v-else>
      <ArticleDetailHeader :detail="detail" @back="$router.back()" />

      <!-- ── Language switcher (only when a translation sibling exists) ─── -->
      <div v-if="translationSibling || articleLocale" class="locale-switcher q-mt-sm q-mb-xs">
        <q-btn-toggle
          :model-value="articleLocale"
          :options="localeOptions"
          dense
          rounded
          unelevated
          toggle-color="primary"
          color="white"
          text-color="grey-8"
          @update:model-value="onSwitchLocale"
        />
        <q-badge
          v-if="translationSibling"
          :color="translationSiblingStatusColor"
          :label="$t('articles.status.' + translationSibling.status)"
          class="q-ml-sm"
        />
        <span v-else class="text-caption text-grey-6 q-ml-sm">
          {{ $t('articles.locale.noTranslation', { locale: targetLocaleLabel }) }}
        </span>
      </div>

      <div class="row q-col-gutter-lg q-mt-md">
        <div class="col-12 col-lg-8">
          <q-tabs
            v-model="activeTab"
            align="left"
            class="text-grey-8 q-mb-md"
            indicator-color="primary"
            active-color="primary"
            narrow-indicator
            @update:model-value="onTabChange"
          >
            <q-tab name="body" :label="$t('articles.detail.tabs.body')" icon="article" />
            <q-tab name="metadata" :label="$t('articles.detail.tabs.metadata')" icon="label" />
            <q-tab name="history" :label="$t('articles.detail.tabs.history')" icon="history" />
            <q-tab name="validation" :label="$t('articles.detail.tabs.validation')" icon="task_alt" />
            <q-tab name="frontmatter" :label="$t('articles.detail.tabs.frontmatter') as string" icon="code" />
          </q-tabs>

          <q-tab-panels v-model="activeTab" animated class="bg-transparent">
            <q-tab-panel name="body" class="q-px-none">
              <ArticleBodyPanel :detail="detail" @saved="onRefresh" />
            </q-tab-panel>
            <q-tab-panel name="metadata" class="q-px-none">
              <ArticleMetadataPanel :detail="detail" @updated="onRefresh" />
            </q-tab-panel>
            <q-tab-panel name="history" class="q-px-none">
              <ArticleHistoryPanel :article-id="id" />
            </q-tab-panel>
            <q-tab-panel name="validation" class="q-px-none">
              <ArticleValidationPanel :detail="detail" />
            </q-tab-panel>
            <q-tab-panel name="frontmatter" class="q-px-none">
              <ArticleFrontmatterPanel :detail="detail" />
            </q-tab-panel>
          </q-tab-panels>
        </div>

        <div class="col-12 col-lg-4">
          <ArticleActionPanel :detail="detail" @action-triggered="onRefresh" />
        </div>
      </div>
    </template>
  </q-page>
</template>

<script lang="ts">
import ArticleActionPanel from "src/components/articles/ArticleActionPanel.vue";
import ArticleBodyPanel from "src/components/articles/ArticleBodyPanel.vue";
import ArticleDetailHeader from "src/components/articles/ArticleDetailHeader.vue";
import ArticleFrontmatterPanel from "src/components/articles/ArticleFrontmatterPanel.vue";
import ArticleHistoryPanel from "src/components/articles/ArticleHistoryPanel.vue";
import ArticleMetadataPanel from "src/components/articles/ArticleMetadataPanel.vue";
import ArticleValidationPanel from "src/components/articles/ArticleValidationPanel.vue";
import { useArticlesStore } from "src/stores/articles";
import { defineComponent } from "vue";

type TabName = "body" | "metadata" | "history" | "validation" | "frontmatter";

const VALID_TABS: TabName[] = ["body", "metadata", "history", "validation", "frontmatter"];

export default defineComponent({
  name: "ArticleDetailPage",

  components: {
    ArticleDetailHeader,
    ArticleBodyPanel,
    ArticleMetadataPanel,
    ArticleHistoryPanel,
    ArticleValidationPanel,
    ArticleActionPanel,
    ArticleFrontmatterPanel,
  },

  props: {
    id: { type: String, required: true },
  },

  setup() {
    return { articlesStore: useArticlesStore() };
  },

  data: () => ({
    activeTab: "body" as TabName,
    loading: false,
  }),

  computed: {
    detail() {
      return this.articlesStore.detailById[this.id] ?? null;
    },

    articleLocale(): string {
      return ((this.detail?.article as Record<string, unknown>)?.locale as string | null) ?? "de";
    },

    translationSibling(): { id: string; locale: string; status: string } | null {
      return ((this.detail?.article as Record<string, unknown>)?.translationSibling as { id: string; locale: string; status: string } | null) ?? null;
    },

    targetLocaleLabel(): string {
      return this.articleLocale === "de" ? "English" : "Deutsch";
    },

    localeOptions(): Array<{ label: string; value: string; disable?: boolean }> {
      const sibling = this.translationSibling;
      const currentLocale = this.articleLocale;
      return [
        {
          label: "DE",
          value: "de",
          disable: currentLocale === "de" || (currentLocale !== "de" && !sibling),
        },
        {
          label: "EN",
          value: "en",
          disable: currentLocale === "en" || (currentLocale !== "en" && !sibling),
        },
      ];
    },

    translationSiblingStatusColor(): string {
      const status = this.translationSibling?.status ?? "";
      const colorMap: Record<string, string> = {
        final_review: "orange",
        ready_to_publish: "positive",
        published: "positive",
        proposed: "grey",
        approved: "grey",
        generating: "primary",
        drafting: "primary",
        failed: "negative",
      };
      return colorMap[status] ?? "grey";
    },
  },

  async created() {
    const rawTab = this.$route.query["tab"];
    const tabStr = Array.isArray(rawTab) ? (rawTab[0] ?? "") : (rawTab ?? "");
    if (typeof tabStr === "string" && VALID_TABS.includes(tabStr as TabName)) {
      this.activeTab = tabStr as TabName;
    }
    await this.loadDetail();
  },

  watch: {
    // Vue Router reuses this component when navigating between /articles/A → /articles/B.
    // created() doesn't fire again — watch id to reload detail for the new article.
    id: {
      handler(): void {
        void this.loadDetail();
      },
    },
  },

  methods: {
    async loadDetail(): Promise<void> {
      this.loading = true;
      try {
        await this.articlesStore.fetchDetail(this.id);
      } finally {
        this.loading = false;
      }
    },

    onSwitchLocale(locale: string | null): void {
      if (!locale || locale === this.articleLocale) return;
      const sibling = this.translationSibling;
      if (!sibling) return; // button should be disabled if no sibling, but guard anyway
      void this.$router.push({
        path: `/articles/${sibling.id}`,
        query: { tab: this.activeTab },
      });
    },

    onTabChange(newTab: string | number | null): void {
      if (typeof newTab !== "string") return;
      void this.$router.replace({ query: { ...this.$route.query, tab: newTab } });
    },

    async onRefresh(): Promise<void> {
      await this.articlesStore.fetchDetail(this.id);
    },
  },
});
</script>

<style lang="scss" scoped>
.locale-switcher {
  display: flex;
  align-items: center;
}
</style>
