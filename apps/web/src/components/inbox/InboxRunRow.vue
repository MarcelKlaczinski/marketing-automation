<template>
  <q-item clickable @click="onClick">
    <q-item-section avatar>
      <q-spinner v-if="entry.status === 'running'" size="20px" color="primary" />
      <q-icon v-else name="schedule" size="20px" color="grey-6" />
    </q-item-section>

    <q-item-section>
      <q-item-label>
        <span :class="`type-pill type-pill--${entry.type}`">
          {{ $t(`activity.types.${entry.type}`) }}
        </span>
        {{ entry.title }}
      </q-item-label>
      <q-item-label caption>
        <span v-if="entry.projectName">{{ entry.projectName }}</span>
        <span v-if="entry.subtitle"> · {{ entry.subtitle }}</span>
        <span v-if="elapsed"> · {{ elapsed }}</span>
      </q-item-label>
    </q-item-section>

    <q-item-section side>
      <q-btn
        v-if="entry.status === 'running' || entry.status === 'queued'"
        flat
        round
        dense
        icon="stop_circle"
        color="negative"
        size="sm"
        :loading="cancelling"
        :aria-label="$t('inbox.cancelRun') as string"
        @click.stop="onCancel"
      />
      <q-icon v-else name="chevron_right" size="20px" color="grey-6" />
    </q-item-section>
  </q-item>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { api } from 'src/lib/api-client';

export interface InboxRunEntry {
  id: string;
  type: string;
  status: string;
  projectName: string | null;
  projectSlug: string | null;
  title: string;
  subtitle: string | null;
  articleId: string | null;
  startedAt: string | null;
}

export default defineComponent({
  name: 'InboxRunRow',

  props: {
    entry: { type: Object as PropType<InboxRunEntry>, required: true },
  },

  emits: ['cancelled'],

  data: () => ({
    cancelling: false,
  }),

  computed: {
    elapsed(): string | null {
      if (!this.entry.startedAt) return null;
      const ms = Date.now() - new Date(this.entry.startedAt).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return `${s}s`;
      if (s < 3600) return `${Math.round(s / 60)}m`;
      return `${(s / 3600).toFixed(1)}h`;
    },
  },

  methods: {
    onClick(): void {
      if (this.entry.articleId) {
        void this.$router.push({ name: 'article-detail', params: { id: this.entry.articleId } });
      } else {
        void this.$router.push({ name: 'activity' });
      }
    },

    async onCancel(): Promise<void> {
      this.cancelling = true;
      try {
        await api.patch(`/pipeline-runs/${this.entry.id}/cancel`);
        this.$emit('cancelled', this.entry.id);
      } catch {
        // Silently ignore — polling will refresh state
      } finally {
        this.cancelling = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.type-pill {
  display: inline-block;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 8px;
  background: var(--q-grey-2, #f0f0f0);
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));

  body.body--dark & {
    background: rgba(255, 255, 255, 0.06);
  }

  &--cold_start { background: rgba(63, 81, 181, 0.12); color: #3f51b5; }
  &--article_outline,
  &--article_draft { background: rgba(124, 77, 255, 0.12); color: #7c4dff; }
  &--astro_sync { background: rgba(38, 166, 154, 0.12); color: #26a69a; }
  &--pagespeed { background: rgba(242, 192, 55, 0.18); color: #b07b00; }
  &--schema_extension { background: rgba(0, 188, 212, 0.12); color: #00838f; }
  &--link_rebuild { background: rgba(96, 125, 139, 0.12); color: #455a64; }
}
</style>
