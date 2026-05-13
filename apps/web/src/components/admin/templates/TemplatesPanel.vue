<template>
  <div>
    <div class="row items-center q-mb-md">
      <div class="text-h5">{{ $t('admin.templates.title') }}</div>
      <q-space />
      <q-btn flat icon="refresh" :label="$t('admin.templates.reload')" @click="loadTemplates" />
    </div>

    <div v-if="loading" class="text-center q-pa-xl">
      <q-spinner size="md" />
    </div>

    <div v-else>
      <div v-for="template in templates" :key="template.key" class="q-mb-xl">
        <div class="row items-baseline q-mb-sm">
          <div class="text-h6">{{ template.displayName }}</div>
          <q-chip dense size="sm" class="q-ml-sm">{{ template.key }}</q-chip>
          <q-space />
          <div class="text-caption text-grey-7">
            {{ $t('admin.templates.slideCount', { n: template.defaultSlideCount }) }}
            · {{ $t('admin.templates.costPerRender', { cost: template.estimatedCostUsd.toFixed(3) }) }}
          </div>
        </div>

        <div class="text-body2 q-mb-md text-grey-7">{{ template.description }}</div>

        <div class="row q-col-gutter-md">
          <div
            v-for="fixture in template.fixtures"
            :key="fixture.key"
            class="col-12 col-md-6"
          >
            <TemplateCard
              :template-key="template.key"
              :fixture="fixture"
              @open-preview="onOpenPreview"
            />
          </div>
        </div>
      </div>

      <div v-if="templates.length === 0" class="text-center text-grey-6 q-pa-xl">
        <q-icon name="layers" size="3rem" class="q-mb-sm" />
        <div>{{ $t('admin.templates.empty') }}</div>
      </div>
    </div>

    <TemplatePreviewModal v-model="previewOpen" :preview-data="currentPreview" />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { api } from 'src/lib/api-client';
import TemplateCard from './TemplateCard.vue';
import TemplatePreviewModal from './TemplatePreviewModal.vue';

export interface TemplateFixtureMeta {
  key: string;
  name: string;
  description: string;
}

export interface TemplateMeta {
  key: string;
  displayName: string;
  description: string;
  defaultSlideCount: number;
  estimatedCostUsd: number;
  fixtures: TemplateFixtureMeta[];
}

export interface PreviewPayload {
  templateKey: string;
  fixtureKey: string;
  theme: 'dark' | 'light';
}

export default defineComponent({
  name: 'TemplatesPanel',
  components: { TemplateCard, TemplatePreviewModal },
  data: () => ({
    templates: [] as TemplateMeta[],
    loading: false,
    previewOpen: false,
    currentPreview: null as PreviewPayload | null,
  }),
  async mounted() {
    await this.loadTemplates();
  },
  methods: {
    async loadTemplates() {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { templates: TemplateMeta[] } }>('/admin/templates');
        this.templates = res.data.data.templates;
      } finally {
        this.loading = false;
      }
    },
    onOpenPreview(payload: PreviewPayload) {
      this.currentPreview = payload;
      this.previewOpen = true;
    },
  },
});
</script>
