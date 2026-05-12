<template>
  <div :class="['activity-row', `activity-row--${entry.status}`]" @click="onClick">
    <div class="activity-row__icon-col">
      <q-spinner v-if="isInFlight" size="20px" :color="iconColor" />
      <q-icon v-else :name="statusIcon" :color="iconColor" size="20px" />
    </div>

    <div class="activity-row__main">
      <div class="activity-row__title-row">
        <span :class="`type-pill type-pill--${entry.type}`">{{ $t(`activity.types.${entry.type}`) }}</span>
        <span class="activity-row__title">{{ entry.title }}</span>
        <q-space />
        <span class="activity-row__time">{{ relativeTime(entry.startedAt ?? entry.createdAt) }}</span>
      </div>

      <div class="activity-row__meta">
        <span v-if="entry.projectName" class="activity-row__meta-item">
          <q-icon name="folder" size="12px" class="q-mr-xs" />{{ entry.projectName }}
        </span>
        <span v-if="entry.subtitle" class="activity-row__meta-item">{{ entry.subtitle }}</span>
        <span v-if="duration" class="activity-row__meta-item">{{ duration }}</span>
      </div>

      <div v-if="entry.errorMessage" class="activity-row__error">
        <q-icon name="error" size="12px" class="q-mr-xs" color="negative" />
        {{ entry.errorMessage }}
      </div>
    </div>

    <div v-if="canNavigate" class="activity-row__nav">
      <q-icon name="chevron_right" size="20px" color="grey-6" />
    </div>
  </div>
</template>

<script lang="ts">
import type { ActivityEntry } from "src/composables/useActiveRunsPolling";
import { type PropType, defineComponent } from "vue";

const STATUS_ICONS: Record<string, string> = {
  queued: "schedule",
  running: "sync",
  completed: "check_circle",
  failed: "error",
  cancelled: "cancel",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "grey",
  running: "primary",
  completed: "positive",
  failed: "negative",
  cancelled: "grey-7",
};

export default defineComponent({
  name: "ActivityRow",

  props: {
    entry: { type: Object as PropType<ActivityEntry>, required: true },
  },

  computed: {
    isInFlight(): boolean {
      return this.entry.status === "queued" || this.entry.status === "running";
    },

    statusIcon(): string {
      return STATUS_ICONS[this.entry.status] ?? "help";
    },

    iconColor(): string {
      return STATUS_COLORS[this.entry.status] ?? "grey";
    },

    duration(): string | null {
      const start = this.entry.startedAt ? new Date(this.entry.startedAt).getTime() : null;
      const end = this.entry.finishedAt
        ? new Date(this.entry.finishedAt).getTime()
        : this.isInFlight
          ? Date.now()
          : null;
      if (!start || !end) return null;
      const seconds = Math.round((end - start) / 1000);
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
      return `${(seconds / 3600).toFixed(1)}h`;
    },

    canNavigate(): boolean {
      return !!(this.entry.articleId || this.entry.projectSlug);
    },
  },

  methods: {
    relativeTime(iso: string | null): string {
      if (!iso) return "";
      const ms = Date.now() - new Date(iso).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return this.$t("activity.relative.justNow") as string;
      const m = Math.round(s / 60);
      if (m < 60) return this.$t("activity.relative.minutesAgo", { n: m }) as string;
      const h = Math.round(m / 60);
      if (h < 24) return this.$t("activity.relative.hoursAgo", { n: h }) as string;
      const d = Math.round(h / 24);
      return this.$t("activity.relative.daysAgo", { n: d }) as string;
    },

    onClick(): void {
      if (this.entry.articleId) {
        void this.$router.push({ name: "article-detail", params: { id: this.entry.articleId } });
      } else if (this.entry.projectSlug) {
        void this.$router.push({
          name: "project-detail",
          params: { slug: this.entry.projectSlug },
        });
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.activity-row {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);
  cursor: pointer;
  transition: border-color 0.15s;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
  }

  &:hover {
    border-color: var(--q-primary);
  }

  &--running  { border-left: 3px solid var(--q-primary); }
  &--queued   { border-left: 3px solid #9e9e9e; }
  &--failed   { border-left: 3px solid var(--q-negative); }
  &--completed { border-left: 3px solid var(--q-positive); }
  &--cancelled { border-left: 3px solid #757575; opacity: 0.7; }
}

.activity-row__icon-col {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}

.activity-row__main {
  flex-grow: 1;
  min-width: 0;
}

.activity-row__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.activity-row__title {
  font-weight: 500;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-row__time {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.55);
  flex-shrink: 0;

  body.body--dark & { color: rgba(255, 255, 255, 0.5); }
}

.activity-row__meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  flex-wrap: wrap;

  body.body--dark & { color: rgba(255, 255, 255, 0.5); }
}

.activity-row__meta-item {
  display: inline-flex;
  align-items: center;
}

.activity-row__error {
  margin-top: 6px;
  padding: 6px 10px;
  background: rgba(193, 0, 21, 0.06);
  border-radius: 4px;
  font-size: 12px;
  color: var(--q-negative);
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-row__nav {
  display: flex;
  align-items: center;
}

.type-pill {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: #eeeeee;
  color: rgba(0, 0, 0, 0.65);
  white-space: nowrap;
  flex-shrink: 0;

  body.body--dark & {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
  }

  &--cold_start        { background: rgba(63, 81, 181, 0.12); color: #3f51b5; }
  &--article_outline,
  &--article_draft     { background: rgba(124, 77, 255, 0.12); color: #7c4dff; }
  &--astro_sync        { background: rgba(38, 166, 154, 0.12); color: #26a69a; }
  &--pagespeed         { background: rgba(242, 192, 55, 0.18); color: #b07b00; }
  &--schema_extension  { background: rgba(0, 188, 212, 0.12); color: #00838f; }
  &--link_rebuild      { background: rgba(96, 125, 139, 0.12); color: #455a64; }
}
</style>
