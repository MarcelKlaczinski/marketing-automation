<template>
  <div class="action-panel">
    <div class="action-panel__section">
      <div class="action-panel__title">{{ $t('articles.actions.pipelineActions') }}</div>
      <div class="action-list">
        <PipelineActionRow
          v-for="action in availableActions"
          :key="action.id"
          :action="action"
          :loading="loadingAction === action.id"
          @click="onAction(action)"
        />
      </div>
    </div>

    <div class="action-panel__section">
      <div class="action-panel__title">{{ $t('articles.actions.lastRunStatus') }}</div>
      <ArticleRecentRunsList :detail="detail" :article-id="articleId" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { useArticlesStore } from 'src/stores/articles';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import PipelineActionRow from './PipelineActionRow.vue';
import ArticleRecentRunsList from './ArticleRecentRunsList.vue';
import type { ArticleDetail } from 'src/stores/articles';
import type { ActionDef } from './PipelineActionRow.vue';

interface PipelineAction extends ActionDef {
  enabledWhen: (status: string) => boolean;
  triggerFn: (articleId: string) => Promise<{ runId: string; jobId: string; deduped: boolean }>;
}

export default defineComponent({
  name: 'ArticleActionPanel',

  components: { PipelineActionRow, ArticleRecentRunsList },

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ['action-triggered'],

  setup() {
    return {
      articlesStore: useArticlesStore(),
      notify: useNotify(),
    };
  },

  data: () => {
    // triggerFn uses useArticlesStore() lazily at call-time — store is a singleton
    const s = () => useArticlesStore();
    const actions: PipelineAction[] = [
      {
        id: 'outline',
        i18nKey: 'articles.actions.generateOutline',
        icon: 'list',
        enabled: false,
        enabledWhen: (status) => ['proposed', 'approved', 'failed'].includes(status),
        triggerFn: (id) => s().triggerOutline(id),
      },
      {
        id: 'draft',
        i18nKey: 'articles.actions.generateDraft',
        icon: 'description',
        enabled: false,
        enabledWhen: (status) => status === 'outline_review',
        triggerFn: (id) => s().triggerDraft(id),
      },
      {
        id: 'sync',
        i18nKey: 'articles.actions.syncToAstro',
        icon: 'cloud_upload',
        enabled: false,
        enabledWhen: (status) => ['ready_to_publish', 'published', 'blocked_by_pagespeed'].includes(status),
        triggerFn: (id) => s().triggerSync(id),
      },
      {
        id: 'validate-pagespeed',
        i18nKey: 'articles.actions.validatePagespeed',
        icon: 'speed',
        enabled: false,
        enabledWhen: (status) => ['published', 'blocked_by_pagespeed', 'ready_to_publish'].includes(status),
        triggerFn: (id) => s().triggerPagespeedValidation(id),
      },
      {
        id: 'extend-schema',
        i18nKey: 'articles.actions.extendSchema',
        icon: 'data_object',
        enabled: false,
        enabledWhen: (status) => ['final_review', 'ready_to_publish', 'published'].includes(status),
        triggerFn: (id) => s().triggerSchemaExtension(id),
      },
    ];
    return {
      loadingAction: null as string | null,
      actions,
    };
  },

  computed: {
    articleId(): string {
      return (this.detail.article as { id: string }).id;
    },

    articleStatus(): string {
      return (this.detail.article as { status: string }).status;
    },

    availableActions(): PipelineAction[] {
      return this.actions.map((a) => ({
        ...a,
        enabled: a.enabledWhen(this.articleStatus),
      }));
    },
  },

  methods: {
    async onAction(action: PipelineAction): Promise<void> {
      if (!action.enabled || this.loadingAction !== null) return;
      this.loadingAction = action.id;
      try {
        const result = await action.triggerFn(this.articleId);
        if (result.deduped) {
          this.notify.info(this.$t('articles.actions.alreadyRunning') as string);
          return;
        }
        this.notify.success(this.$t('articles.actions.triggered', { action: this.$t(action.i18nKey) }) as string);
        this.$emit('action-triggered', { actionId: action.id, runId: result.runId });
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 402) {
            this.notify.error(this.$t('cost.errors.limitExceeded') as string);
          } else if (e.status === 423) {
            this.notify.error(this.$t('projectPause.errors.queuePaused') as string);
          } else {
            this.notify.error(e.userMessage);
          }
        }
      } finally {
        this.loadingAction = null;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.action-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.action-panel__section {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
    background: var(--q-card-bg, #1d1d1d);
  }
}

.action-panel__title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 10px;
}

.action-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
