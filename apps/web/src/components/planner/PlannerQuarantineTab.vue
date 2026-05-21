<template>
  <div class="planner-quarantine-tab">
    <header class="tab-header">
      <h2 class="tab-title">{{ $t("planner.quarantine.title") as string }}</h2>
      <p class="tab-description text-secondary">
        {{ $t("planner.quarantine.description") as string }}
      </p>
    </header>

    <div v-if="quarantine.isPending.value && runs.length === 0" class="state-block">
      <p class="text-tertiary">{{ $t("common.loading") as string }}</p>
    </div>

    <div v-else-if="runs.length === 0" class="state-block empty-state">
      <p class="text-secondary">{{ $t("planner.quarantine.empty") as string }}</p>
    </div>

    <div v-else class="run-list">
      <QuarantineRunCard
        v-for="run in runs"
        :key="run.id"
        :run="run"
        :project-slug="projectSlug"
        :retrying="retryingId === run.id"
        @retry="onRetry"
      />
    </div>

    <q-dialog v-model="confirmDialog.open">
      <div class="confirm-card">
        <h3 class="confirm-title">{{ $t("planner.quarantine.retryConfirm.title") as string }}</h3>
        <p class="confirm-body text-secondary">
          {{
            $t("planner.quarantine.retryConfirm.body", {
              n: confirmDialog.isoWeek,
              year: confirmDialog.year,
            }) as string
          }}
        </p>
        <div class="confirm-actions">
          <GlassButton
            variant="ghost"
            :disabled="confirmDialog.busy"
            @click="confirmDialog.open = false"
          >
            {{ $t("planner.quarantine.retryConfirm.cancel") as string }}
          </GlassButton>
          <GlassButton
            variant="primary"
            :loading="confirmDialog.busy"
            @click="onRetryConfirmed"
          >
            {{ $t("planner.quarantine.retryConfirm.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuasar } from "quasar";
import GlassButton from "src/components/ui/GlassButton.vue";
import QuarantineRunCard from "src/components/planner/QuarantineRunCard.vue";
import {
  useQuarantineRuns,
  type QuarantineRun,
} from "src/composables/planner/useQuarantineRuns";
import { usePlanGeneration } from "src/composables/planner/usePlanGeneration";

/**
 * Spec 62.7: Quarantine tab content. Lists failed PlanWeekPipeline runs,
 * deep-links to /runs/:id (Spec 62.6 detail page) for inspection, and offers a
 * Retry action that triggers a new plan-run with `force: true` for the same
 * (year, isoWeek). The original failed run stays in history — by design, the
 * Quarantine list is an audit trail.
 *
 * Retry flow:
 *   1. Click "Retry" on a card → confirm dialog opens with the target week
 *   2. Confirm → POST /plans/generate with `force: true`, `triggeredBy:
 *      'retry-from-quarantine'`
 *   3. On ok → toast + refetch quarantine list (the failed row remains; a new
 *      pipeline_run is created, separate from the old one)
 *   4. On error → toast + keep dialog open so the user can retry
 */
export default defineComponent({
  name: "PlannerQuarantineTab",

  components: { GlassButton, QuarantineRunCard },

  props: {
    projectSlug: { type: String, required: true },
  },

  setup() {
    const $q = useQuasar();
    const generation = usePlanGeneration();
    // useQuarantineRuns defaults to limit=20, offset=0, autoRefresh=true. When
    // the parent switches away from this tab the component unmounts and the
    // TanStack query is destroyed — no explicit polling on/off needed.
    const quarantine = useQuarantineRuns();
    return { $q, generation, quarantine };
  },

  data: () => ({
    retryingId: null as string | null,
    confirmDialog: {
      open: false,
      busy: false,
      run: null as QuarantineRun | null,
      year: 0,
      isoWeek: 0,
    },
  }),

  computed: {
    runs(): QuarantineRun[] {
      return this.quarantine.runs.value;
    },
  },

  methods: {
    onRetry(run: QuarantineRun): void {
      const input = run.input ?? {};
      const year = typeof input.targetYear === "number" ? input.targetYear : null;
      const week = typeof input.targetIsoWeek === "number" ? input.targetIsoWeek : null;
      if (year === null || week === null) {
        this.notify(this.$t("planner.quarantine.retryUnsupported") as string, "negative");
        return;
      }
      this.confirmDialog = {
        open: true,
        busy: false,
        run,
        year,
        isoWeek: week,
      };
    },
    async onRetryConfirmed(): Promise<void> {
      const dialog = this.confirmDialog;
      const run = dialog.run;
      if (!run) return;
      dialog.busy = true;
      this.retryingId = run.id;
      try {
        const result = await this.generation.generate({
          targetYear: dialog.year,
          targetIsoWeek: dialog.isoWeek,
          force: true,
        });
        if (result.kind === "ok") {
          this.notify(this.$t("planner.quarantine.retryStarted") as string, "positive");
          this.confirmDialog.open = false;
          await this.quarantine.refetch();
          return;
        }
        if (result.kind === "budget_exceeded") {
          this.notify(result.message, "negative");
          return;
        }
        if (result.kind === "project_paused") {
          this.notify(result.message, "warning");
          return;
        }
        // 'exists' shouldn't fire with force=true; treat as generic failure.
        this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
      } finally {
        dialog.busy = false;
        this.retryingId = null;
      }
    },
    notify(message: string, type: "positive" | "negative" | "warning"): void {
      this.$q.notify({ message, type, position: "top" });
    },
  },
});
</script>

<style scoped>
.planner-quarantine-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.tab-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.tab-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.tab-description {
  font-size: 13px;
  margin: 0;
}

.state-block {
  padding: var(--space-5);
  text-align: center;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-glass-subtle);
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

.run-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.confirm-card {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 480px;
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.confirm-body {
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
