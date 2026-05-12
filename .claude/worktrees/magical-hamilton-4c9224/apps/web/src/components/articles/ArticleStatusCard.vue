ç<template>
  <div class="status-card">
    <!-- ── Active run banner ──────────────────────────────────────────────── -->
    <div v-if="activeRun" class="status-card__run">
      <q-spinner size="14px" color="primary" class="q-mr-xs" />
      <div class="status-card__run-info">
        <span class="status-card__run-name">{{ runLabel(activeRun.pipelineName) }}</span>
        <span v-if="activeRun.stepName" class="status-card__run-step">{{ activeRun.stepName }}</span>
      </div>
      <q-badge color="primary" :label="$t('articles.runs.status.running')" />
    </div>

    <!-- ── Status progress track ─────────────────────────────────────────── -->
    <div class="status-track">
      <div
        v-for="step in TRACK"
        :key="step.status"
        :class="[
          'track-step',
          {
            'track-step--done': isDone(step.status),
            'track-step--active': step.status === currentStatus,
            'track-step--running': step.status === currentStatus && !!activeRun,
          },
        ]"
      >
        <q-tooltip>{{ $t('articles.status.' + step.status) }}</q-tooltip>
        <div class="track-step__dot">
          <q-icon v-if="isDone(step.status)" name="check" size="8px" />
          <q-spinner v-else-if="step.status === currentStatus && activeRun" size="8px" />
        </div>
        <span class="track-step__label">{{ step.short }}</span>
      </div>
    </div>

    <!-- ── Next-step guidance ─────────────────────────────────────────────── -->
    <div v-if="nextStepHint" class="status-card__hint">
      <q-icon name="arrow_forward" size="12px" color="primary" class="q-mr-xs" />
      <span>{{ nextStepHint }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import type { ArticleDetail } from "src/stores/articles";
import { type PropType, defineComponent } from "vue";

interface TrackStep {
  status: string;
  short: string;
}

// Simplified display track — in-flight states are merged into their trigger state
const TRACK: TrackStep[] = [
  { status: "proposed",         short: "Vorschlag" },
  { status: "approved",         short: "Freigabe" },
  { status: "outline_review",   short: "Outline" },
  { status: "final_review",     short: "Draft" },
  { status: "ready_to_publish", short: "Astro" },
  { status: "published",        short: "Live" },
];

const TRACK_ORDER = TRACK.map((s) => s.status);

// Statuses that collapse into an adjacent track step for ordering purposes
const STATUS_MAP: Record<string, string> = {
  generating:       "approved",
  drafting:         "outline_review",
  schema_extending: "final_review",
  validating:       "ready_to_publish",
  blocked_by_pagespeed: "published",
  failed:           "proposed",
  rejected:         "proposed",
};

// Pipeline name → i18n label key
const PIPELINE_LABEL: Record<string, string> = {
  "article:outline":   "articles.runs.type.outline",
  "article:draft":     "articles.runs.type.draft",
  "article:sync":      "articles.runs.type.sync",
  "article:pagespeed": "articles.runs.type.pagespeed",
  "article:schema":    "articles.runs.type.schema",
  "article:hero":      "articles.runs.type.hero",
  "article:localize":  "articles.runs.type.localize",
};

// Next-step hint per status (i18n key)
const NEXT_HINT: Record<string, string> = {
  proposed:         "articles.statusGuide.proposed",
  approved:         "articles.statusGuide.approved",
  outline_review:   "articles.statusGuide.outline_review",
  final_review:     "articles.statusGuide.final_review",
  schema_extending: "articles.statusGuide.running",
  generating:       "articles.statusGuide.running",
  drafting:         "articles.statusGuide.running",
  ready_to_publish: "articles.statusGuide.ready_to_publish",
  validating:       "articles.statusGuide.running",
  published:        "articles.statusGuide.published",
  blocked_by_pagespeed: "articles.statusGuide.blocked",
  failed:           "articles.statusGuide.failed",
};

export default defineComponent({
  name: "ArticleStatusCard",

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  // expose TRACK so template can iterate
  setup() {
    return { TRACK };
  },

  computed: {
    currentStatus(): string {
      return ((this.detail.article as Record<string, unknown>).status as string) ?? "proposed";
    },

    activeRun(): { pipelineName: string; stepName: string | null } | null {
      const runs = (this.detail.recentRuns.pipeline ?? []) as Record<string, unknown>[];
      const active = runs.find((r) => ["queued", "running"].includes(r.status as string));
      if (!active) return null;
      return {
        pipelineName: active.pipelineName as string,
        stepName: (active.stepName as string | null) ?? null,
      };
    },

    nextStepHint(): string | null {
      if (this.activeRun) return null; // don't show hint while pipeline is running
      const key = NEXT_HINT[this.currentStatus];
      if (!key) return null;
      return this.$t(key) as string;
    },
  },

  methods: {
    /** Map a DB status to the nearest TRACK step for ordering */
    trackIndex(status: string): number {
      const mapped = STATUS_MAP[status] ?? status;
      const idx = TRACK_ORDER.indexOf(mapped);
      return idx === -1 ? -1 : idx;
    },

    isDone(trackStatus: string): boolean {
      const currentIdx = this.trackIndex(this.currentStatus);
      const stepIdx = TRACK_ORDER.indexOf(trackStatus);
      if (currentIdx === -1 || stepIdx === -1) return false;
      // The "active" step itself is not "done" yet
      if (trackStatus === this.currentStatus) return false;
      return stepIdx < currentIdx;
    },

    runLabel(pipelineName: string): string {
      const key = PIPELINE_LABEL[pipelineName];
      return key ? (this.$t(key) as string) : pipelineName;
    },
  },
});
</script>

<style lang="scss" scoped>
.status-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

// ── Active run banner ───────────────────────────────────────────────────────
.status-card__run {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(63, 81, 181, 0.07);
  border: 1px solid rgba(63, 81, 181, 0.2);
  border-radius: 8px;
  font-size: 12px;

  body.body--dark & {
    background: rgba(63, 81, 181, 0.12);
    border-color: rgba(63, 81, 181, 0.3);
  }
}

.status-card__run-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.status-card__run-name {
  font-weight: 600;
  color: var(--q-primary, #3f51b5);
}

.status-card__run-step {
  font-size: 10px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-style: italic;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.5);
  }
}

// ── Progress track ──────────────────────────────────────────────────────────
.status-track {
  display: flex;
  align-items: flex-start;
  gap: 0;
  padding: 4px 0;
  overflow-x: auto;
}

.track-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
  min-width: 40px;

  // connecting line between steps
  &:not(:last-child)::after {
    content: "";
    position: absolute;
    top: 8px;
    left: 50%;
    width: 100%;
    height: 2px;
    background: var(--q-grey-4, #e0e0e0);
    z-index: 0;
  }

  &--done:not(:last-child)::after {
    background: var(--q-positive, #21ba45);
  }

  &--active:not(:last-child)::after,
  &--running:not(:last-child)::after {
    background: linear-gradient(
      to right,
      var(--q-primary, #3f51b5) 0%,
      var(--q-grey-4, #e0e0e0) 100%
    );
  }
}

.track-step__dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--q-grey-4, #e0e0e0);
  border: 2px solid var(--q-grey-4, #e0e0e0);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  position: relative;
  flex-shrink: 0;
  font-size: 10px;

  .track-step--done & {
    background: var(--q-positive, #21ba45);
    border-color: var(--q-positive, #21ba45);
    color: white;
  }

  .track-step--active & {
    background: white;
    border-color: var(--q-primary, #3f51b5);
    border-width: 3px;

    body.body--dark & {
      background: var(--q-dark-page, #121212);
    }
  }

  .track-step--running & {
    background: white;
    border-color: var(--q-primary, #3f51b5);
    color: var(--q-primary, #3f51b5);

    body.body--dark & {
      background: var(--q-dark-page, #121212);
    }
  }
}

.track-step__label {
  font-size: 9px;
  text-align: center;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.45));
  white-space: nowrap;
  line-height: 1.2;

  .track-step--active &,
  .track-step--running & {
    color: var(--q-primary, #3f51b5);
    font-weight: 600;
  }

  .track-step--done & {
    color: var(--q-positive, #21ba45);
  }
}

// ── Hint ───────────────────────────────────────────────────────────────────
.status-card__hint {
  display: flex;
  align-items: center;
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  padding: 0 2px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.5);
  }
}
</style>
