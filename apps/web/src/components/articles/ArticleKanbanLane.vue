<template>
  <div class="lane">
    <div class="lane__header">
      <div class="lane__title">
        <span v-if="lane.pillarName" class="lane__pillar">{{ lane.pillarName }} ›</span>
        <span class="lane__cluster">{{ lane.clusterName ?? $t('articles.lane.uncategorized') }}</span>
      </div>
      <div class="lane__count">{{ lane.articles.length }}</div>
    </div>

    <div class="lane__columns">
      <div
        v-for="group in groups"
        :key="group"
        class="status-column"
        :style="{ '--column-color': STATUS_GROUP_COLORS[group] }"
      >
        <div class="status-column__header">
          <div class="status-column__indicator" />
          <div class="status-column__label">{{ $t(`articles.statusGroup.${group}`) }}</div>
          <div class="status-column__count">{{ articlesByGroup[group]?.length ?? 0 }}</div>
        </div>

        <div class="status-column__cards">
          <ArticleCard
            v-for="article in (articlesByGroup[group] ?? [])"
            :key="article.id"
            :article="article"
          />
          <div v-if="!articlesByGroup[group]?.length" class="status-column__empty">
            {{ $t('articles.lane.empty') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  GROUP_ORDER,
  STATUS_GROUP_COLORS,
  STATUS_TO_GROUP,
  type StatusGroup,
} from "src/lib/article-status";
import type { ArticleListItem } from "src/stores/articles";
import { type PropType, defineComponent } from "vue";
import ArticleCard from "./ArticleCard.vue";

interface KanbanLane {
  id: string;
  type: "pillar" | "cluster";
  pillarName?: string | null;
  clusterName?: string | null;
  articles: ArticleListItem[];
}

export default defineComponent({
  name: "ArticleKanbanLane",

  components: { ArticleCard },

  props: {
    lane: { type: Object as PropType<KanbanLane>, required: true },
  },

  data: () => ({
    groups: GROUP_ORDER,
    STATUS_GROUP_COLORS,
  }),

  computed: {
    articlesByGroup(): Record<StatusGroup, ArticleListItem[]> {
      const result: Record<StatusGroup, ArticleListItem[]> = {
        to_review: [],
        in_progress: [],
        ready: [],
        issues: [],
      };
      for (const article of this.lane.articles) {
        const group = STATUS_TO_GROUP[article.status];
        if (group) result[group].push(article);
      }
      return result;
    },
  },
});
</script>

<style lang="scss" scoped>
.lane {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
    background: #1d1d1d;
  }
}

.lane__header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
}

.lane__title {
  flex-grow: 1;
  font-size: 13px;
  font-weight: 600;
}

.lane__pillar {
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-weight: 400;
  margin-right: 4px;
}

.lane__count {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
}

.lane__columns {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.04);
  }
}

.status-column {
  background: var(--q-card-bg, #fff);
  padding: 8px 10px 12px;
  min-height: 80px;

  body.body--dark & {
    background: #1d1d1d;
  }
}

.status-column__header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.status-column__indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--column-color);
  margin-right: 6px;
  flex-shrink: 0;
}

.status-column__label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
  flex-grow: 1;
}

.status-column__count {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
}

.status-column__cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-column__empty {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.4));
  font-style: italic;
  padding: 6px 0;
}
</style>
