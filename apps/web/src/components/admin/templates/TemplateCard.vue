<template>
  <q-card>
    <q-card-section>
      <div class="text-subtitle1">{{ fixture.name }}</div>
      <div class="text-caption text-grey-7">{{ fixture.description }}</div>
    </q-card-section>

    <q-separator />

    <q-card-section class="q-pa-sm">
      <div class="row q-col-gutter-sm">
        <!-- Dark theme -->
        <div class="col-6">
          <div class="text-caption text-center q-mb-xs">{{ $t('admin.templates.dark') }}</div>
          <div
            class="preview-thumb"
            :class="{ 'preview-thumb--loading': loadingDark }"
            @click="onThumbClick('dark')"
          >
            <q-img
              v-if="darkPreviewUrl"
              :src="darkPreviewUrl"
              ratio="0.8"
              spinner-color="white"
            />
            <template v-else>
              <q-spinner v-if="loadingDark" color="grey-5" size="sm" />
              <q-btn
                v-else
                outline
                dense
                icon="play_arrow"
                :label="$t('admin.templates.render')"
                @click.stop="loadPreview('dark')"
              />
            </template>
          </div>
        </div>

        <!-- Light theme -->
        <div class="col-6">
          <div class="text-caption text-center q-mb-xs">{{ $t('admin.templates.light') }}</div>
          <div
            class="preview-thumb preview-thumb--light"
            :class="{ 'preview-thumb--loading': loadingLight }"
            @click="onThumbClick('light')"
          >
            <q-img
              v-if="lightPreviewUrl"
              :src="lightPreviewUrl"
              ratio="0.8"
              spinner-color="grey-8"
            />
            <template v-else>
              <q-spinner v-if="loadingLight" color="grey-8" size="sm" />
              <q-btn
                v-else
                outline
                dense
                icon="play_arrow"
                :label="$t('admin.templates.render')"
                @click.stop="loadPreview('light')"
              />
            </template>
          </div>
        </div>
      </div>
    </q-card-section>

    <q-card-actions>
      <q-btn
        flat
        dense
        icon="refresh"
        :label="$t('admin.templates.renderBoth')"
        @click="reloadBoth"
      />
      <q-space />
      <q-btn
        flat
        dense
        icon="open_in_new"
        :label="$t('admin.templates.detail')"
        @click="openPreview('dark')"
      />
    </q-card-actions>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { api } from 'src/lib/api-client';

interface FixtureMeta {
  key: string;
  name: string;
  description: string;
}

interface SlideOutput {
  filePath: string;
  width: number;
  height: number;
}

interface PreviewResult {
  slides: SlideOutput[];
}

export default defineComponent({
  name: 'TemplateCard',
  props: {
    templateKey: { type: String, required: true },
    fixture: { type: Object as PropType<FixtureMeta>, required: true },
  },
  emits: ['open-preview'],
  data: () => ({
    darkPreviewUrl: null as string | null,
    lightPreviewUrl: null as string | null,
    loadingDark: false,
    loadingLight: false,
  }),
  methods: {
    async loadPreview(theme: 'dark' | 'light') {
      if (theme === 'dark') {
        this.loadingDark = true;
      } else {
        this.loadingLight = true;
      }
      try {
        const apiBase = import.meta.env.VITE_API_BASE_URL as string ?? '';
        const res = await api.post<{ ok: boolean; data: PreviewResult }>(
          `/admin/templates/${this.templateKey}/preview`,
          { source: 'fixture', fixtureKey: this.fixture.key, theme, locale: 'de' },
        );
        const url = res.data.data.slides[0]?.filePath ?? null;
        // Prefix with API base to form an absolute URL for <q-img>
        const absUrl = url ? `${apiBase}${url}` : null;
        if (theme === 'dark') {
          this.darkPreviewUrl = absUrl;
        } else {
          this.lightPreviewUrl = absUrl;
        }
      } finally {
        if (theme === 'dark') {
          this.loadingDark = false;
        } else {
          this.loadingLight = false;
        }
      }
    },
    async reloadBoth() {
      this.darkPreviewUrl = null;
      this.lightPreviewUrl = null;
      await Promise.all([this.loadPreview('dark'), this.loadPreview('light')]);
    },
    onThumbClick(theme: 'dark' | 'light') {
      const url = theme === 'dark' ? this.darkPreviewUrl : this.lightPreviewUrl;
      if (url) {
        this.openPreview(theme);
      } else {
        void this.loadPreview(theme);
      }
    },
    openPreview(theme: 'dark' | 'light') {
      this.$emit('open-preview', {
        templateKey: this.templateKey,
        fixtureKey: this.fixture.key,
        theme,
      });
    },
  },
});
</script>

<style scoped>
.preview-thumb {
  aspect-ratio: 4 / 5;
  background: #1a1a1a;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.2s;
  overflow: hidden;
}
.preview-thumb--light {
  background: #f5f5f5;
}
.preview-thumb--loading {
  opacity: 0.5;
}
.preview-thumb:hover {
  opacity: 0.85;
}
</style>
