<template>
  <div class="action-panel">
    <div class="action-panel__section">
      <div class="action-panel__title">{{ $t('articles.actions.pipelineActions') }}</div>
      <div v-if="activePipelineRun" class="active-run-banner">
        <q-spinner size="12px" color="primary" />
        <span>{{ $t('articles.actions.runningStep', { step: activePipelineRun.stepName || activePipelineRun.pipelineName }) }}</span>
      </div>
      <div class="action-list">
        <PipelineActionRow
          v-for="action in availableActions"
          :key="action.id"
          :action="action"
          :loading="loadingAction === action.id"
          @click="onAction(action)"
        />

        <!-- ── Hero image generation (has its own dialog) ──────────────── -->
        <button
          :class="['action-row', { 'action-row--disabled': !heroImageEnabled || heroGenerating }]"
          :disabled="!heroImageEnabled || heroGenerating"
          type="button"
          @click="onOpenHeroDialog"
        >
          <q-tooltip v-if="!heroImageEnabled">{{ $t('articles.actions.heroNeedsOutline') }}</q-tooltip>
          <q-icon name="image" size="18px" class="action-row__icon" />
          <span class="action-row__label">{{ $t('articles.actions.generateHero') }}</span>
          <q-spinner v-if="heroGenerating" size="14px" color="primary" class="action-row__spinner" />
          <q-icon v-else-if="heroImageEnabled" name="chevron_right" size="14px" class="action-row__chevron" />
        </button>

        <!-- ── Localize (create translation / fresh version) ──────────── -->
        <button
          :class="['action-row', { 'action-row--disabled': localizing }]"
          :disabled="localizing"
          type="button"
          @click="localizeDialogOpen = true"
        >
          <q-icon name="translate" size="18px" class="action-row__icon" />
          <span class="action-row__label">
            {{ $t('articles.actions.createLocaleVersion', { locale: targetLocaleLabel }) }}
          </span>
          <q-badge v-if="translationSibling" color="positive" :label="translationSibling.status" class="q-mr-xs" />
          <q-spinner v-if="localizing" size="14px" color="primary" class="action-row__spinner" />
          <q-icon v-else name="chevron_right" size="14px" class="action-row__chevron" />
        </button>
      </div>
    </div>

    <div class="action-panel__section">
      <div class="action-panel__title">{{ $t('articles.actions.lastRunStatus') }}</div>
      <ArticleRecentRunsList :detail="detail" :article-id="articleId" />
    </div>

    <!-- ── Hero image prompt dialog ───────────────────────────────────────── -->
    <q-dialog v-model="heroDialogOpen" persistent>
      <q-card style="min-width: 480px; max-width: 640px;">
        <q-card-section>
          <div class="text-h6">{{ $t('articles.actions.heroDialogTitle') }}</div>
          <div class="text-caption text-grey-6 q-mt-xs">{{ $t('articles.actions.heroDialogHint') }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input
            v-model="heroPromptDraft"
            type="textarea"
            outlined
            autogrow
            :label="$t('articles.actions.heroPromptLabel') as string"
          />
          <div v-if="heroImageStyle" class="text-caption text-grey-6 q-mt-xs">
            {{ $t('articles.actions.heroStyle') }}: <strong>{{ heroImageStyle }}</strong>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup :disable="heroGenerating" />
          <q-btn
            color="primary"
            icon="auto_awesome"
            :label="$t('articles.actions.heroGenerate')"
            :loading="heroGenerating"
            @click="onGenerateHero"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
    <!-- ── Localize dialog ───────────────────────────────────────────────── -->
    <q-dialog v-model="localizeDialogOpen" persistent>
      <q-card style="min-width: 480px; max-width: 600px;">
        <q-card-section>
          <div class="text-h6">{{ $t('articles.actions.localizeDialogTitle', { locale: targetLocaleLabel }) }}</div>
          <div class="text-caption text-grey-6 q-mt-xs">{{ $t('articles.actions.localizeDialogHint') }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none q-gutter-sm">
          <!-- translate mode -->
          <q-card
            flat bordered clickable
            :class="localizeMode === 'translate' ? 'bg-blue-1 border-primary' : ''"
            class="cursor-pointer"
            @click="localizeMode = 'translate'"
          >
            <q-card-section class="q-py-sm">
              <div class="row items-center no-wrap gap-sm">
                <q-icon name="auto_awesome" size="20px" color="primary" class="q-mr-sm" />
                <div>
                  <div class="text-weight-medium">{{ $t('articles.actions.localizeTranslateTitle') }}</div>
                  <div class="text-caption text-grey-7">{{ $t('articles.actions.localizeTranslateHint') }}</div>
                </div>
                <q-space />
                <q-radio :model-value="localizeMode" val="translate" @update:model-value="localizeMode = 'translate'" />
              </div>
            </q-card-section>
          </q-card>
          <!-- fresh mode -->
          <q-card
            flat bordered clickable
            :class="localizeMode === 'fresh' ? 'bg-blue-1 border-primary' : ''"
            class="cursor-pointer"
            @click="localizeMode = 'fresh'"
          >
            <q-card-section class="q-py-sm">
              <div class="row items-center no-wrap gap-sm">
                <q-icon name="edit_note" size="20px" color="secondary" class="q-mr-sm" />
                <div>
                  <div class="text-weight-medium">{{ $t('articles.actions.localizeFreshTitle') }}</div>
                  <div class="text-caption text-grey-7">{{ $t('articles.actions.localizeFreshHint') }}</div>
                </div>
                <q-space />
                <q-radio :model-value="localizeMode" val="fresh" @update:model-value="localizeMode = 'fresh'" />
              </div>
            </q-card-section>
          </q-card>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup :disable="localizing" />
          <q-btn
            color="primary"
            icon="translate"
            :label="$t('articles.actions.localizeStart')"
            :loading="localizing"
            @click="onLocalize"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { useNotify } from "src/composables/useNotify";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import { useArticlesStore } from "src/stores/articles";
import type { ArticleDetail } from "src/stores/articles";
import { useProjectsStore } from "src/stores/projects";
import { type PropType, defineComponent } from "vue";
import ArticleRecentRunsList from "./ArticleRecentRunsList.vue";
import PipelineActionRow from "./PipelineActionRow.vue";
import type { ActionDef } from "./PipelineActionRow.vue";

interface PipelineAction extends ActionDef {
  enabledWhen: (status: string) => boolean;
  triggerFn: (articleId: string) => Promise<{ runId: string; jobId: string; deduped: boolean }>;
  disabledTooltipKey?: string;
}

export default defineComponent({
  name: "ArticleActionPanel",

  components: { PipelineActionRow, ArticleRecentRunsList },

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ["action-triggered"],

  data: () => {
    // Stores are singletons accessed via lazy thunks — safe in arrow-shorthand data()
    const s = () => useArticlesStore();
    const p = () => useProjectsStore();
    const actions: PipelineAction[] = [
      {
        id: "outline",
        i18nKey: "articles.actions.generateOutline",
        icon: "list",
        enabled: false,
        enabledWhen: (status) => !["generating", "drafting"].includes(status),
        triggerFn: (id) => s().triggerOutline(id),
      },
      {
        id: "draft",
        i18nKey: "articles.actions.generateDraft",
        icon: "description",
        enabled: false,
        enabledWhen: (status) => ["outline_review", "final_review", "ready_to_publish", "blocked_by_pagespeed", "failed"].includes(status),
        triggerFn: (id) => s().triggerDraft(id),
      },
      {
        id: "sync",
        i18nKey: "articles.actions.syncToAstro",
        icon: "cloud_upload",
        enabled: false,
        enabledWhen: (status) =>
          ["ready_to_publish", "published", "blocked_by_pagespeed"].includes(status),
        triggerFn: (id) => s().triggerSync(id),
      },
      {
        id: "validate-pagespeed-local",
        i18nKey: "articles.actions.validatePagespeedLocal",
        icon: "computer",
        enabled: false,
        disabledTooltipKey: "articles.actions.pagespeedNotSynced",
        enabledWhen: () => true,
        triggerFn: (id) => s().triggerPagespeedValidation(id, "local"),
      },
      {
        id: "validate-pagespeed-api",
        i18nKey: "articles.actions.validatePagespeedApi",
        icon: "cloud",
        enabled: false,
        disabledTooltipKey: "articles.actions.validatePagespeedApiDisabled",
        enabledWhen: () => p().current?.domain != null,
        triggerFn: (id) => s().triggerPagespeedValidation(id, "api"),
      },
      {
        id: "extend-schema",
        i18nKey: "articles.actions.extendSchema",
        icon: "data_object",
        enabled: false,
        enabledWhen: (status) => ["final_review", "ready_to_publish", "published"].includes(status),
        triggerFn: (id) => s().triggerSchemaExtension(id),
      },
    ];
    return {
      loadingAction: null as string | null,
      actions,
      heroDialogOpen: false,
      heroPromptDraft: "",
      heroGenerating: false,
      localizeDialogOpen: false,
      localizeMode: "translate" as "translate" | "fresh",
      localizing: false,
    };
  },

  computed: {
    articleId(): string {
      return (this.detail.article as { id: string }).id;
    },

    articleStatus(): string {
      return (this.detail.article as { status: string }).status;
    },

    activePipelineRun(): { pipelineName: string; status: string; stepName: string | null } | null {
      const runs = (this.detail.recentRuns.pipeline ?? []) as Record<string, unknown>[];
      const active = runs.find((r) =>
        ["queued", "running"].includes(r.status as string)
      );
      if (!active) return null;
      return {
        pipelineName: active.pipelineName as string,
        status: active.status as string,
        stepName: (active.stepName as string | null) ?? null,
      };
    },

    astroCommitSha(): string | null {
      return ((this.detail.article as Record<string, unknown>).astroCommitSha as string | null) ?? null;
    },

    hasLocalAstroPath(): boolean {
      const repo = (this.detail.article as Record<string, unknown>).projectAstroLocalPath;
      return typeof repo === "string" && repo.length > 0;
    },

    articleTitle(): string | null {
      const t = (this.detail.article as Record<string, unknown>).title;
      return typeof t === "string" && t.trim().length > 0 ? t.trim() : null;
    },

    heroOutlinePrompt(): string {
      const outline = (this.detail.article as Record<string, unknown>).outline as Record<string, unknown> | null | undefined;
      return (outline?.heroImagePrompt as string | undefined) ?? "";
    },

    heroImageStyle(): string {
      const outline = (this.detail.article as Record<string, unknown>).outline as Record<string, unknown> | null | undefined;
      return (outline?.heroImageStyle as string | undefined) ?? "";
    },

    heroImageEnabled(): boolean {
      return this.heroOutlinePrompt.length > 0;
    },

    articleLocale(): string {
      return ((this.detail.article as Record<string, unknown>).locale as string | null) ?? "de";
    },

    targetLocale(): "de" | "en" {
      return this.articleLocale === "de" ? "en" : "de";
    },

    targetLocaleLabel(): string {
      return this.$t(`articles.actions.localeLabel.${this.targetLocale}`) as string;
    },

    translationSibling(): { id: string; locale: string; status: string } | null {
      return ((this.detail.article as Record<string, unknown>).translationSibling as { id: string; locale: string; status: string } | null) ?? null;
    },

    availableActions(): PipelineAction[] {
      const active = this.activePipelineRun;
      return this.actions.map((a) => {
        // Outline requires a title so the LLM has an editorial anchor to work from
        if (a.id === "outline" && !this.articleTitle) {
          return { ...a, enabled: false, disabledTooltipKey: "articles.actions.outlineNeedsTitle" };
        }
        // Disable outline button when outline pipeline is running/queued
        if (a.id === "outline" && active?.pipelineName === "article:outline") {
          return { ...a, enabled: false, disabledTooltipKey: "articles.actions.alreadyRunning" };
        }
        // Disable draft button when draft pipeline is running/queued
        if (a.id === "draft" && active?.pipelineName === "article:draft") {
          return { ...a, enabled: false, disabledTooltipKey: "articles.actions.alreadyRunning" };
        }
        // Disable local PageSpeed when no local Astro path is configured for the project
        if (a.id === "validate-pagespeed-local" && !this.hasLocalAstroPath) {
          return { ...a, enabled: false, disabledTooltipKey: "articles.actions.pagespeedNotSynced" };
        }
        return { ...a, enabled: a.enabledWhen(this.articleStatus) };
      });
    },
  },

  methods: {
    async onAction(action: PipelineAction): Promise<void> {
      if (!action.enabled || this.loadingAction !== null) return;
      this.loadingAction = action.id;
      const notify = useNotify();
      try {
        const result = await action.triggerFn(this.articleId);
        if (result.deduped) {
          notify.info(this.$t("articles.actions.alreadyRunning") as string);
          return;
        }
        notify.success(
          this.$t("articles.actions.triggered", { action: this.$t(action.i18nKey) }) as string
        );
        this.$emit("action-triggered", { actionId: action.id, runId: result.runId });
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 402) {
            notify.error(this.$t("cost.errors.limitExceeded") as string);
          } else if (e.status === 423) {
            notify.error(this.$t("projectPause.errors.queuePaused") as string);
          } else {
            notify.error(e.userMessage);
          }
        }
      } finally {
        this.loadingAction = null;
      }
    },

    onOpenHeroDialog(): void {
      this.heroPromptDraft = this.heroOutlinePrompt;
      this.heroDialogOpen = true;
    },

    async onLocalize(): Promise<void> {
      const notify = useNotify();
      const s = () => useArticlesStore();
      this.localizing = true;
      try {
        const result = await s().triggerLocalize(this.articleId, this.targetLocale, this.localizeMode);
        this.localizeDialogOpen = false;
        if (result.deduped) {
          notify.info(this.$t("articles.actions.alreadyRunning") as string);
        } else {
          notify.success(this.$t("articles.actions.localizeTriggered", { locale: this.targetLocaleLabel }) as string);
        }
        this.$emit("action-triggered", { actionId: "localize", runId: result.runId });
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 402) {
            notify.error(this.$t("cost.errors.limitExceeded") as string);
          } else if (e.status === 423) {
            notify.error(this.$t("projectPause.errors.queuePaused") as string);
          } else {
            notify.error(e.userMessage);
          }
        }
      } finally {
        this.localizing = false;
      }
    },

    async onGenerateHero(): Promise<void> {
      const notify = useNotify();
      this.heroGenerating = true;
      try {
        const prompt = this.heroPromptDraft.trim();
        const body: Record<string, unknown> = {};
        if (prompt && prompt !== this.heroOutlinePrompt) body.promptOverride = prompt;

        await api.post(`/articles/${this.articleId}/generate-hero-image`, body);
        this.heroDialogOpen = false;
        notify.success(this.$t("articles.actions.heroTriggered") as string);
        this.$emit("action-triggered");
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 402) {
            notify.error(this.$t("cost.errors.limitExceeded") as string);
          } else if (e.status === 423) {
            notify.error(this.$t("projectPause.errors.queuePaused") as string);
          } else {
            notify.error(e.userMessage);
          }
        }
      } finally {
        this.heroGenerating = false;
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

// Mirrors PipelineActionRow's .action-row — used for the hero button which needs a dialog
.action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  background: var(--q-card-bg, #fff);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  color: var(--q-dark, #1d1d1d);
  transition: border-color 0.15s, background 0.15s;
  text-align: left;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
    background: var(--q-card-bg, #2a2a2a);
    color: rgba(255, 255, 255, 0.87);
  }

  &:hover:not(:disabled) {
    border-color: var(--q-primary);
    background: rgba(63, 81, 181, 0.04);
  }

  &--disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.action-row__icon {
  color: var(--q-primary);
  flex-shrink: 0;

  .action-row--disabled & { color: var(--q-grey-6, #757575); }
}

.action-row__label {
  flex-grow: 1;
  font-weight: 500;
}

.action-row__chevron {
  color: var(--q-grey-5, #9e9e9e);
  flex-shrink: 0;
}

.action-row__spinner { flex-shrink: 0; }


.active-run-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--q-primary, #3f51b5);
  margin-bottom: 8px;
  padding: 4px 8px;
  background: rgba(63, 81, 181, 0.06);
  border-radius: 4px;
}
</style>
