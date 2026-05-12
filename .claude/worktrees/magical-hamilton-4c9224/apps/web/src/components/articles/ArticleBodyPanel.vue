<template>
  <div class="body-panel">

    <!-- ── Outline (collapsible, always visible when exists) ──────────────── -->
    <q-expansion-item
      v-if="article.outline"
      v-model="outlineOpen"
      icon="list"
      :label="$t('articles.body.outlineTitle')"
      header-class="text-subtitle2 q-px-none"
      class="q-mb-md"
      dense
    >
      <q-card flat bordered>
        <q-card-section>
          <pre class="outline-preview">{{ outlineMarkdown }}</pre>
        </q-card-section>
      </q-card>
    </q-expansion-item>

    <!-- ── Draft editor ───────────────────────────────────────────────────── -->
    <div class="body-panel__toolbar">
      <span class="text-subtitle2 text-grey-7">{{ $t('articles.body.draftTitle') }}</span>
      <span v-if="hasUnsavedChanges" class="unsaved-indicator q-ml-sm">
        <q-icon name="edit_note" size="14px" class="q-mr-xs" />
        {{ $t('common.unsavedChanges') }}
      </span>
      <q-space />
      <q-btn
        flat
        size="sm"
        :label="$t('articles.body.discard')"
        :disable="!hasUnsavedChanges || saving"
        @click="onDiscard"
      />
      <q-btn
        color="primary"
        size="sm"
        :label="$t('articles.body.save')"
        :disable="!hasUnsavedChanges"
        :loading="saving"
        @click="onSaveClick"
      />
    </div>

    <MarkdownEditor
      v-model="bodyDraft"
      :height="550"
    />

    <q-dialog v-model="saveDialogOpen" persistent>
      <q-card style="min-width: 420px; max-width: 560px;">
        <q-card-section>
          <div class="text-h6">{{ $t('articles.body.saveDialog.title') }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input
            v-model="changeReason"
            outlined
            :label="$t('articles.body.saveDialog.changeReason')"
            type="textarea"
            autogrow
            :placeholder="$t('articles.body.saveDialog.changeReasonPlaceholder') as string"
          />
          <q-checkbox
            v-model="resyncAfterSave"
            :disable="!canResync()"
            class="q-mt-md"
            :label="$t('articles.body.saveDialog.resyncAfterSave') as string"
          />
          <div v-if="!canResync()" class="text-caption text-grey-7 q-mt-xs">
            {{ $t('articles.body.saveDialog.resyncDisabledHint') }}
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup />
          <q-btn
            color="primary"
            :label="$t('articles.body.saveDialog.confirm')"
            :loading="saving"
            @click="onSaveConfirm"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import MarkdownEditor from "src/components/common/MarkdownEditor.vue";
import { useNotify } from "src/composables/useNotify";
import { HttpError } from "src/lib/http-error";
import { useArticlesStore } from "src/stores/articles";
import type { ArticleDetail } from "src/stores/articles";
import { type PropType, defineComponent } from "vue";

interface OutlineSection {
  h2: string;
  intent: string;
  keyPoints: string[];
  estimatedWords: number;
  targetKeywords: string[];
}

interface ArticleOutline {
  title: string;
  slug: string;
  metaDescription: string;
  introAngle: string;
  sections: OutlineSection[];
  heroImagePrompt: string;
  heroImageStyle: string;
  estimatedTotalWords: number;
}

function outlineToMarkdown(outline: Record<string, unknown>): string {
  const o = outline as unknown as ArticleOutline;
  const lines: string[] = [];

  lines.push(`# ${o.title}`, "");
  lines.push(`> ${o.metaDescription}`, "");
  lines.push("---", "");
  lines.push("## Intro", "");
  lines.push(o.introAngle, "");

  for (const s of o.sections ?? []) {
    lines.push("---", "");
    lines.push(`## ${s.h2}`, "");
    if (s.intent) lines.push(`_${s.intent}_`, "");
    for (const kp of s.keyPoints ?? []) {
      lines.push(`- ${kp}`);
    }
    if (s.targetKeywords?.length) {
      lines.push("", `**Keywords:** ${s.targetKeywords.join(", ")}`);
    }
    lines.push(`**Est. words:** ${s.estimatedWords}`, "");
  }

  lines.push("---", "");
  lines.push(`**Hero image:** ${o.heroImagePrompt}`, "");
  lines.push(`**Style:** ${o.heroImageStyle} | **Total est.:** ${o.estimatedTotalWords} words`);

  return lines.join("\n");
}

export default defineComponent({
  name: "ArticleBodyPanel",

  components: { MarkdownEditor },

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ["saved"],

  data() {
    const article = this.detail.article as {
      bodyMd?: string;
      status?: string;
      outline?: Record<string, unknown>;
    };
    const initialBody =
      article.bodyMd ||
      (article.status === "outline_review" && article.outline
        ? outlineToMarkdown(article.outline)
        : "");
    return {
      bodyDraft: initialBody,
      lastSaved: article.bodyMd ?? "",
      saveDialogOpen: false,
      saving: false,
      changeReason: "",
      resyncAfterSave: true,
      outlineOpen: !article.bodyMd, // auto-expand outline when no draft yet
    };
  },

  computed: {
    article() {
      return this.detail.article as {
        id: string;
        bodyMd?: string;
        status: string;
        outline?: Record<string, unknown>;
      };
    },
    hasUnsavedChanges(): boolean {
      return this.bodyDraft !== this.lastSaved;
    },
    outlineMarkdown(): string {
      if (!this.article.outline) return "";
      return outlineToMarkdown(this.article.outline);
    },
  },

  watch: {
    "detail.article.bodyMd"(newVal: string | undefined): void {
      if (newVal !== undefined && newVal !== this.lastSaved) {
        this.bodyDraft = newVal;
        this.lastSaved = newVal;
      }
    },
    // When status changes to outline_review and bodyMd is still empty, load outline
    "detail.article.status"(newStatus: string): void {
      const article = this.detail.article as {
        bodyMd?: string;
        outline?: Record<string, unknown>;
      };
      if (newStatus === "outline_review" && !article.bodyMd && article.outline) {
        this.bodyDraft = outlineToMarkdown(article.outline);
      }
    },
  },

  methods: {
    onDiscard(): void {
      this.bodyDraft = this.lastSaved;
    },

    onSaveClick(): void {
      this.saveDialogOpen = true;
    },

    async onSaveConfirm(): Promise<void> {
      this.saving = true;
      const store = useArticlesStore();
      const notify = useNotify();
      try {
        await store.saveBody(
          this.article.id,
          this.bodyDraft,
          this.changeReason.trim() || undefined
        );
        this.lastSaved = this.bodyDraft;
        this.saveDialogOpen = false;
        notify.success(this.$t("articles.body.saveSuccess") as string);

        if (this.resyncAfterSave && this.canResync()) {
          await store.triggerSync(this.article.id);
          notify.info(this.$t("articles.body.resyncTriggered") as string);
        }

        this.changeReason = "";
        this.$emit("saved");
      } catch (e) {
        if (e instanceof HttpError) notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },

    canResync(): boolean {
      return ["ready_to_publish", "published", "blocked_by_pagespeed"].includes(
        this.article.status
      );
    },
  },
});
</script>

<style lang="scss" scoped>
.body-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.body-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unsaved-indicator {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--q-warning, #f2c037);
  font-weight: 500;
}

.outline-preview {
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  color: var(--q-text-primary, rgba(0,0,0,0.87));
  max-height: 400px;
  overflow-y: auto;

  body.body--dark & {
    color: rgba(255,255,255,0.87);
  }
}
</style>
