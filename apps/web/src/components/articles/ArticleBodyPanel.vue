<template>
  <div class="body-panel">
    <div class="body-panel__toolbar">
      <span v-if="hasUnsavedChanges" class="unsaved-indicator">
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
      :height="600"
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
            class="q-mt-md"
            :label="$t('articles.body.saveDialog.resyncAfterSave') as string"
          />
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
import { defineComponent, type PropType } from 'vue';
import { useArticlesStore } from 'src/stores/articles';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import MarkdownEditor from 'src/components/common/MarkdownEditor.vue';
import type { ArticleDetail } from 'src/stores/articles';

export default defineComponent({
  name: 'ArticleBodyPanel',

  components: { MarkdownEditor },

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ['saved'],

  setup() {
    return {
      articlesStore: useArticlesStore(),
      notify: useNotify(),
    };
  },

  data() {
    const article = this.detail.article as { bodyMd?: string };
    return {
      bodyDraft: article.bodyMd ?? '',
      lastSaved: article.bodyMd ?? '',
      saveDialogOpen: false,
      saving: false,
      changeReason: '',
      resyncAfterSave: true,
    };
  },

  computed: {
    article() {
      return this.detail.article as { id: string; bodyMd?: string; status: string };
    },
    hasUnsavedChanges(): boolean {
      return this.bodyDraft !== this.lastSaved;
    },
  },

  watch: {
    'detail.article.bodyMd'(newVal: string | undefined): void {
      if (newVal !== undefined && newVal !== this.lastSaved) {
        this.bodyDraft = newVal;
        this.lastSaved = newVal;
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
      try {
        await this.articlesStore.saveBody(
          this.article.id,
          this.bodyDraft,
          this.changeReason.trim() || undefined,
        );
        this.lastSaved = this.bodyDraft;
        this.saveDialogOpen = false;
        this.notify.success(this.$t('articles.body.saveSuccess') as string);

        if (this.resyncAfterSave && this.canResync()) {
          await this.articlesStore.triggerSync(this.article.id);
          this.notify.info(this.$t('articles.body.resyncTriggered') as string);
        }

        this.changeReason = '';
        this.$emit('saved');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },

    canResync(): boolean {
      return ['ready_to_publish', 'published', 'blocked_by_pagespeed'].includes(this.article.status);
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
</style>
