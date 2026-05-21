<template>
  <div class="action-bar">
    <!-- Status badge -->
    <span class="plan-status-badge" :class="`status-${planStatus}`">
      {{ $t(`planner.planStatus.${planStatus}`) as string }}
    </span>

    <!-- DRAFT actions -->
    <template v-if="planStatus === 'draft'">
      <GlassButton variant="primary" :disabled="approveDisabled" @click="$emit('approve')">
        {{ approveLabel }}
      </GlassButton>
      <GlassButton variant="ghost" @click="$emit('cancel-plan')">
        {{ $t("planner.actions.cancelPlan") as string }}
      </GlassButton>
      <GlassButton variant="ghost" @click="$emit('regenerate')">
        {{ $t("planner.actions.regenerate") as string }}
      </GlassButton>
    </template>

    <!-- APPROVED actions -->
    <template v-else-if="planStatus === 'approved'">
      <GlassButton
        variant="secondary"
        :disabled="true"
      >
        {{ $t("planner.actions.viewRuns") as string }}
        <q-tooltip>{{ $t("planner.actions.viewRunsComingSoon") as string }}</q-tooltip>
      </GlassButton>
      <GlassButton variant="ghost" @click="$emit('cancel-plan')">
        {{ $t("planner.actions.cancelPlan") as string }}
      </GlassButton>
    </template>

    <!-- RUNNING / higher -->
    <template v-else-if="planStatus === 'running' || planStatus === 'partially_failed'">
      <GlassButton variant="danger" @click="$emit('cancel-plan')">
        {{ $t("planner.actions.cancelPlan") as string }}
      </GlassButton>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import type { WeeklyPlanStatus } from "src/types/ui";

/**
 * State-dependent action bar for a weekly plan.
 *
 * Approve-Selected (Option A): when `selectedCount > 0`, the primary button
 * label flips to "Approve selected (N)" and `approveDisabled` is true only
 * when there are no pending items at all (selectedCount === 0 with no
 * unselected pending). The dialog/flow is owned by the parent.
 */
export default defineComponent({
  name: "PlannerActionBar",

  components: { GlassButton },

  emits: ["approve", "cancel-plan", "regenerate"],

  props: {
    planStatus: { type: String as PropType<WeeklyPlanStatus>, required: true },
    /** number of pending items the user has checkbox-selected to keep */
    selectedCount: { type: Number, default: 0 },
    /** total pending-item count — controls disabled state when nothing to approve */
    pendingCount: { type: Number, default: 0 },
  },

  computed: {
    approveLabel(): string {
      if (this.selectedCount > 0) {
        return this.$t("planner.actions.approveSelected", { n: this.selectedCount }) as string;
      }
      return this.$t("planner.actions.approveAll") as string;
    },
    approveDisabled(): boolean {
      // Nothing pending → nothing to approve. Otherwise enable (approveAll covers
      // the zero-selection case; selectedCount > 0 enables approve-selected).
      return this.pendingCount === 0;
    },
  },
});
</script>

<style scoped>
.action-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.plan-status-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 14px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.status-draft {
  background: var(--bg-glass-strong);
  color: var(--text-secondary);
  border-color: var(--border-subtle);
}

.status-approved {
  background: rgba(22, 217, 126, 0.12);
  color: #16d97e;
  border-color: rgba(22, 217, 126, 0.3);
}

.status-running {
  background: rgba(0, 212, 255, 0.12);
  color: #00d4ff;
  border-color: rgba(0, 212, 255, 0.3);
}

.status-completed {
  background: rgba(22, 217, 126, 0.12);
  color: #16d97e;
  border-color: rgba(22, 217, 126, 0.3);
}

.status-partially_failed {
  background: rgba(245, 165, 36, 0.14);
  color: #f5a524;
  border-color: rgba(245, 165, 36, 0.32);
}

.status-cancelled,
.status-superseded {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-tertiary);
  border-color: var(--border-subtle);
}
</style>
