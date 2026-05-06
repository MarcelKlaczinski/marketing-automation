<template>
  <div class="cornerstone-card q-mb-md">
    <!-- view mode -->
    <template v-if="!editing">
      <div class="cornerstone-card__header">
        <div class="cornerstone-card__title">{{ article.title || article.cornerstoneKeyword }}</div>
        <q-chip
          :color="article.status === 'approved' ? 'positive' : article.status === 'rejected' ? 'negative' : 'grey-5'"
          text-color="white"
          dense
          size="sm"
        >
          {{ $t(`coldStart.phase4.statusLabels.${article.status}`) }}
        </q-chip>
      </div>
      <div class="cornerstone-card__keyword">
        <q-icon name="key" size="14px" class="q-mr-xs" />
        {{ article.cornerstoneKeyword }}
      </div>
      <div v-if="article.metaDescription" class="cornerstone-card__meta">
        {{ article.metaDescription }}
      </div>

      <div v-if="article.status === 'proposed'" class="cornerstone-card__actions row q-gutter-sm q-mt-sm">
        <q-btn
          flat
          color="positive"
          :label="$t('coldStart.phase4.cardActions.approve')"
          icon="check"
          size="sm"
          :loading="acting"
          @click="$emit('approve')"
        />
        <q-btn
          flat
          color="primary"
          :label="$t('coldStart.phase4.cardActions.edit')"
          icon="edit"
          size="sm"
          @click="startEdit"
        />
        <q-btn
          flat
          color="negative"
          :label="$t('coldStart.phase4.cardActions.reject')"
          icon="close"
          size="sm"
          :loading="acting"
          @click="$emit('reject')"
        />
      </div>
      <div v-else class="cornerstone-card__actions row q-gutter-sm q-mt-sm">
        <q-btn flat color="primary" :label="$t('coldStart.phase4.cardActions.edit')" icon="edit" size="sm" @click="startEdit" />
      </div>
    </template>

    <!-- edit mode -->
    <template v-else>
      <q-input
        v-model="editTitle"
        :label="$t('coldStart.phase4.cardFields.title') as string"
        outlined
        dense
        class="q-mb-sm"
      />
      <q-input
        v-model="editKeyword"
        :label="$t('coldStart.phase4.cardFields.keyword') as string"
        outlined
        dense
        class="q-mb-sm"
      />
      <q-input
        v-model="editMetaDescription"
        :label="$t('coldStart.phase4.cardFields.description') as string"
        outlined
        dense
        type="textarea"
        autogrow
        class="q-mb-sm"
      />
      <div class="row q-gutter-sm">
        <q-btn flat color="grey-7" :label="$t('coldStart.phase4.cardActions.cancel')" size="sm" @click="cancelEdit" />
        <q-btn color="primary" :label="$t('coldStart.phase4.cardActions.save')" size="sm" :loading="saving" unelevated @click="onSave" />
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { CornerstoneArticle } from 'src/stores/cold-start';

export default defineComponent({
  name: 'CornerstoneCard',

  props: {
    article: { type: Object as PropType<CornerstoneArticle>, required: true },
    acting: { type: Boolean, default: false },
  },

  emits: ['approve', 'reject', 'save'],

  data() {
    return {
      editing: false,
      saving: false,
      editTitle: this.article.title ?? '',
      editKeyword: this.article.cornerstoneKeyword,
      editMetaDescription: this.article.metaDescription ?? '',
    };
  },

  methods: {
    startEdit(): void {
      this.editTitle = this.article.title ?? '';
      this.editKeyword = this.article.cornerstoneKeyword;
      this.editMetaDescription = this.article.metaDescription ?? '';
      this.editing = true;
    },

    cancelEdit(): void {
      this.editing = false;
    },

    async onSave(): Promise<void> {
      this.saving = true;
      try {
        this.$emit('save', {
          title: this.editTitle || undefined,
          cornerstoneKeyword: this.editKeyword || undefined,
          metaDescription: this.editMetaDescription || undefined,
        });
        this.editing = false;
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.cornerstone-card {
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  padding: 16px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.cornerstone-card__header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}

.cornerstone-card__title {
  font-weight: 600;
  font-size: 15px;
  flex-grow: 1;
}

.cornerstone-card__keyword {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  margin-bottom: 4px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}

.cornerstone-card__meta {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
  margin-bottom: 4px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.65);
  }
}

.cornerstone-card__actions {
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  padding-top: 8px;

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}
</style>
