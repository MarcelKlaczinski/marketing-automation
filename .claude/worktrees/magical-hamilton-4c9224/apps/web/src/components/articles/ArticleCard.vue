<template>
  <div
    :class="['article-card', { 'article-card--cornerstone': cornerstone }]"
    @click="onClick"
  >
    <div v-if="cornerstone" class="article-card__cornerstone-bar" />

    <div class="article-card__main">
      <div class="article-card__title">
        {{ article.title || article.cornerstoneKeyword }}
      </div>

      <div
        v-if="article.title && article.cornerstoneKeyword !== article.title"
        class="article-card__keyword"
      >
        {{ article.cornerstoneKeyword }}
      </div>

      <div class="article-card__footer">
        <span v-if="cornerstone" class="article-card__badge">
          {{ $t('articles.card.cornerstone') }}
        </span>
        <span v-if="article.wordCount" class="article-card__meta">
          {{ article.wordCount }} {{ $t('articles.card.words') }}
        </span>
        <q-spinner v-if="isInFlight" size="14px" color="primary" />
        <q-icon v-if="isFailed" name="error" size="14px" color="negative" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { isCornerstone, isInFlightStatus } from "src/lib/article-status";
import type { ArticleListItem } from "src/stores/articles";
import { type PropType, defineComponent } from "vue";

export default defineComponent({
  name: "ArticleCard",

  props: {
    article: { type: Object as PropType<ArticleListItem>, required: true },
  },

  computed: {
    cornerstone(): boolean {
      return isCornerstone(this.article);
    },
    isInFlight(): boolean {
      return isInFlightStatus(this.article.status);
    },
    isFailed(): boolean {
      return ["failed", "blocked_by_pagespeed"].includes(this.article.status);
    },
  },

  methods: {
    onClick(): void {
      void this.$router.push({ name: "article-detail", params: { id: this.article.id } });
    },
  },
});
</script>

<style lang="scss" scoped>
.article-card {
  display: flex;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  padding: 0;
  cursor: pointer;
  background: var(--q-card-bg, #fff);
  font-size: 12px;
  transition: border-color 0.15s, transform 0.15s;
  overflow: hidden;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
    background: #2d2d2d;
  }

  &:hover {
    border-color: var(--q-primary);
    transform: translateY(-1px);
  }

  &--cornerstone {
    border-left: 0;
  }
}

.article-card__cornerstone-bar {
  width: 3px;
  background: var(--q-primary, #3f51b5);
  flex-shrink: 0;
}

.article-card__main {
  padding: 8px 10px;
  flex-grow: 1;
  min-width: 0;
}

.article-card__title {
  font-weight: 500;
  font-size: 12.5px;
  line-height: 1.35;
  margin-bottom: 4px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.article-card__keyword {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}

.article-card__footer {
  display: flex;
  align-items: center;
  gap: 6px;
}

.article-card__badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(63, 81, 181, 0.1);
  color: var(--q-primary, #3f51b5);
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 600;
}

.article-card__meta {
  font-size: 10px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}
</style>
