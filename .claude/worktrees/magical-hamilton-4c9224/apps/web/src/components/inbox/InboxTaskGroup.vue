<template>
  <div class="task-group">
    <div class="task-group__header">
      <q-icon :name="icon" size="16px" :color="color" class="q-mr-sm" />
      <span class="task-group__label">{{ $t(`inbox.tasks.statusLabel.${status}`) }}</span>
      <span class="task-group__count">{{ articles.length }}</span>
    </div>

    <div class="task-group__cards">
      <InboxTaskCard
        v-for="article in articles"
        :key="article.id"
        :article="article"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import InboxTaskCard, { type InboxArticle } from './InboxTaskCard.vue';

const STATUS_ICONS: Record<string, string> = {
  proposed: 'pending',
  outline_review: 'list_alt',
  final_review: 'rate_review',
};

const STATUS_COLORS: Record<string, string> = {
  proposed: 'grey-6',
  outline_review: 'primary',
  final_review: 'warning',
};

export default defineComponent({
  name: 'InboxTaskGroup',

  components: { InboxTaskCard },

  props: {
    status: { type: String, required: true },
    articles: { type: Array as PropType<InboxArticle[]>, required: true },
  },

  computed: {
    icon(): string {
      return STATUS_ICONS[this.status] ?? 'help';
    },
    color(): string {
      return STATUS_COLORS[this.status] ?? 'grey';
    },
  },
});
</script>

<style lang="scss" scoped>
.task-group {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
}

.task-group__header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.task-group__label {
  font-size: 13px;
  font-weight: 600;
  flex-grow: 1;
}

.task-group__count {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  background: var(--q-grey-2, #f0f0f0);
  padding: 1px 8px;
  border-radius: 999px;

  body.body--dark & {
    background: rgba(255, 255, 255, 0.06);
  }
}

.task-group__cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;

  @media (min-width: 640px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
