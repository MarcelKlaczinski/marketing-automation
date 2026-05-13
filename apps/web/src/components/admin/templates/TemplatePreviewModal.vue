<template>
  <q-dialog v-model="show" maximized>
    <q-card>
      <q-toolbar class="bg-dark text-white">
        <q-toolbar-title class="row items-center no-wrap q-gutter-x-sm">
          <span>{{ previewData?.templateKey }}</span>
          <q-chip dense size="sm" color="grey-8" text-color="white">
            {{ previewData?.fixtureKey }}
          </q-chip>
        </q-toolbar-title>

        <q-btn-toggle
          v-model="currentTheme"
          dense
          flat
          :options="[
            { label: $t('admin.templates.dark'), value: 'dark' },
            { label: $t('admin.templates.light'), value: 'light' },
          ]"
          @update:model-value="reload"
        />

        <q-btn-toggle
          v-model="currentLocale"
          dense
          flat
          class="q-ml-sm"
          :options="[
            { label: 'DE', value: 'de' },
            { label: 'EN', value: 'en' },
          ]"
          @update:model-value="reload"
        />

        <q-btn-toggle
          v-model="dataSource"
          dense
          flat
          class="q-ml-sm"
          :options="[
            { label: $t('admin.templates.fixture'), value: 'fixture' },
            { label: $t('admin.templates.sampleArticle'), value: 'sample-article' },
          ]"
          @update:model-value="onSourceChange"
        />

        <q-btn flat dense icon="refresh" class="q-ml-sm" @click="forceReload" />
        <q-btn flat dense icon="close" v-close-popup />
      </q-toolbar>

      <q-card-section class="q-pa-md">
        <!-- Article picker (sample-article mode) -->
        <div v-if="dataSource === 'sample-article'" class="q-mb-md">
          <q-select
            v-model="selectedArticleId"
            :options="eligibleArticles"
            :label="$t('admin.templates.selectArticle') as string"
            :no-options-label="$t('admin.templates.noEligibleArticles') as string"
            :loading="loadingArticles"
            emit-value
            map-options
            outlined
            dense
            @update:model-value="reload"
          />
        </div>

        <!-- Loading spinner -->
        <div v-if="loading" class="text-center q-pa-xl">
          <q-spinner size="md" />
          <div class="text-caption text-grey-6 q-mt-sm">{{ $t('admin.templates.rendering') }}</div>
        </div>

        <!-- Slides grid -->
        <div v-else-if="renderResult" class="row q-col-gutter-md">
          <div
            v-for="(slide, i) in renderResult.slides"
            :key="i"
            class="col-12 col-sm-6 col-md-4 col-lg-3"
          >
            <q-img
              :src="slideUrl(slide.filePath)"
              :ratio="slide.width / slide.height"
              spinner-color="grey-6"
              class="rounded-borders"
            />
            <div class="text-caption text-center q-mt-xs text-grey-6">
              {{ $t('admin.templates.slide', { n: i + 1 }) }}
            </div>
          </div>
        </div>

        <!-- Caption + Hashtags -->
        <template v-if="renderResult">
          <div class="q-mt-lg">
            <div class="text-subtitle2 q-mb-xs">{{ $t('admin.templates.caption') }}</div>
            <q-input
              type="textarea"
              :model-value="renderResult.caption"
              readonly
              outlined
              autogrow
              dense
            />
          </div>

          <div class="q-mt-md">
            <div class="text-subtitle2 q-mb-xs">
              {{ $t('admin.templates.hashtags', { n: renderResult.hashtags.length }) }}
            </div>
            <div>
              <q-chip
                v-for="tag in renderResult.hashtags"
                :key="tag"
                dense
                size="sm"
              >
                #{{ tag }}
              </q-chip>
            </div>
          </div>
        </template>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { api } from 'src/lib/api-client';

interface PreviewPayload {
  templateKey: string;
  fixtureKey: string;
  theme: 'dark' | 'light';
}

interface SlideOutput {
  filePath: string;
  width: number;
  height: number;
}

interface RenderResult {
  slides: SlideOutput[];
  caption: string;
  hashtags: string[];
  metadata: { estimatedCostUsd: number; templateKey: string };
}

interface ArticleOption {
  label: string;
  value: string;
}

export default defineComponent({
  name: 'TemplatePreviewModal',
  props: {
    modelValue: { type: Boolean, required: true },
    previewData: { type: Object as PropType<PreviewPayload | null>, default: null },
  },
  emits: ['update:modelValue'],
  data: () => ({
    show: false,
    currentTheme: 'dark' as 'dark' | 'light',
    currentLocale: 'de' as 'de' | 'en',
    dataSource: 'fixture' as 'fixture' | 'sample-article',
    selectedArticleId: null as string | null,
    eligibleArticles: [] as ArticleOption[],
    loadingArticles: false,
    renderResult: null as RenderResult | null,
    loading: false,
  }),
  watch: {
    modelValue(v: boolean) {
      this.show = v;
      if (v && this.previewData) {
        this.currentTheme = this.previewData.theme ?? 'dark';
        this.dataSource = 'fixture';
        void this.reload();
      }
    },
    show(v: boolean) {
      this.$emit('update:modelValue', v);
    },
  },
  methods: {
    slideUrl(filePath: string): string {
      const base = (import.meta.env.VITE_API_BASE_URL as string ?? '').replace(/\/api$/, '');
      // filePath is already a /renders/... path — just prepend the origin
      return filePath.startsWith('http') ? filePath : `${base}${filePath}`;
    },
    async onSourceChange() {
      if (this.dataSource === 'sample-article') {
        // Reset article selection so loadEligibleArticles auto-selects the first eligible one
        this.selectedArticleId = null;
        this.eligibleArticles = [];
        await this.loadEligibleArticles();
      }
      await this.reload();
    },
    async loadEligibleArticles() {
      if (!this.previewData) return;
      this.loadingArticles = true;
      try {
        const res = await api.get<{ ok: boolean; data: { articles: { id: string; title: string; slug: string }[] } }>(
          `/admin/templates/${this.previewData.templateKey}/eligible-articles`,
          { params: { locale: this.currentLocale } },
        );
        this.eligibleArticles = res.data.data.articles.map((a) => ({
          label: `${a.title} (${a.slug})`,
          value: a.id,
        }));
        if (this.eligibleArticles.length > 0 && !this.selectedArticleId) {
          this.selectedArticleId = this.eligibleArticles[0]?.value ?? null;
        }
      } finally {
        this.loadingArticles = false;
      }
    },
    async reload() {
      if (!this.previewData) return;
      this.loading = true;
      try {
        const body: Record<string, unknown> = {
          theme: this.currentTheme,
          locale: this.currentLocale,
          source: this.dataSource,
        };
        if (this.dataSource === 'fixture') {
          body.fixtureKey = this.previewData.fixtureKey;
        } else {
          // Always refresh article list on reload — locale or theme change may alter eligibility.
          // Reset selectedArticleId so loadEligibleArticles picks the first from the new locale.
          this.selectedArticleId = null;
          this.eligibleArticles = [];
          await this.loadEligibleArticles();
          body.sampleArticleId = this.selectedArticleId;
        }
        const res = await api.post<{ ok: boolean; data: RenderResult }>(
          `/admin/templates/${this.previewData.templateKey}/preview`,
          body,
        );
        this.renderResult = res.data.data;
      } finally {
        this.loading = false;
      }
    },
    async forceReload() {
      if (!this.previewData) return;
      this.loading = true;
      try {
        const body: Record<string, unknown> = {
          theme: this.currentTheme,
          locale: this.currentLocale,
          source: this.dataSource,
          force: true,
        };
        if (this.dataSource === 'fixture') {
          body.fixtureKey = this.previewData.fixtureKey;
        } else {
          body.sampleArticleId = this.selectedArticleId;
        }
        const res = await api.post<{ ok: boolean; data: RenderResult }>(
          `/admin/templates/${this.previewData.templateKey}/preview`,
          body,
        );
        this.renderResult = res.data.data;
      } finally {
        this.loading = false;
      }
    },
  },
});
</script>
