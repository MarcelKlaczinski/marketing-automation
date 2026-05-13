<template>
  <q-card flat bordered class="template-card">
    <q-card-section class="q-pb-sm">
      <div class="text-subtitle2 text-weight-medium">{{ fixture.name }}</div>
      <div class="text-caption text-grey-6 q-mt-xs" style="line-height: 1.4">{{ fixture.description }}</div>
    </q-card-section>

    <q-card-section class="q-pt-none q-pb-sm q-px-sm">
      <div class="row q-col-gutter-sm">
        <!-- Dark theme slot -->
        <div class="col-6">
          <div class="theme-label text-caption text-grey-5 q-mb-xs text-center">Dark</div>
          <div class="thumb-slot thumb-slot--dark" @click="onThumbClick('dark')">
            <q-img
              v-if="darkPreviewUrl"
              :src="darkPreviewUrl"
              class="thumb-img"
              fit="cover"
              :ratio="4/5"
              spinner-color="grey-5"
              no-spinner
            >
              <template #error>
                <div class="thumb-error">
                  <q-icon name="broken_image" size="sm" color="grey-6" />
                </div>
              </template>
            </q-img>
            <div v-else-if="loadingDark" class="thumb-loading">
              <q-spinner color="grey-4" size="24px" />
            </div>
            <div v-else class="thumb-empty" @click.stop="loadPreview('dark')">
              <q-icon name="play_circle_outline" size="32px" color="grey-6" class="q-mb-xs" />
              <div class="text-caption text-grey-5">{{ $t('admin.templates.render') }}</div>
            </div>
          </div>
        </div>

        <!-- Light theme slot -->
        <div class="col-6">
          <div class="theme-label text-caption text-grey-7 q-mb-xs text-center">Light</div>
          <div class="thumb-slot thumb-slot--light" @click="onThumbClick('light')">
            <q-img
              v-if="lightPreviewUrl"
              :src="lightPreviewUrl"
              class="thumb-img"
              fit="cover"
              :ratio="4/5"
              spinner-color="grey-7"
              no-spinner
            >
              <template #error>
                <div class="thumb-error thumb-error--light">
                  <q-icon name="broken_image" size="sm" color="grey-5" />
                </div>
              </template>
            </q-img>
            <div v-else-if="loadingLight" class="thumb-loading thumb-loading--light">
              <q-spinner color="grey-7" size="24px" />
            </div>
            <div v-else class="thumb-empty thumb-empty--light" @click.stop="loadPreview('light')">
              <q-icon name="play_circle_outline" size="32px" color="grey-5" class="q-mb-xs" />
              <div class="text-caption text-grey-6">{{ $t('admin.templates.render') }}</div>
            </div>
          </div>
        </div>
      </div>
    </q-card-section>

    <q-separator />

    <q-card-actions class="q-px-sm q-py-xs">
      <q-btn
        flat
        dense
        size="sm"
        icon="refresh"
        :label="$t('admin.templates.renderBoth')"
        color="grey-7"
        :loading="loadingDark || loadingLight"
        @click="reloadBoth"
      />
      <q-space />
      <q-btn
        flat
        dense
        size="sm"
        icon="open_in_new"
        :label="$t('admin.templates.detail')"
        color="primary"
        :disable="!darkPreviewUrl && !lightPreviewUrl"
        @click="openPreview(darkPreviewUrl ? 'dark' : 'light')"
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
      if (theme === 'dark') this.loadingDark = true;
      else this.loadingLight = true;
      try {
        // Strip /api suffix: VITE_API_BASE_URL is e.g. "http://localhost:3050/api" but
        // /renders/* is served at the origin root, not under /api.
        const origin = (import.meta.env.VITE_API_BASE_URL as string ?? '').replace(/\/api$/, '');
        const res = await api.post<{ ok: boolean; data: PreviewResult }>(
          `/admin/templates/${this.templateKey}/preview`,
          { source: 'fixture', fixtureKey: this.fixture.key, theme, locale: 'de' },
        );
        const url = res.data.data.slides[0]?.filePath ?? null;
        const absUrl = url ? `${origin}${url}` : null;
        if (theme === 'dark') this.darkPreviewUrl = absUrl;
        else this.lightPreviewUrl = absUrl;
      } finally {
        if (theme === 'dark') this.loadingDark = false;
        else this.loadingLight = false;
      }
    },
    async reloadBoth() {
      this.darkPreviewUrl = null;
      this.lightPreviewUrl = null;
      await Promise.all([this.loadPreview('dark'), this.loadPreview('light')]);
    },
    onThumbClick(theme: 'dark' | 'light') {
      const url = theme === 'dark' ? this.darkPreviewUrl : this.lightPreviewUrl;
      if (url) this.openPreview(theme);
      else void this.loadPreview(theme);
    },
    openPreview(theme: 'dark' | 'light') {
      this.$emit('open-preview', { templateKey: this.templateKey, fixtureKey: this.fixture.key, theme });
    },
  },
});
</script>

<style scoped>
.template-card {
  border-radius: 8px;
  transition: box-shadow 0.2s;
}
.template-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

.thumb-slot {
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 4 / 5;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: transform 0.15s;
}
.thumb-slot:hover {
  transform: scale(1.02);
}
.thumb-slot--dark  { background: #1c1c1e; }
.thumb-slot--light { background: #f2f2f7; }

.thumb-img {
  width: 100%;
  height: 100%;
  border-radius: 6px;
}

.thumb-loading,
.thumb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.thumb-error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: #1c1c1e;
}
.thumb-error--light { background: #f2f2f7; }

.theme-label {
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
</style>
