<template>
  <div class="history-panel">
    <div v-if="loading" class="text-center q-pa-lg">
      <q-spinner size="2em" color="primary" />
    </div>

    <div v-else-if="!versions.length" class="text-center q-pa-lg text-grey-6">
      {{ $t('articles.history.noVersions') }}
    </div>

    <q-list v-else separator>
      <q-item
        v-for="v in versions"
        :key="v.id"
        clickable
        v-ripple
        @click="openDiff(v)"
      >
        <q-item-section avatar>
          <q-avatar size="32px" color="primary" text-color="white" font-size="12px">
            {{ v.version }}
          </q-avatar>
        </q-item-section>

        <q-item-section>
          <q-item-label>{{ $t('articles.history.version', { n: v.version }) }}</q-item-label>
          <q-item-label caption>{{ v.changeReason || $t('articles.history.noReason') }}</q-item-label>
        </q-item-section>

        <q-item-section side>
          <q-item-label caption>{{ formatDate(v.createdAt) }}</q-item-label>
        </q-item-section>

        <q-item-section side>
          <q-icon name="compare" size="18px" color="grey-5" />
        </q-item-section>
      </q-item>
    </q-list>

    <q-dialog v-model="diffOpen" maximized transition-show="slide-up" transition-hide="slide-down">
      <q-card class="diff-dialog column no-wrap">
        <q-bar class="bg-primary text-white q-pa-sm">
          <q-icon name="history" size="18px" />
          <div class="q-ml-sm text-body2">
            {{ $t('articles.history.diffModal.title', { n: selectedVersion ? selectedVersion.version : '' }) }}
          </div>
          <q-space />
          <q-btn
            dense
            flat
            round
            icon="close"
            :aria-label="$t('articles.history.diffModal.close')"
            v-close-popup
          />
        </q-bar>

        <q-card-section v-if="diffBodyLoading" class="text-center q-pa-xl col-grow">
          <q-spinner size="2em" color="primary" />
          <div class="q-mt-sm text-caption text-grey-6">{{ $t('articles.history.diffModal.loading') }}</div>
        </q-card-section>

        <div v-else class="diff-content col-grow">
          <div class="diff-pane">
            <div class="diff-pane__title text-caption text-weight-bold text-grey-7 q-mb-sm">
              {{ $t('articles.history.diffModal.selected', { n: selectedVersion ? selectedVersion.version : '' }) }}
              <span v-if="selectedVersion" class="q-ml-sm text-grey-5">
                {{ formatDate(selectedVersion.createdAt) }}
              </span>
            </div>
            <pre class="diff-pane__body">{{ selectedBody ?? '' }}</pre>
          </div>

          <div class="diff-pane">
            <div class="diff-pane__title text-caption text-weight-bold text-grey-7 q-mb-sm">
              {{ $t('articles.history.diffModal.current') }}
            </div>
            <pre class="diff-pane__body">{{ currentBody }}</pre>
          </div>
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useArticlesStore, type ArticleVersion } from 'src/stores/articles';

export default defineComponent({
  name: 'ArticleHistoryPanel',

  props: {
    articleId: { type: String, required: true },
  },

  setup() {
    return { articlesStore: useArticlesStore() };
  },

  data: () => ({
    loading: false,
    diffOpen: false,
    selectedVersion: null as ArticleVersion | null,
    selectedBody: null as string | null,
    diffBodyLoading: false,
  }),

  computed: {
    versions(): ArticleVersion[] {
      return this.articlesStore.versionsByArticle[this.articleId] ?? [];
    },

    currentBody(): string {
      const detail = this.articlesStore.detailById[this.articleId];
      return (detail?.article as { bodyMd?: string })?.bodyMd ?? '';
    },
  },

  async created() {
    this.loading = true;
    try {
      await this.articlesStore.fetchVersions(this.articleId);
    } finally {
      this.loading = false;
    }
  },

  methods: {
    async openDiff(version: ArticleVersion): Promise<void> {
      this.selectedVersion = version;
      this.selectedBody = null;
      this.diffBodyLoading = true;
      this.diffOpen = true;
      try {
        this.selectedBody = await this.articlesStore.fetchVersionBody(this.articleId, version.version);
      } finally {
        this.diffBodyLoading = false;
      }
    },

    formatDate(iso: string): string {
      const locale = this.$i18n.locale === 'de' ? 'de-DE' : 'en-US';
      return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
    },
  },
});
</script>

<style lang="scss" scoped>
.history-panel {
  min-height: 120px;
}

.diff-dialog {
  height: 100%;
}

.diff-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
  padding: 16px;
  gap: 16px;

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
}

.diff-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;

  @media (max-width: 600px) {
    min-height: 300px;
  }
}

.diff-pane__title {
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-shrink: 0;
}

.diff-pane__body {
  flex: 1;
  overflow: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Fira Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  padding: 12px 16px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
