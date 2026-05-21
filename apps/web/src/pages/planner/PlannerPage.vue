<template>
  <div class="planner-page">
    <!-- Tabs row (Spec 62.7) -->
    <div class="tabs-row">
      <div class="tab-list" role="tablist">
        <button
          type="button"
          class="tab-button"
          :class="{ active: activeTab === 'calendar' }"
          role="tab"
          :aria-selected="activeTab === 'calendar'"
          @click="setActiveTab('calendar')"
        >
          {{ $t("planner.tabs.calendar") as string }}
        </button>
        <button
          type="button"
          class="tab-button"
          :class="{ active: activeTab === 'quarantine' }"
          role="tab"
          :aria-selected="activeTab === 'quarantine'"
          @click="setActiveTab('quarantine')"
        >
          {{ $t("planner.tabs.quarantine") as string }}
          <span v-if="quarantineCount > 0" class="tab-badge">
            {{ quarantineCount }}
          </span>
        </button>
      </div>

      <button
        type="button"
        class="cron-indicator"
        :class="{ active: cronEnabled }"
        :title="cronIndicatorTitle"
        @click="goToCronSettings"
      >
        <span class="cron-indicator-dot" />
        {{ cronIndicatorLabel }}
      </button>
    </div>

    <!-- Calendar tab content -->
    <template v-if="activeTab === 'calendar'">
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
        :llm-mode="planLlmMode"
      />

      <PlannerActionBar
        v-if="plan"
        :plan-status="plan.status"
        :selected-count="selectedIds.size"
        :pending-count="pendingItemCount"
        :cancellable-count="cancellableItemCount"
        @approve="onApproveClicked"
        @cancel-plan="onCancelPlanClicked"
        @cancel-pending="onCancelPendingClicked"
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
        @retry-item="onRetryItem"
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
        @retry-item="onRetryItem"
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

    <!-- Spec 62.8: cancel pending items confirm dialog -->
    <q-dialog v-model="cancelPendingDialog.open">
      <div class="confirm-card">
        <h2 class="confirm-title">{{ $t("planner.execution.cancelPendingConfirm.title") as string }}</h2>
        <p class="confirm-body text-secondary">{{ $t("planner.execution.cancelPendingConfirm.body") as string }}</p>
        <div class="confirm-actions">
          <GlassButton variant="ghost" @click="cancelPendingDialog.open = false">
            {{ $t("planner.execution.cancelPendingConfirm.cancel") as string }}
          </GlassButton>
          <GlassButton
            variant="danger"
            :loading="cancelPendingDialog.busy"
            @click="onCancelPendingConfirmed"
          >
            {{ $t("planner.execution.cancelPendingConfirm.confirm") as string }}
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
    </template>

    <!-- Quarantine tab content (Spec 62.7) -->
    <PlannerQuarantineTab v-else :project-slug="projectSlug" />
  </div>
</template>

<script lang="ts">
import { LocalStorage } from "quasar";
import PlannerActionBar from "src/components/planner/PlannerActionBar.vue";
import PlannerBudgetBar from "src/components/planner/PlannerBudgetBar.vue";
import PlannerGenerateButton from "src/components/planner/PlannerGenerateButton.vue";
import PlannerGridView from "src/components/planner/PlannerGridView.vue";
import PlannerListView from "src/components/planner/PlannerListView.vue";
import PlannerQuarantineTab from "src/components/planner/PlannerQuarantineTab.vue";
import PlannerWeekNavigator from "src/components/planner/PlannerWeekNavigator.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import { usePlanGeneration } from "src/composables/planner/usePlanGeneration";
import { usePlanItemActions } from "src/composables/planner/usePlanItemActions";
import { usePlannerNavigation } from "src/composables/planner/usePlannerNavigation";
import { useQuarantineRuns } from "src/composables/planner/useQuarantineRuns";
import { useWeeklyPlan } from "src/composables/planner/useWeeklyPlan";
import { getIsoWeek } from "src/lib/iso-week";
import type { PlannedItem, WeeklyPlanStatus } from "src/types/ui";
import { defineComponent } from "vue";

type PlannerTab = "calendar" | "quarantine";

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
    PlannerQuarantineTab,
    GlassButton,
  },

  setup() {
    const nav = usePlannerNavigation();
    const planQuery = useWeeklyPlan({ year: nav.year, isoWeek: nav.isoWeek });
    const generation = usePlanGeneration();
    const actions = usePlanItemActions();
    // Spec 62.7: badge count for the Quarantine tab. Same TanStack query key
    // the child PlannerQuarantineTab uses (default limit=20, offset=0) so when
    // the user opens the tab the data is already warm and dedupes the request.
    const quarantine = useQuarantineRuns();
    return { nav, planQuery, generation, actions, quarantine };
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
      cancelPendingDialog: { open: false, busy: false },
      regenerateDialog: { open: false, busy: false },
      approveSelectedDialog: {
        open: false,
        busy: false,
        toCancel: 0,
        toKeep: 0,
      },
      weekPickerOpen: false,
      weekPickerValue: "",
      // Spec 62.7: tab state is mirrored to URL via ?tab=… so deep-links work.
      activeTab: "calendar" as PlannerTab,
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
      const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    },
    planSpentEur(): number {
      if (!this.plan) return 0;
      // Prefer actualCostEur (set when items run); fall back to estimated.
      const raw = this.plan.actualCostEur ?? this.plan.estimatedCostEur;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    },
    /**
     * Spec 62.5.1: LLM mode the plan was generated under. Read from the
     * frozen `inputSnapshot.config.llmMode`, not from current `projects.llmMode`
     * — the latter could change between generation and viewing, and the budget
     * bar must reflect the assumptions baked into the estimate.
     */
    planLlmMode(): "sync" | "batch" {
      const snapshot = this.plan?.inputSnapshot;
      if (!snapshot || typeof snapshot !== "object") return "sync";
      const config = (snapshot as { config?: { llmMode?: string } }).config;
      return config?.llmMode === "batch" ? "batch" : "sync";
    },
    pendingItemCount(): number {
      return this.items.filter((i) => i.status === "pending").length;
    },
    // Spec 62.8: drives the "Cancel pending" action visibility. The
    // /cancel-pending endpoint cancels both 'pending' and 'enqueued' rows;
    // 'in_progress' items are intentionally left running.
    cancellableItemCount(): number {
      return this.items.filter(
        (i) => i.status === "pending" || i.status === "enqueued",
      ).length;
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
    // Spec 62.7: live count for the Quarantine tab badge (TanStack-shared
    // with the child component → one network call).
    quarantineCount(): number {
      return this.quarantine.total.value;
    },
    projectSlug(): string {
      const raw = this.$route.params.slug;
      return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
    },
    cronEnabled(): boolean {
      return this.config?.cronEnabled === true;
    },
    cronIndicatorLabel(): string {
      const key = this.cronEnabled ? "planner.cronIndicator.on" : "planner.cronIndicator.off";
      return this.$t(key) as string;
    },
    cronIndicatorTitle(): string {
      const key = this.cronEnabled
        ? "planner.cronIndicator.onTooltip"
        : "planner.cronIndicator.offTooltip";
      return this.$t(key) as string;
    },
  },

  mounted(): void {
    this.resizeHandler = () => {
      this.isMobile = globalThis.innerWidth < 768;
    };
    globalThis.addEventListener("resize", this.resizeHandler);

    // Spec 62.7: restore tab from URL ?tab=quarantine. Default = calendar.
    const tabRaw = this.$route.query["tab"];
    const tab = Array.isArray(tabRaw) ? tabRaw[0] : tabRaw;
    if (tab === "quarantine") {
      this.activeTab = "quarantine";
    }

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
    // Spec 62.8: cancel-pending bulk action — separate from "cancel plan".
    onCancelPendingClicked(): void {
      this.cancelPendingDialog = { open: true, busy: false };
    },
    async onCancelPendingConfirmed(): Promise<void> {
      if (!this.plan) return;
      this.cancelPendingDialog.busy = true;
      try {
        const result = await this.actions.cancelPendingItems(this.plan.id);
        this.notify(
          this.$t("planner.execution.cancelPendingSuccess", {
            cancelled: result.cancelled,
            generatingUntouched: result.generatingUntouched,
          }) as string,
          "positive",
        );
        this.cancelPendingDialog.open = false;
      } catch (err) {
        void err;
        this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
      } finally {
        this.cancelPendingDialog.busy = false;
      }
    },
    // Spec 62.8: per-item manual retry. Surface result via toast; cache patch
    // already applied by usePlanItemActions.retryItem.
    async onRetryItem(itemId: string): Promise<void> {
      if (!this.plan) return;
      try {
        await this.actions.retryItem(this.plan.id, itemId);
        this.notify(this.$t("planner.execution.retrySuccess") as string, "positive");
      } catch (err) {
        void err;
        this.notify(this.$t("planner.toast.actionFailed") as string, "negative");
      }
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
    async onGenerateConfirmed(payload?: { debug?: boolean }): Promise<void> {
      const debug = payload?.debug === true;
      const result = await this.generation.generate({
        targetYear: this.year,
        targetIsoWeek: this.isoWeek,
        force: false,
        debug,
      });
      if (result.kind === "ok") {
        // Spec 62.6.1: in debug mode the pipeline pauses after step 1 within
        // ~1s — deep-link the user straight to the run so they can act.
        if (debug && result.runId) {
          const slugParam = this.$route.params.slug;
          const slug = Array.isArray(slugParam) ? (slugParam[0] ?? "") : (slugParam ?? "");
          this.notify(this.$t("planner.toast.planGeneratedDebug") as string, "positive");
          void this.$router.push({
            name: "run-detail",
            params: { slug, runId: result.runId },
          });
          return;
        }
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
    // Spec 62.7: tab switch + URL-sync. We mirror to ?tab=… so a refresh keeps
    // the user on the same tab and the link is shareable.
    setActiveTab(tab: PlannerTab): void {
      if (this.activeTab === tab) return;
      this.activeTab = tab;
      // Vue Router's query type is widened to LocationQueryValue (string|null|array).
      // The replace() call accepts the same shape we received, just with the one
      // `tab` key updated.
      const nextQuery = { ...this.$route.query, tab: tab === "calendar" ? undefined : tab };
      void this.$router.replace({ query: nextQuery });
    },
    goToCronSettings(): void {
      void this.$router.push({
        name: "settings-planner",
        params: { slug: this.projectSlug },
      });
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

/* Spec 62.7: tab navigation + cron-indicator */
.tabs-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-2);
  flex-wrap: wrap;
}

.tab-list {
  display: flex;
  gap: var(--space-1);
}

.tab-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  margin-bottom: -1px; /* overlap the border-bottom of the row */
}

@media (hover: hover) and (pointer: fine) {
  .tab-button:hover:not(.active) {
    color: var(--text-primary);
  }
}

.tab-button.active {
  color: var(--text-primary);
  border-bottom-color: var(--brand, #3b82f6);
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 600;
  background: var(--status-failed-bg);
  color: var(--status-failed, #ff4d6d);
  border: 1px solid rgba(255, 77, 109, 0.25);
}

.cron-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .cron-indicator:hover {
    border-color: var(--border-strong);
    background: var(--bg-glass-strong);
  }
}

.cron-indicator.active {
  color: var(--text-primary);
}

.cron-indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.cron-indicator.active .cron-indicator-dot {
  background: #22c55e;
  box-shadow: 0 0 0 2px color-mix(in oklch, #22c55e 25%, transparent);
}

@media (max-width: 767px) {
  .tab-button {
    min-height: 44px;
  }
  .cron-indicator {
    min-height: 32px;
  }
}
</style>
