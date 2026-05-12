<template>
  <q-dialog v-model="modelValue" full-width @hide="onClose" @update:model-value="onModelUpdate">
    <q-card style="max-width: 1400px; width: 100%;">
      <q-toolbar>
        <q-toolbar-title>
          {{ article ? (article.title || article.slug) : $t('articles.imported.loading') }}
          <q-badge v-if="article" color="primary" class="q-ml-sm">
            {{ article.collection }}
          </q-badge>
        </q-toolbar-title>
        <q-btn flat icon="close" v-close-popup />
      </q-toolbar>

      <q-card-section v-if="loading" class="text-center q-pa-xl">
        <q-spinner-dots size="2em" />
      </q-card-section>

      <q-card-section v-else-if="article" class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <h6 class="q-my-sm">
            DE
            <q-badge v-if="!deArticle" color="grey">{{ $t('articles.imported.noPendant') }}</q-badge>
          </h6>
          <div v-if="deArticle">
            <FrontmatterDisplay :data="frontmatterFor(deArticle)" />
            <q-separator class="q-my-md" />
            <div class="markdown-body" v-html="renderMd(deArticle.bodyMd)" />
          </div>
          <div v-else class="text-grey-5">{{ $t('articles.imported.noDeVersion') }}</div>
        </div>

        <div class="col-12 col-md-6">
          <h6 class="q-my-sm">
            EN
            <q-badge v-if="!enArticle" color="grey">{{ $t('articles.imported.noPendant') }}</q-badge>
          </h6>
          <div v-if="enArticle">
            <FrontmatterDisplay :data="frontmatterFor(enArticle)" />
            <q-separator class="q-my-md" />
            <div class="markdown-body" v-html="renderMd(enArticle.bodyMd)" />
          </div>
          <div v-else class="text-grey-5">{{ $t('articles.imported.noEnVersion') }}</div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { marked } from "marked";
import { api } from "src/lib/api-client";
import FrontmatterDisplay from "./FrontmatterDisplay.vue";

type ArticleDetail = {
  id: string;
  collection: string;
  locale: string;
  slug: string;
  title: string | null;
  metaDescription: string | null;
  category: string | null;
  subcategory: string | null;
  author: string | null;
  publishedAt: string | null;
  frontmatterUpdatedAt: string | null;
  translationKey: string | null;
  frontmatterExtras: Record<string, unknown>;
  bodyMd: string | null;
};

export default defineComponent({
  name: "ImportedArticleDetailDialog",
  components: { FrontmatterDisplay },

  props: {
    modelValue: { type: Boolean, default: false },
    articleId: { type: String as PropType<string | null>, default: null },
  },

  emits: ["update:modelValue"],

  data: () => ({
    loading: false,
    article: null as ArticleDetail | null,
    pendant: null as ArticleDetail | null,
  }),

  computed: {
    deArticle(): ArticleDetail | null {
      if (!this.article) return null;
      if (this.article.locale === "de") return this.article;
      return this.pendant?.locale === "de" ? this.pendant : null;
    },
    enArticle(): ArticleDetail | null {
      if (!this.article) return null;
      if (this.article.locale === "en") return this.article;
      return this.pendant?.locale === "en" ? this.pendant : null;
    },
  },

  watch: {
    articleId(id: string | null): void {
      if (id && this.modelValue) void this.fetchDetail(id);
    },
    modelValue(open: boolean): void {
      if (open && this.articleId) void this.fetchDetail(this.articleId);
    },
  },

  methods: {
    async fetchDetail(id: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{
          ok: boolean;
          data: { article: ArticleDetail; pendant: ArticleDetail | null };
        }>(`/articles/imported/${id}`);
        this.article = res.data.data.article;
        this.pendant = res.data.data.pendant;
      } finally {
        this.loading = false;
      }
    },

    frontmatterFor(article: ArticleDetail): Record<string, unknown> {
      return {
        slug: article.slug,
        locale: article.locale,
        title: article.title,
        description: article.metaDescription,
        category: article.category,
        subcategory: article.subcategory,
        author: article.author,
        publishedAt: article.publishedAt,
        updatedAt: article.frontmatterUpdatedAt,
        translationKey: article.translationKey,
        ...article.frontmatterExtras,
      };
    },

    renderMd(md: string | null): string {
      if (!md) return "";
      const r = marked.parse(md);
      return typeof r === "string" ? r : "";
    },

    onClose(): void {
      this.$emit("update:modelValue", false);
      this.article = null;
      this.pendant = null;
    },

    onModelUpdate(val: boolean): void {
      this.$emit("update:modelValue", val);
    },
  },
});
</script>
