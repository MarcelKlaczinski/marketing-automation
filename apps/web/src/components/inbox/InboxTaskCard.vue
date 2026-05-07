<template>
  <div class="task-card" @click="onClick">
    <div v-if="isCornerstone" class="task-card__cornerstone-bar" />

    <div class="task-card__main">
      <div v-if="article.projectName" class="task-card__project">
        <q-icon name="folder" size="11px" class="q-mr-xs" />
        {{ article.projectName }}
        <template v-if="article.pillarName">
          <span class="task-card__separator">›</span>
          {{ article.pillarName }}
        </template>
      </div>

      <div class="task-card__title">
        {{ article.title || article.cornerstoneKeyword }}
      </div>

      <div v-if="article.title" class="task-card__keyword">
        <code>{{ article.cornerstoneKeyword }}</code>
      </div>

      <div class="task-card__footer">
        <span v-if="isCornerstone" class="task-card__badge">
          {{ $t('articles.card.cornerstone') }}
        </span>
        <q-space />
        <span class="task-card__action">
          {{ $t('inbox.tasks.review') }}
          <q-icon name="chevron_right" size="14px" />
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';

export interface InboxArticle {
  id: string;
  title: string | null;
  cornerstoneKeyword: string;
  cornerstoneSpecId: string | null;
  projectName: string | null;
  pillarName: string | null;
  status: string;
}

export default defineComponent({
  name: 'InboxTaskCard',

  props: {
    article: { type: Object as PropType<InboxArticle>, required: true },
  },

  computed: {
    isCornerstone(): boolean {
      return this.article.cornerstoneSpecId !== null;
    },
  },

  methods: {
    onClick(): void {
      void this.$router.push({ name: 'article-detail', params: { id: this.article.id } });
    },
  },
});
</script>

<style lang="scss" scoped>
.task-card {
  display: flex;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);
  cursor: pointer;
  transition: all 0.15s;
  overflow: hidden;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
  }

  &:hover {
    border-color: var(--q-primary);
    transform: translateY(-1px);
  }
}

.task-card__cornerstone-bar {
  width: 3px;
  background: var(--q-primary);
  flex-shrink: 0;
}

.task-card__main {
  padding: 12px 14px;
  flex-grow: 1;
  min-width: 0;
}

.task-card__project {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card__separator {
  margin: 0 4px;
}

.task-card__title {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-card__keyword {
  margin-bottom: 8px;

  code {
    font-size: 11px;
    background: rgba(0, 0, 0, 0.05);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: monospace;

    body.body--dark & {
      background: rgba(255, 255, 255, 0.06);
    }
  }
}

.task-card__footer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.task-card__badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(63, 81, 181, 0.1);
  color: var(--q-primary);
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 600;
}

.task-card__action {
  color: var(--q-primary);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}
</style>
