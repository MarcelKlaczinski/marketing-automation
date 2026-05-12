<template>
  <div class="recent-runs">
    <div v-if="combinedRuns.length === 0" class="recent-runs__empty">
      {{ $t('articles.actions.noRunsYet') }}
    </div>
    <div v-else class="recent-runs__list">
      <div
        v-for="run in combinedRuns"
        :key="run.key"
        class="run-row"
      >
        <q-icon :name="run.icon" size="16px" :color="run.iconColor" class="run-row__icon" />
        <div class="run-row__info">
          <span class="run-row__label">{{ $t(run.labelKey) }}</span>
          <span class="run-row__time">{{ formatTime(run.startedAt) }}</span>
          <span v-if="run.status === 'running' && run.stepName" class="run-row__step">
            {{ run.stepName }}
          </span>
        </div>
        <div :class="['run-row__status', `run-row__status--${run.status}`]">
          <q-spinner v-if="['pending', 'running', 'queued'].includes(run.status)" size="10px" />
          <span>{{ $t(statusI18nKey(run.status)) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { useArticlesStore } from "src/stores/articles";
import type { ArticleDetail } from "src/stores/articles";
import { type PropType, defineComponent } from "vue";

const POLL_INTERVAL_MS = 3000;

interface RunRow {
  key: string;
  icon: string;
  iconColor: string;
  labelKey: string;
  status: string;
  startedAt: string | null;
  stepName?: string | null;
  errorMessage?: string | null;
}

const STATUS_I18N: Record<string, string> = {
  queued: "articles.runs.status.queued",
  running: "articles.runs.status.running",
  completed: "articles.runs.status.completed",
  pending: "articles.runs.status.pending",
  succeeded: "articles.runs.status.succeeded",
  failed: "articles.runs.status.failed",
  errored: "articles.runs.status.errored",
  budget_exceeded: "articles.runs.status.budgetExceeded",
};

export default defineComponent({
  name: "ArticleRecentRunsList",

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
    articleId: { type: String, required: true },
  },

  data: () => ({
    timer: null as ReturnType<typeof setInterval> | null,
  }),

  computed: {
    combinedRuns(): RunRow[] {
      const rows: RunRow[] = [];

      // Field casts justified: ArticleDetail.recentRuns.* is typed as Record<string,unknown>[]
      // because the API envelope is untyped at the store boundary. The shapes here are
      // DB-schema facts (id uuid, status text, startedAt timestamptz | null).
      for (const raw of this.detail.recentRuns.sync) {
        const r = raw as Record<string, unknown>;
        rows.push({
          key: `sync-${r.id as string}`,
          icon: "cloud_upload",
          iconColor: "primary",
          labelKey: "articles.runs.type.sync",
          status: r.status as string,
          startedAt: r.startedAt as string | null,
          stepName: null,
          errorMessage: null,
        });
      }

      for (const raw of this.detail.recentRuns.pagespeed) {
        const r = raw as Record<string, unknown>;
        rows.push({
          key: `pagespeed-${r.id as string}`,
          icon: "speed",
          iconColor: "secondary",
          labelKey: "articles.runs.type.pagespeed",
          status: r.status as string,
          startedAt: r.startedAt as string | null,
          stepName: null,
          errorMessage: null,
        });
      }

      for (const raw of this.detail.recentRuns.schema) {
        const r = raw as Record<string, unknown>;
        rows.push({
          key: `schema-${r.id as string}`,
          icon: "data_object",
          iconColor: "accent",
          labelKey: "articles.runs.type.schema",
          status: r.status as string,
          startedAt: r.startedAt as string | null,
          stepName: null,
          errorMessage: null,
        });
      }

      for (const raw of (this.detail.recentRuns.pipeline ?? [])) {
        const r = raw as Record<string, unknown>;
        const name = r.pipelineName as string;
        rows.push({
          key: `pipeline-${r.id as string}`,
          icon: name === "article:outline" ? "list" : "description",
          iconColor: name === "article:outline" ? "teal" : "deep-purple",
          labelKey: name === "article:outline"
            ? "articles.runs.type.outline"
            : "articles.runs.type.draft",
          status: r.status as string,
          startedAt: r.startedAt as string | null,
          stepName: r.stepName as string | null,
          errorMessage: r.errorMessage as string | null,
        });
      }

      rows.sort((a, b) => {
        const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return tb - ta;
      });

      return rows.slice(0, 5);
    },

    hasInFlightRuns(): boolean {
      return this.combinedRuns.some((r) => ["pending", "running", "queued"].includes(r.status));
    },
  },

  watch: {
    hasInFlightRuns: {
      immediate: true,
      handler(inFlight: boolean): void {
        if (inFlight) {
          this.startPolling();
        } else {
          this.stopPolling();
        }
      },
    },
  },

  beforeUnmount() {
    this.stopPolling();
  },

  methods: {
    startPolling(): void {
      if (this.timer !== null) return;
      this.timer = setInterval(() => {
        void useArticlesStore().fetchDetail(this.articleId);
      }, POLL_INTERVAL_MS);
    },

    stopPolling(): void {
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    },

    statusI18nKey(status: string): string {
      return STATUS_I18N[status] ?? "articles.runs.status.unknown";
    },

    formatTime(isoStr: string | null): string {
      if (!isoStr) return this.$t("articles.lane.empty") as string;
      const d = new Date(isoStr);
      return d.toLocaleString(this.$i18n.locale === "de" ? "de-DE" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
  },
});
</script>

<style lang="scss" scoped>
.recent-runs__empty {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.45));
  font-style: italic;
}

.recent-runs__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.run-row__icon {
  flex-shrink: 0;
}

.run-row__info {
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.run-row__label {
  font-weight: 500;
  color: var(--q-dark, #1d1d1d);

  body.body--dark & {
    color: rgba(255, 255, 255, 0.87);
  }
}

.run-row__time {
  font-size: 10px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.45));
}

.run-row__step {
  font-size: 10px;
  color: var(--q-primary, #3f51b5);
  font-style: italic;
}

.run-row__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 999px;
  flex-shrink: 0;

  &--queued,
  &--pending,
  &--running {
    background: rgba(63, 81, 181, 0.1);
    color: var(--q-primary, #3f51b5);
  }

  &--completed {
    background: rgba(33, 186, 69, 0.1);
    color: var(--q-positive, #21ba45);
  }

  &--succeeded {
    background: rgba(33, 186, 69, 0.1);
    color: var(--q-positive, #21ba45);
  }

  &--failed,
  &--errored {
    background: rgba(193, 0, 21, 0.1);
    color: var(--q-negative, #c10015);
  }

  &--budget_exceeded {
    background: rgba(242, 192, 55, 0.15);
    color: var(--q-warning, #f2c037);
  }
}
</style>
