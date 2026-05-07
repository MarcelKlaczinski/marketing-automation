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
import ArticleHistoryPanel from "src/components/articles/ArticleHistoryPanel.vue";
import ArticleMetadataPanel from "src/components/articles/ArticleMetadataPanel.vue";
import ArticleValidationPanel from "src/components/articles/ArticleValidationPanel.vue";
import { useArticlesStore } from "src/stores/articles";
import { defineComponent } from "vue";

type TabName = "body" | "metadata" | "history" | "validation";

const VALID_TABS: TabName[] = ["body", "metadata", "history", "validation"];

export default defineComponent({
  name: "ArticleDetailPage",

  components: {
    ArticleDetailHeader,
    ArticleBodyPanel,
    ArticleMetadataPanel,
    ArticleHistoryPanel,
    ArticleValidationPanel,
    ArticleActionPanel,
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
  },

  async created() {
    const rawTab = this.$route.query["tab"];
    const tabStr = Array.isArray(rawTab) ? (rawTab[0] ?? "") : (rawTab ?? "");
    if (typeof tabStr === "string" && VALID_TABS.includes(tabStr as TabName)) {
      this.activeTab = tabStr as TabName;
    }
    await this.loadDetail();
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
