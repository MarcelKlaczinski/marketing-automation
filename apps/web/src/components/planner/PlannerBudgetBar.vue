<template>
  <div class="budget-bar" :class="`status-${colorStatus}`">
    <div class="budget-header">
      <span class="budget-label">{{ $t("planner.budget.label") as string }}</span>
      <span class="budget-amounts mono">
        {{ $t("planner.budget.used", { used: usedDisplay, total: totalDisplay }) as string }}
        <span class="budget-percent">
          ({{ $t("planner.budget.percent", { percent: percentDisplay }) as string }})
        </span>
      </span>
    </div>
    <div class="budget-track" role="progressbar" :aria-valuenow="clampedPercent" aria-valuemin="0" aria-valuemax="100">
      <div class="budget-fill" :style="{ width: barWidth }" />
    </div>
    <div v-if="tooltip" class="budget-breakdown text-tertiary">
      {{ tooltip }}
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

type ColorStatus = "green" | "yellow" | "red";

/**
 * Budget bar with three-step traffic-light colour status:
 *   < 85%   → green
 *   85-100% → yellow
 *   > 100%  → red (should not happen if BudgetGate works; safety net only)
 *
 * Inputs are decimal numbers (EUR). `floorEur` / `overageEur` / `siblingEur`
 * are optional — when provided, render the breakdown line below the bar.
 */
export default defineComponent({
  name: "PlannerBudgetBar",

  props: {
    spentEur: { type: Number, required: true },
    budgetEur: { type: Number, required: true },
    floorEur: { type: Number, default: 0 },
    overageEur: { type: Number, default: 0 },
    siblingEur: { type: Number, default: 0 },
  },

  computed: {
    rawPercent(): number {
      if (this.budgetEur <= 0) return 0;
      return (this.spentEur / this.budgetEur) * 100;
    },
    clampedPercent(): number {
      return Math.max(0, Math.min(this.rawPercent, 100));
    },
    barWidth(): string {
      return `${this.clampedPercent.toFixed(1)}%`;
    },
    percentDisplay(): string {
      return Math.round(this.rawPercent).toString();
    },
    usedDisplay(): string {
      return this.spentEur.toFixed(2);
    },
    totalDisplay(): string {
      return this.budgetEur.toFixed(2);
    },
    colorStatus(): ColorStatus {
      if (this.rawPercent > 100) return "red";
      if (this.rawPercent >= 85) return "yellow";
      return "green";
    },
    tooltip(): string {
      // Only render the breakdown line if any sub-bucket is non-zero — keeps
      // the bar tight when the planner didn't tag costs by source.
      if (this.floorEur === 0 && this.overageEur === 0 && this.siblingEur === 0) {
        return "";
      }
      return this.$t("planner.budget.tooltip", {
        floor: this.floorEur.toFixed(2),
        overage: this.overageEur.toFixed(2),
        sibling: this.siblingEur.toFixed(2),
      }) as string;
    },
  },
});
</script>

<style scoped>
.budget-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
}

.budget-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.budget-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
}

.budget-amounts {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.budget-percent {
  color: var(--text-tertiary);
  font-weight: 500;
  margin-left: 4px;
}

.budget-track {
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.budget-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 240ms cubic-bezier(0.23, 1, 0.32, 1),
              background 160ms cubic-bezier(0.23, 1, 0.32, 1);
}

.status-green .budget-fill {
  background: var(--status-running, #16d97e);
}

.status-yellow .budget-fill {
  background: #f5a524;
}

.status-red .budget-fill {
  background: var(--status-failed, #ff4d6d);
}

.status-red {
  border-color: rgba(255, 77, 109, 0.3);
}

.budget-breakdown {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
</style>
