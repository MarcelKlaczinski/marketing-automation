<template>
  <div class="triggers-panel">
    <header class="panel-header">
      <h3 class="panel-title">{{ article.title ?? article.slug }}</h3>
      <div class="article-meta mono">
        <span>{{ article.collection }}</span>
        <span class="sep">·</span>
        <span>{{ article.locale }}</span>
        <span class="sep">·</span>
        <span>{{ article.status }}</span>
      </div>
    </header>

    <section class="trigger-group">
      <h4 class="group-title">{{ $t("articleTools.manual.groups.pipeline") as string }}</h4>
      <div class="trigger-grid">
        <TriggerButton
          :title="$t('articleTools.manual.actions.outline.title') as string"
          :description="$t('articleTools.manual.actions.outline.description') as string"
          :loading="loadingAction === 'outline'"
          @click="onTrigger('outline')"
        />
        <TriggerButton
          :title="$t('articleTools.manual.actions.draft.title') as string"
          :description="$t('articleTools.manual.actions.draft.description') as string"
          :loading="loadingAction === 'draft'"
          @click="onTrigger('draft')"
        />
        <TriggerButton
          :title="$t('articleTools.manual.actions.heroImage.title') as string"
          :description="$t('articleTools.manual.actions.heroImage.description') as string"
          :loading="loadingAction === 'hero-image'"
          @click="onTrigger('hero-image')"
        />
        <TriggerButton
          :title="$t('articleTools.manual.actions.schema.title') as string"
          :description="$t('articleTools.manual.actions.schema.description') as string"
          :loading="loadingAction === 'schema'"
          @click="onTrigger('schema')"
        />
      </div>
    </section>

    <section class="trigger-group">
      <h4 class="group-title">{{ $t("articleTools.manual.groups.content") as string }}</h4>
      <div class="trigger-grid">
        <TriggerButton
          :title="$t('articleTools.manual.actions.refresh.title') as string"
          :description="$t('articleTools.manual.actions.refresh.description') as string"
          variant="primary"
          :loading="loadingAction === 'refresh'"
          @click="onTrigger('refresh')"
        />
        <TriggerButton
          :title="$t('articleTools.manual.actions.localize.title') as string"
          :description="$t('articleTools.manual.actions.localize.description') as string"
          :loading="loadingAction === 'localize'"
          @click="onTrigger('localize')"
        />
        <TriggerButton
          :title="$t('articleTools.manual.actions.continue.title') as string"
          :description="$t('articleTools.manual.actions.continue.description') as string"
          :loading="loadingAction === 'continue'"
          @click="onTrigger('continue')"
        />
      </div>
    </section>

    <section class="trigger-group">
      <h4 class="group-title">{{ $t("articleTools.manual.groups.deploy") as string }}</h4>
      <div class="trigger-grid">
        <TriggerButton
          :title="$t('articleTools.manual.actions.sync.title') as string"
          :description="$t('articleTools.manual.actions.sync.description') as string"
          variant="primary"
          :loading="loadingAction === 'sync'"
          @click="onTrigger('sync')"
        />
        <TriggerButton
          :title="$t('articleTools.manual.actions.pagespeed.title') as string"
          :description="$t('articleTools.manual.actions.pagespeed.description') as string"
          :loading="loadingAction === 'pagespeed'"
          @click="onTrigger('pagespeed')"
        />
        <TriggerButton
          :title="$t('articleTools.manual.actions.preview.title') as string"
          :description="$t('articleTools.manual.actions.preview.description') as string"
          :loading="loadingAction === 'preview'"
          @click="onTrigger('preview')"
        />
      </div>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import TriggerButton from "src/components/article-tools/TriggerButton.vue";
import { apiPost } from "src/lib/api";

type ActionKey =
  | "outline" | "draft" | "hero-image" | "schema"
  | "refresh" | "localize" | "continue"
  | "sync" | "pagespeed" | "preview";

const ACTION_ENDPOINTS: Record<ActionKey, string> = {
  outline: "generate-outline",
  draft: "generate-draft",
  "hero-image": "generate-hero-image",
  schema: "extend-schema",
  refresh: "refresh",
  localize: "localize",
  continue: "continue",
  sync: "sync",
  pagespeed: "validate-pagespeed",
  preview: "local-preview",
};

interface ArticleEntry {
  id: string;
  slug: string;
  title: string | null;
  collection: string;
  locale: string;
  status: string;
}

interface TriggerResponse {
  runId?: string;
  jobId?: string;
}

export default defineComponent({
  name: "ArticleTriggersPanel",

  components: { TriggerButton },

  props: {
    article: { type: Object as PropType<ArticleEntry>, required: true },
  },

  emits: ["triggered"],

  data: () => ({
    loadingAction: null as ActionKey | null,
  }),

  methods: {
    async onTrigger(action: ActionKey): Promise<void> {
      if (action === "refresh") {
        const ok = await new Promise<boolean>((resolve) => {
          this.$q.dialog({
            title: this.$t("articleTools.manual.confirmRefresh.title") as string,
            message: this.$t("articleTools.manual.confirmRefresh.message") as string,
            cancel: true,
            persistent: true,
          }).onOk(() => resolve(true)).onCancel(() => resolve(false));
        });
        if (!ok) return;
      }

      this.loadingAction = action;
      try {
        const endpoint = ACTION_ENDPOINTS[action];
        const response = await apiPost<TriggerResponse>(`/articles/${this.article.id}/${endpoint}`);

        this.$q.notify({
          type: "positive",
          message: this.$t("articleTools.manual.triggerSuccess", {
            action: this.$t(`articleTools.manual.actions.${action}.title`) as string,
          }) as string,
        });

        this.$emit("triggered", { action, runId: response.runId ?? response.jobId });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("articleTools.manual.triggerError") as string),
        });
      } finally {
        this.loadingAction = null;
      }
    },
  },
});
</script>

<style scoped>
.triggers-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.sep {
  opacity: 0.4;
}

.trigger-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
}

.trigger-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
