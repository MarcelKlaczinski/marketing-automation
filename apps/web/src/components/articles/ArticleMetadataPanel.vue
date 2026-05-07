<template>
  <div class="metadata-panel">
    <q-banner v-if="dirty" class="bg-warning text-white q-mb-md" dense rounded>
      <template #avatar>
        <q-icon name="edit_note" />
      </template>
      {{ $t('common.unsavedChanges') }}
    </q-banner>

    <q-banner class="bg-grey-2 q-mb-md" dense rounded>
      <template #avatar>
        <q-icon name="warning" color="warning" />
      </template>
      {{ $t('articles.metadata.statusWarning') }}
    </q-banner>

    <div class="row q-col-gutter-md">
      <div class="col-12">
        <q-input
          v-model="form.title"
          outlined
          :label="$t('articles.metadata.title')"
          @update:model-value="dirty = true"
        />
      </div>

      <div class="col-12 col-sm-6">
        <q-input
          v-model="form.cornerstoneKeyword"
          outlined
          :label="$t('articles.metadata.cornerstoneKeyword')"
          @update:model-value="dirty = true"
        />
      </div>

      <div class="col-12 col-sm-6">
        <q-input
          v-model="form.slug"
          outlined
          :label="$t('articles.metadata.slug')"
          :hint="$t('articles.metadata.slugHint')"
          :rules="[slugRule]"
          @update:model-value="dirty = true"
        />
      </div>

      <div class="col-12">
        <q-input
          v-model="form.metaDescription"
          outlined
          type="textarea"
          autogrow
          :label="$t('articles.metadata.metaDescription')"
          maxlength="500"
          counter
          @update:model-value="dirty = true"
        />
      </div>

      <div class="col-12 col-sm-6">
        <q-select
          v-model="form.status"
          outlined
          :label="$t('articles.metadata.status')"
          :options="statusOptions"
          emit-value
          map-options
          @update:model-value="dirty = true"
        />
      </div>
    </div>

    <div class="row q-mt-lg">
      <q-space />
      <q-btn
        flat
        :label="$t('articles.body.discard')"
        :disable="!dirty || saving"
        class="q-mr-sm"
        @click="onDiscard"
      />
      <q-btn
        color="primary"
        :label="$t('articles.metadata.save')"
        :disable="!dirty"
        :loading="saving"
        @click="onSave"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { useArticlesStore } from 'src/stores/articles';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import type { ArticleDetail } from 'src/stores/articles';

const ALL_STATUSES = [
  'proposed', 'approved', 'generating', 'outline_review', 'drafting',
  'final_review', 'schema_extending', 'ready_to_publish', 'validating',
  'published', 'blocked_by_pagespeed', 'failed', 'rejected',
] as const;

type ArticleStatus = typeof ALL_STATUSES[number];

interface MetadataForm {
  title: string;
  slug: string;
  cornerstoneKeyword: string;
  metaDescription: string;
  status: ArticleStatus;
}

export default defineComponent({
  name: 'ArticleMetadataPanel',

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ['updated'],

  setup() {
    return {
      articlesStore: useArticlesStore(),
      notify: useNotify(),
    };
  },

  data() {
    const a = this.detail.article as {
      title?: string | null;
      slug: string;
      cornerstoneKeyword: string;
      metaDescription?: string | null;
      status: ArticleStatus;
    };
    return {
      form: {
        title: a.title ?? '',
        slug: a.slug ?? '',
        cornerstoneKeyword: a.cornerstoneKeyword ?? '',
        metaDescription: a.metaDescription ?? '',
        status: a.status,
      } as MetadataForm,
      dirty: false,
      saving: false,
    };
  },

  computed: {
    article() {
      return this.detail.article as {
        id: string;
        title?: string | null;
        slug: string;
        cornerstoneKeyword: string;
        metaDescription?: string | null;
        status: ArticleStatus;
      };
    },

    statusOptions(): Array<{ label: string; value: string }> {
      return ALL_STATUSES.map((s) => ({
        label: this.$t(`articles.status.${s}`) as string,
        value: s,
      }));
    },
  },

  watch: {
    'detail.article'(): void {
      if (!this.dirty) {
        this.form = this.buildForm();
      }
    },
  },

  methods: {
    buildForm(): MetadataForm {
      const a = this.detail.article as {
        title?: string | null;
        slug: string;
        cornerstoneKeyword: string;
        metaDescription?: string | null;
        status: ArticleStatus;
      };
      return {
        title: a.title ?? '',
        slug: a.slug ?? '',
        cornerstoneKeyword: a.cornerstoneKeyword ?? '',
        metaDescription: a.metaDescription ?? '',
        status: a.status,
      };
    },

    onDiscard(): void {
      this.form = this.buildForm();
      this.dirty = false;
    },

    slugRule(v: string): true | string {
      if (/^[a-z0-9-]+$/.test(v)) return true;
      return this.$t('articles.metadata.slugHint') as string;
    },

    async onSave(): Promise<void> {
      const patch: Record<string, unknown> = {};
      if (this.form.title.trim()) patch.title = this.form.title.trim();
      if (this.form.slug.trim()) patch.slug = this.form.slug.trim();
      if (this.form.cornerstoneKeyword.trim()) patch.cornerstoneKeyword = this.form.cornerstoneKeyword.trim();
      patch.metaDescription = this.form.metaDescription.trim() || null;
      patch.status = this.form.status;

      this.saving = true;
      try {
        await this.articlesStore.updateMetadata(this.article.id, patch);
        this.dirty = false;
        this.notify.success(this.$t('articles.metadata.saveSuccess') as string);
        this.$emit('updated');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.metadata-panel {
  display: flex;
  flex-direction: column;
}
</style>
