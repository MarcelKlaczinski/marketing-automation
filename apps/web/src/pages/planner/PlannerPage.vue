<template>
  <div class="planner-page">
    <!-- Header row -->
    <header class="planner-header">
      <div class="header-row">
        <h1 class="page-title">{{ $t("planner.title") as string }}</h1>

        <div class="header-controls">
          <PlannerWeekNavigator
            :year="year"
            :iso-week="isoWeek"
            @prev="nav.goPrev"
            @next="nav.goNext"
            @today="nav.goToCurrent"
            @open-picker="openWeekPicker"
          />

          <q-btn-toggle
            v-model="viewMode"
            :options="viewToggleOptions"
            spread
            no-caps
            unelevated
            toggle-color="primary"
            :aria-label="$t('planner.viewToggleAria') as string"
            class="view-toggle"
            @update:model-value="onViewModeChange"
          />
        </div>
      </div>

      <PlannerBudgetBar
        v-if="plan"
        :spent-eur="planSpentEur"
        :budget-eur="weeklyBudgetEur"
      />

      <PlannerActionBar
        v-if="plan"
        :plan-status="plan.status"
        :selected-count="selectedIds.size"
        :pending-count="pendingItemCount"
        @approve="onApproveClicked"
        @cancel-plan="onCancelPlanClicked"
        @regenerate="onRegenerateClicked"
      />
    </header>

    <!-- Loading state -->
    <div v-if="isPending" class="state-block">
      <p class="text-tertiary">{{ $t("common.loading") as string }}</p>
    </div>

    <!-- Empty (no plan for this week) -->
    <div v-else-if="!plan" class="state-block empty-state">
      <h2>{{ $t("planner.empty.title") as string }}</h2>
      <p class="text-secondary">
        {{ $t("planner.empty.description", { n: isoWeek, year }) as string }}
      </p>
      <PlannerGenerateButton
        :year="year"
        :iso-week="isoWeek"
        :loading="generation.isGenerating.value"
        @confirmed="onGenerateConfirmed"
      />
    </div>

    <!-- Plan body -->
    <div v-else class="planner-body">
      <PlannerGridView
        v-if="effectiveViewMode === 'grid' && !isMobile"
        :year="year"
        :iso-week="isoWeek"
        :items="items"
        :selected-ids="selectedIds"
        :show-checkboxes="canEditItems"
        :drag-enabled="canEditItems"
        @open-item="openItemDetail"
        @toggle-select="onToggleSelect"
        @reschedule="onReschedule"
      />
      <PlannerListView
        v-else
        :year="year"
        :iso-week="isoWeek"
        :items="items"
        :selected-ids="selectedIds"
        :show-checkboxes="canEditItems"
        @open-item="openItemDetail"
        @toggle-select="onToggleSelect"
      />
    </div>

    <!-- Confirm dialogs -->
    <q-dialog v-model="cancelPlanDialog.open">
      <div class="confirm-card">
        <h2 class="confirm-title">{{ $t("planner.cancelPlanConfirm.title") as string }}</h2>
        <p class="confirm-body text-secondary">{{ $t("planner.cancelPlanConfirm.body") as string }}</p>
        <div class="confirm-actions">
          <GlassButton variant="ghost" @click="cancelPlanDialog.open = false">
            {{ $t("planner.cancelPlanConfirm.cancel") as string }}
          </GlassButton>
          <GlassButton variant="danger" :loading="cancelPlanDialog.busy" @click="onCancelPlanConfirmed">
            {{ $t("planner.cancelPlanConfirm.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <q-dialog v-model="regenerateDialog.open">
      <div class="confirm-card">
        <h2 class="confirm-title">{{ $t("planner.regenerateConfirm.title") as string }}</h2>
        <p class="confirm-body text-secondary">{{ $t("planner.regenerateConfirm.body") as string }}</p>
        <div class="confirm-actions">
          <GlassButton variant="ghost" @click="regenerateDialog.open = false">
            {{ $t("planner.regenerateConfirm.cancel") as string }}
          </GlassButton>
          <GlassButton variant="primary" :loading="regenerateDialog.busy" @click="onRegenerateConfirmed">
            {{ $t("planner.regenerateConfirm.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <q-dialog v-model="approveSelectedDialog.open">
      <div class="confirm-card">
        <h2 class="confirm-title">{{ $t("planner.approveSelectedConfirm.title") as string }}</h2>
        <p class="confirm-body text-secondary">
          {{
            $t("planner.approveSelectedConfirm.body", {
              toCancel: approveSelectedDialog.toCancel,
              toKeep: approveSelectedDialog.toKeep,
            }) as string
          }}
        </p>
        <div class="confirm-actions">
          <GlassButton variant="ghost" @click="approveSelectedDialog.open = false">
            {{ $t("planner.approveSelectedConfirm.cancel") as string }}
          </GlassButton>
          <GlassButton
            variant="primary"
            :loading="approveSelectedDialog.busy"
            @click="onApproveSelectedConfirmed"
          >
            {{ $t("planner.approveSelectedConfirm.confirm") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

    <!-- Week picker dialog -->
    <q-dialog v-model="weekPickerOpen">
      <q-date
        v-model="weekPickerValue"
        mask="YYYY-MM-DD"
        @update:model-value="onWeekPicked"
      />
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { LocalStorage, useQuasar } from "quasar";
import PlannerWeekNavigator from "src/components/planner/PlannerWeekNavigator.vue";
import PlannerBudgetBar from "src/components/planner/PlannerBudgetBar.vue";
import PlannerActionBar from "src/components/planner/PlannerActionBar.vue";
import PlannerGenerateButton from "src/components/planner/PlannerGenerateButton.vue";
import PlannerGridView from "src/components/planner/PlannerGridView.vue";
import PlannerListView from "src/components/planner/PlannerListView.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import { usePlannerNavigation } from "src/composables/planner/usePlannerNavigation";
import { useWeeklyPlan } from "src/composables/planner/useWeeklyPlan";
import { usePlanGeneration } from "src/composables/planner/usePlanGeneration";
import { usePlanItemActions } from "src/composables/planner/usePlanItemActions";
import { getIsoWeek } from "src/lib/iso-week";
import type { PlannedItem, WeeklyPlanStatus } from "src/types/ui";

const VIEW_MODE_KEY = "planner.viewMode";

type ViewMode = "grid" | "list";

/**
 * Planner calendar root.
 *
 * State sources:
 *  - usePlannerNavigation:   (year, isoWeek) ↔ URL query
 *  - useWeeklyPlan:           plan + items + planner-config via TanStack Query
 *  - usePlanItemActions:      cancel/reschedule/approve with optimistic cache patches
 *  - usePlanGeneration:       POST /plans/generate with 409 retry-with-force
 */
export default defineComponent({
  name: "PlannerPage",

  components: {
    PlannerWeekNavigator,
    PlannerBudgetBar,
    PlannerActionBar,
    PlannerGenerateButton,
    PlannerGridView,
    PlannerListView,
    GlassButton,
  },

  setup() {
    const nav = usePlannerNavigation();
    const planQuery = useWeeklyPlan({ year: nav.year, isoWeek: nav.isoWeek });
    const generation = usePlanGeneration();
    const actions = usePlanItemActions();
    const $q = useQuasar();
    return { nav, planQuery, generation, actions, $q };
  },

  data: () => {
    const stored = LocalStorage.getItem(VIEW_MODE_KEY);
    const initialMode: ViewMode = stored === "list" || stored === "grid" ? stored : "grid";
    return {
      viewMode: initialMode,
      isMobile: globalThis.innerWidth < 768,
      resizeHandler: null as (() => void) | null,
      selectedIds: new Set<string>(),
      cancelPlanDialog: { open: false, busy: false },
      regenerateDialog: { open: false, busy: false },
      approveSelectedDialog: {
        open: false,
        busy: false,
        toCancel: 0,
        toKeep: 0,
      },
      weekPickerOpen: false,
      weekPickerValue: "",
    };
  },

  computed: {
    year(): number {
      return this.nav.year.value;
    },
    isoWeek(): number {
      return this.nav.isoWeek.value;
    },
    plan() {
      return this.planQuery.plan.value;
    },
    items(): PlannedItem[] {
      return this.planQuery.items.value;
    },
    isPending(): boolean {
      return this.planQuery.isPending.value;
    },
    config() {
      return this.planQuery.config.value;
    },
    weeklyBudgetEur(): number {
      const raw = this.config?.weeklyBudgetEur;
      const parsed = raw ? parseFloat(raw) : NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    },
    planSpentEur(): number {
      if (!this.plan) return 0;
      // Prefer actualCostEur (set when items run); fall back to estimated.
      const raw = this.plan.actualCostEur ?? this.plan.estimatedCostEur;
      const parsed = parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    pendingItemCount(): number {
      return this.items.filter((i) => i.status === "pending").length;
    },
    canEditItems(): boolean {
      const status: WeeklyPlanStatus | undefined = this.plan?.status;
      return status === "draft" || status === "approved";
    },
    effectiveViewMode(): ViewMode {
      // Mobile always uses list; desktop honours the toggle.
      if (this.isMobile) return "list";
      return this.viewMode;
    },
    viewToggleOptions() {
      return [
        { label: this.$t("planner.viewGrid") as string, value: "grid" as ViewMode },
        { label: this.$t("planner.viewList") as string, value: "list" as ViewMode },
      ];
    },
  },

  mounted(): void {
    this.resizeHandler = () => {
      this.isMobile = globalThis.innerWidth < 768;
    };
    globalThis.addEventListener("resize", this.resizeHandler);

    // Cmd+K action ?generate=current triggers generate immediately.
    if (this.$route.query["generate"] === "current") {
      const current = getIsoWeek(new Date());
      this.nav.goToWeek(current.year, current.isoWeek);
      void this.onGenerateConfirmed();
      // Strip the query so refresh doesn't retrigger.
      void this.$router.replace({
        query: { ...this.$route.query, generate: undefined },
      });
    }
  },

  beforeUnmount(): void {
    if (this.resizeHandler !== null) {
      globalThis.removeEventListener("resize", this.resizeHandler);
    }
  },

  watch: {
    // Drop selection when the displayed plan changes — selections only make
    // sense in the context of one specific plan id.
    "plan.id"(): void {
      this.selectedIds = new Set();
    },
  },

  methods: {
    onViewModeChange(v: ViewMode): void {
      LocalStorage.set(VIEW_MODE_KEY, v);
    },
    openWeekPicker(): void {
      this.weekPickerOpen = true;
    },
    onWeekPicked(value: string | null): void {
      if (!value) return;
      const picked = new Date(`${value}T00:00:00.000Z`);
      const { year, isoWeek } = getIsoWeek(picked);
      this.nav.goToWeek(year, isoWeek);
      this.weekPickerOpen = false;
    },
    openItemDetail(itemId: string): void {
      void this.$router.push({
        name: "planner-item-detail",
        params: { itemId },
      });
    },
    onToggleSelect(itemId: string, checked: boolean): void {
      // Replace the Set so Vue reactivity sees a change.
      const next = new Set(this.selectedIds);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      this.selectedIds = next;
    },
    async onReschedule(itemId: string, newSlotDate: string): Promise<void> {
      if (!this.plan) return;
      const planId = this.plan.id;
      try {
        await this.actions.rescheduleItem(planId, itemId, newSlotDate);
        this.notify(this.$t("planner.toast.itemRescheduled") as string, "positive");
      } catch (err) {
        const msg = errorMessage(err);
        if (msg.includes("slot_date_outside")) {
          this.notify(this.$t("planner.toast.rescheduleOutOfRange") as string, "negative");
        } else {
          this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
        }
        // The composable already invalidates on error — UI will re-sync.
      }
    },
    onApproveClicked(): void {
      if (!this.plan) return;
      const pendingIds = this.items.filter((i) => i.status === "pending").map((i) => i.id);
      if (pendingIds.length === 0) return;
      // Option A (Punkt 1): if any items are selected → "Cancel unselected + Approve"
      if (this.selectedIds.size > 0 && this.selectedIds.size < pendingIds.length) {
        const toCancel = pendingIds.filter((id) => !this.selectedIds.has(id)).length;
        const toKeep = pendingIds.length - toCancel;
        this.approveSelectedDialog = {
          open: true,
          busy: false,
          toCancel,
          toKeep,
        };
        return;
      }
      // No selection or all-selected → straight approve all.
      void this.runApproveAll();
    },
    async runApproveAll(): Promise<void> {
      if (!this.plan) return;
      try {
        await this.actions.approvePlan(this.plan.id);
        this.notify(this.$t("planner.toast.planApproved") as string, "positive");
      } catch (err) {
        void err;
        this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
      }
    },
    async onApproveSelectedConfirmed(): Promise<void> {
      if (!this.plan) return;
      const planId = this.plan.id;
      const pendingIds = this.items.filter((i) => i.status === "pending").map((i) => i.id);
      this.approveSelectedDialog.busy = true;
      try {
        await this.actions.approveSelected(planId, this.selectedIds, pendingIds);
        this.notify(this.$t("planner.toast.planApproved") as string, "positive");
        this.approveSelectedDialog.open = false;
      } catch (err) {
        void err;
        this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
      } finally {
        this.approveSelectedDialog.busy = false;
      }
    },
    onCancelPlanClicked(): void {
      this.cancelPlanDialog = { open: true, busy: false };
    },
    async onCancelPlanConfirmed(): Promise<void> {
      if (!this.plan) return;
      this.cancelPlanDialog.busy = true;
      try {
        await this.actions.cancelPlan(this.plan.id);
        this.notify(this.$t("planner.toast.planCancelled") as string, "positive");
        this.cancelPlanDialog.open = false;
      } catch (err) {
        void err;
        this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
      } finally {
        this.cancelPlanDialog.busy = false;
      }
    },
    onRegenerateClicked(): void {
      this.regenerateDialog = { open: true, busy: false };
    },
    async onRegenerateConfirmed(): Promise<void> {
      this.regenerateDialog.busy = true;
      try {
        const result = await this.generation.generate({
          targetYear: this.year,
          targetIsoWeek: this.isoWeek,
          force: true,
        });
        if (result.kind === "ok") {
          this.notify(this.$t("planner.toast.planGenerated") as string, "positive");
          this.regenerateDialog.open = false;
        } else if (result.kind === "budget_exceeded") {
          this.notify(result.message, "negative");
        } else if (result.kind === "project_paused") {
          this.notify(result.message, "warning");
        } else if (result.kind !== "exists") {
          this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
        }
      } finally {
        this.regenerateDialog.busy = false;
      }
    },
    async onGenerateConfirmed(): Promise<void> {
      const result = await this.generation.generate({
        targetYear: this.year,
        targetIsoWeek: this.isoWeek,
        force: false,
      });
      if (result.kind === "ok") {
        this.notify(this.$t("planner.toast.planGenerated") as string, "positive");
        return;
      }
      if (result.kind === "exists") {
        // Offer regenerate path. Spec §4.6 §5.
        this.notify(this.$t("planner.toast.planAlreadyExists") as string, "warning");
        this.regenerateDialog = { open: true, busy: false };
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
      this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
    },
    notify(message: string, type: "positive" | "negative" | "warning"): void {
      this.$q.notify({ message, type, position: "top" });
    },
  },
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
</script>

<style scoped>
.planner-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.planner-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.view-toggle {
  height: 32px;
}

.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-4);
  min-height: 280px;
}

.empty-state h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.planner-body {
  min-height: 400px;
}

.confirm-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  width: 480px;
  max-width: 95vw;
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
}

.confirm-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
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

@media (max-width: 767px) {
  .view-toggle {
    display: none;
  }
}
</style>
