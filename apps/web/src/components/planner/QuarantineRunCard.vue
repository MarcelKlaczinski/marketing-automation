<template>
  <article class="quarantine-run-card">
    <div class="row-top">
      <span class="timestamp mono">{{ formattedTimestamp }}</span>
      <span class="status-badge">{{ $t("planner.quarantine.failedBadge") as string }}</span>
      <span class="trigger-badge" :class="triggerBadgeClass">{{ triggerBadgeLabel }}</span>
    </div>

    <div class="row-body">
      <span class="title">{{ planLabel }}</span>
      <span v-if="run.errorMessage" class="error-snippet">
        {{ truncatedError }}
      </span>
    </div>

    <div class="row-actions">
      <GlassButton variant="ghost" size="sm" @click="onViewDetails">
        {{ $t("planner.quarantine.viewDetails") as string }}
      </GlassButton>
      <GlassButton
        variant="primary"
        size="sm"
        :loading="retrying"
        :disabled="!canRetry"
        @click="$emit('retry', run)"
      >
        {{ $t("planner.quarantine.retry") as string }}
      </GlassButton>
    </div>
  </article>
</template>

<script lang="ts">
import { type PropType, defineComponent } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import type { QuarantineRun } from "src/composables/planner/useQuarantineRuns";

/**
 * Spec 62.7: single failed-run row in the Planner Quarantine tab.
 *
 * Inputs:
 *   - run: QuarantineRun (one row from /pipeline-runs?status=failed)
 *   - projectSlug: required for the View-Details route
 *   - retrying: optional loading flag while the parent's retry call is in flight
 *
 * Events:
 *   - retry(run): emitted when the user clicks Retry. The parent owns the
 *     confirm-dialog + API call (so it can do an optimistic cache patch).
 *
 * The "View Details" button uses programmatic router.push so it shares the
 * same parent state surface as Retry — both are user-initiated actions.
 */
export default defineComponent({
  name: "QuarantineRunCard",

  components: { GlassButton },

  props: {
    run: { type: Object as PropType<QuarantineRun>, required: true },
    projectSlug: { type: String, required: true },
    retrying: { type: Boolean, default: false },
  },

  emits: {
    retry: (run: QuarantineRun) => typeof run?.id === "string",
  },

  computed: {
    formattedTimestamp(): string {
      const d = new Date(this.run.completedAt ?? this.run.startedAt ?? this.run.createdAt);
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return d.toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    planLabel(): string {
      const input = this.run.input ?? {};
      const year = typeof input.targetYear === "number" ? input.targetYear : null;
      const week = typeof input.targetIsoWeek === "number" ? input.targetIsoWeek : null;
      if (year === null || week === null) {
        return this.run.pipelineName;
      }
      return this.$t("planner.quarantine.planLabel", { n: week, year }) as string;
    },
    triggerBadgeLabel(): string {
      const triggeredBy = this.triggeredBy;
      if (triggeredBy === "cron") {
        return this.$t("planner.quarantine.triggeredByCron") as string;
      }
      if (triggeredBy === "retry-from-quarantine") {
        return this.$t("planner.quarantine.triggeredByRetry") as string;
      }
      return this.$t("planner.quarantine.triggeredByManual") as string;
    },
    triggerBadgeClass(): string {
      const triggeredBy = this.triggeredBy;
      if (triggeredBy === "cron") return "trigger-badge--cron";
      if (triggeredBy === "retry-from-quarantine") return "trigger-badge--retry";
      return "trigger-badge--manual";
    },
    triggeredBy(): string | null {
      const input = this.run.input ?? {};
      return typeof input.triggeredBy === "string" ? input.triggeredBy : null;
    },
    truncatedError(): string {
      if (!this.run.errorMessage) return "";
      return this.run.errorMessage.length > 160
        ? this.run.errorMessage.slice(0, 157) + "..."
        : this.run.errorMessage;
    },
    canRetry(): boolean {
      // Block retry if we can't infer year/week — the route can't trigger
      // without those.
      const input = this.run.input ?? {};
      return (
        typeof input.targetYear === "number" && typeof input.targetIsoWeek === "number"
      );
    },
  },

  methods: {
    onViewDetails(): void {
      void this.$router.push({
        name: "run-detail",
        params: { slug: this.projectSlug, runId: this.run.id },
      });
    },
  },
});
</script>

<style scoped>
.quarantine-run-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  transition: border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .quarantine-run-card:hover {
    border-color: var(--border-strong);
  }
}

.row-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.timestamp {
  color: var(--text-tertiary);
  font-size: 12px;
  white-space: nowrap;
}

.row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}

.error-snippet {
  color: var(--status-failed, #ff4d6d);
  font-size: 12px;
  line-height: 1.4;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: var(--status-failed-bg);
  color: var(--status-failed, #ff4d6d);
  border: 1px solid rgba(255, 77, 109, 0.25);
  white-space: nowrap;
}

.trigger-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass-strong);
  color: var(--text-secondary);
}

.trigger-badge--cron {
  color: var(--text-secondary);
  background: color-mix(in oklch, var(--brand, #3b82f6) 8%, transparent);
  border-color: color-mix(in oklch, var(--brand, #3b82f6) 25%, transparent);
}

.trigger-badge--retry {
  color: #b58105;
  background: color-mix(in oklch, #ffbc00 10%, transparent);
  border-color: color-mix(in oklch, #ffbc00 25%, transparent);
}

.row-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

@media (max-width: 767px) {
  .row-actions {
    flex-direction: column;
  }
}
</style>
