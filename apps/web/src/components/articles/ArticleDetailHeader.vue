<template>
  <div class="article-header">
    <div class="article-header__breadcrumb">
      <q-btn
        flat
        dense
        round
        icon="arrow_back"
        :aria-label="$t('articles.header.back')"
        @click="$emit('back')"
      />
      <span v-if="cluster" class="article-header__crumb article-header__crumb--dim">
        {{ pillarName }}
        <q-icon v-if="pillarName" name="chevron_right" size="14px" />
        {{ clusterName }}
        <q-icon name="chevron_right" size="14px" />
      </span>
      <span class="article-header__crumb article-header__crumb--title">
        {{ articleTitle }}
      </span>
    </div>

    <div class="article-header__meta">
      <q-chip
        :color="statusColor"
        text-color="white"
        dense
        :label="statusLabel"
        class="q-mr-sm"
      />
      <q-badge v-if="isCornerstone" color="primary" class="q-mr-sm">
        {{ $t('articles.header.cornerstone') }}
      </q-badge>
      <span class="article-header__updated">
        {{ $t('articles.header.lastUpdated') }}: {{ formattedUpdatedAt }}
      </span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { ArticleDetail } from 'src/stores/articles';
import { STATUS_TO_GROUP, STATUS_GROUP_COLORS } from 'src/lib/article-status';

export default defineComponent({
  name: 'ArticleDetailHeader',

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ['back'],

  computed: {
    article() {
      return this.detail.article as {
        title?: string;
        cornerstoneKeyword: string;
        status: string;
        cornerstoneSpecId?: string | null;
        updatedAt: string;
      };
    },

    cluster() {
      return this.detail.cluster as { name?: string } | null;
    },

    pillar() {
      return this.detail.pillar as { name?: string } | null;
    },

    clusterName(): string | null {
      return this.cluster?.name ?? null;
    },

    pillarName(): string | null {
      return this.pillar?.name ?? null;
    },

    articleTitle(): string {
      return this.article.title ?? this.article.cornerstoneKeyword;
    },

    isCornerstone(): boolean {
      return this.article.cornerstoneSpecId != null;
    },

    statusLabel(): string {
      const key = `articles.status.${this.article.status}`;
      return this.$t(key) as string;
    },

    statusColor(): string {
      const group = STATUS_TO_GROUP[this.article.status] ?? 'in_progress';
      const hexColor = STATUS_GROUP_COLORS[group as keyof typeof STATUS_GROUP_COLORS];
      const colorMap: Record<string, string> = {
        '#f2c037': 'warning',
        '#3f51b5': 'primary',
        '#21ba45': 'positive',
        '#c10015': 'negative',
      };
      return colorMap[hexColor] ?? 'grey';
    },

    formattedUpdatedAt(): string {
      const locale = this.$i18n.locale === 'de' ? 'de-DE' : 'en-US';
      return new Date(this.article.updatedAt).toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },
  },
});
</script>

<style lang="scss" scoped>
.article-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.article-header__breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.article-header__crumb {
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 2px;

  &--dim {
    color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
    font-weight: 400;
  }

  &--title {
    font-weight: 600;
    color: var(--q-text-primary, rgba(0, 0, 0, 0.87));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 400px;
  }
}

.article-header__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding-left: 36px;
}

.article-header__updated {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}
</style>
