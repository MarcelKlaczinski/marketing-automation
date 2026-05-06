<template>
  <div>
    <div class="row q-col-gutter-md q-mb-lg">
      <div class="col-12 col-md-8">
        <div class="overview-card">
          <div class="overview-card__header">
            <div class="overview-card__title">{{ $t('projects.overview.contextTitle') }}</div>
            <div class="overview-card__actions">
              <span v-if="hasUnsavedChanges" class="unsaved-indicator">
                {{ $t('common.unsavedChanges') }}
              </span>
              <q-btn
                v-if="hasUnsavedChanges"
                color="primary"
                size="sm"
                :label="$t('common.save')"
                :loading="saving"
                @click="onSave"
              />
            </div>
          </div>
          <p class="text-caption text-grey-7 q-mb-md">{{ $t('projects.overview.contextHint') }}</p>
          <MarkdownEditor
            v-model="contextDraft"
            :height="500"
            @blur="onAutoSave"
          />
        </div>
      </div>

      <div class="col-12 col-md-4">
        <div class="overview-card">
          <div class="overview-card__title q-mb-md">{{ $t('projects.overview.statsTitle') }}</div>
          <div class="stat-list">
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.stats.clusters') }}</span>
              <span class="stat-row__value">{{ project.stats?.clusterCount ?? 0 }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.stats.totalArticles') }}</span>
              <span class="stat-row__value">{{ project.stats?.totalArticles ?? 0 }}</span>
            </div>
            <template v-for="(count, status) in articleCounts" :key="status">
              <div class="stat-row">
                <span class="stat-row__label">{{ $t(`articleStatus.${status}`, String(status)) }}</span>
                <span class="stat-row__value">{{ count }}</span>
              </div>
            </template>
          </div>
        </div>

        <div class="overview-card q-mt-md">
          <div class="overview-card__title q-mb-md">{{ $t('projects.overview.metaTitle') }}</div>
          <div class="stat-list">
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.industry') }}</span>
              <span class="stat-row__value">{{ $t(`industries.${project.industry}`) }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.pipelineTemplate') }}</span>
              <span class="stat-row__value">{{ $t(`pipelineTemplates.${project.pipelineTemplate}`) }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.created') }}</span>
              <span class="stat-row__value">{{ formatDate(project.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import MarkdownEditor from 'src/components/common/MarkdownEditor.vue';
import type { Project } from 'src/stores/projects';

export default defineComponent({
  name: 'ProjectOverviewPanel',

  components: { MarkdownEditor },

  props: {
    project: { type: Object as PropType<Project>, required: true },
  },

  emits: ['updated'],

  setup() {
    return {
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data() {
    return {
      contextDraft: this.project.marketingContextMd ?? '',
      lastSaved: this.project.marketingContextMd ?? '',
      saving: false,
    };
  },

  computed: {
    hasUnsavedChanges(): boolean {
      return this.contextDraft !== this.lastSaved;
    },
    articleCounts(): Record<string, number> {
      return this.project.stats?.articleCounts ?? {};
    },
  },

  watch: {
    'project.marketingContextMd'(newVal: string | null): void {
      if (newVal !== this.lastSaved) {
        this.contextDraft = newVal ?? '';
        this.lastSaved = newVal ?? '';
      }
    },
  },

  methods: {
    async onSave(): Promise<void> {
      if (!this.hasUnsavedChanges) return;
      this.saving = true;
      try {
        await this.projectsStore.update(this.project.slug, {
          marketingContextMd: this.contextDraft,
        });
        this.lastSaved = this.contextDraft;
        this.notify.success(this.$t('projects.overview.saveSuccess') as string);
        this.$emit('updated');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },

    async onAutoSave(): Promise<void> {
      if (this.hasUnsavedChanges) {
        await this.onSave();
      }
    },

    formatDate(iso: string): string {
      const locale = this.$i18n.locale === 'de' ? 'de-DE' : 'en-US';
      return new Date(iso).toLocaleDateString(locale);
    },
  },
});
</script>

<style lang="scss" scoped>
.overview-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.overview-card__header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.overview-card__title {
  font-size: 16px;
  font-weight: 600;
  flex-grow: 1;
}

.overview-card__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.unsaved-indicator {
  font-size: 12px;
  color: var(--q-warning, #f2c037);
}

.stat-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.stat-row__label {
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
}

.stat-row__value {
  font-weight: 500;
}
</style>
