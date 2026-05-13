<template>
  <div class="project-suggestions-panel">
    <div v-if="loading" class="flex flex-center q-py-xl">
      <q-spinner size="40px" color="primary" />
    </div>

    <div v-else-if="articles.length === 0" class="text-center text-grey q-py-xl">
      <q-icon name="auto_awesome" size="48px" color="grey-4" class="q-mb-sm" />
      <p class="text-body2">{{ $t('projects.social.empty') }}</p>
      <p class="text-caption text-grey-5">{{ $t('projects.social.emptyHint') }}</p>
    </div>

    <div v-else>
      <p class="text-caption text-grey-6 q-mb-md">
        {{ $t('projects.social.pendingSuggestions', { count: articles.length }) }}
      </p>

      <q-list separator>
        <q-item
          v-for="article in articles"
          :key="article.id"
          class="q-px-none q-py-sm"
          style="display: block"
        >
          <div class="row items-center q-mb-xs">
            <router-link
              :to="{ name: 'article-detail', params: { id: article.id } }"
              class="text-weight-medium text-primary"
              style="text-decoration: none"
            >
              {{ article.title || article.slug }}
            </router-link>
            <q-chip dense size="sm" color="grey-3" text-color="grey-8" class="q-ml-sm">
              {{ article.collection }}
            </q-chip>
            <q-chip dense size="sm" color="blue-1" text-color="blue-8" class="q-ml-xs">
              {{ article.locale }}
            </q-chip>
          </div>
          <TemplateSuggestionsPanel :article-id="article.id" />
        </q-item>
      </q-list>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";
import TemplateSuggestionsPanel from "src/components/articles/TemplateSuggestionsPanel.vue";

interface ArticleWithSuggestions {
  id: string;
  slug: string;
  title: string | null;
  collection: string;
  locale: string;
}

export default defineComponent({
  name: "ProjectSuggestionsPanel",

  components: { TemplateSuggestionsPanel },

  props: {
    slug: { type: String, required: true },
  },

  data: () => ({
    loading: false,
    articles: [] as ArticleWithSuggestions[],
  }),

  async mounted() {
    await this.loadSuggestions();
  },

  watch: {
    slug() {
      void this.loadSuggestions();
    },
  },

  methods: {
    async loadSuggestions(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{
          ok: boolean;
          data: { items: ArticleWithSuggestions[] };
        }>(`/projects/${this.slug}/social-suggestions`);
        if (res.data.ok) {
          this.articles = res.data.data.items;
        }
      } catch {
        // error surfaced by api-client interceptor
      } finally {
        this.loading = false;
      }
    },
  },
});
</script>
