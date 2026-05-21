<template>
  <div class="planner-item-detail">
    <header class="detail-header">
      <button class="back-btn" @click="goBack">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ $t("planner.detail.back") as string }}
      </button>

      <h1 class="page-title">{{ title }}</h1>

      <div class="header-meta">
        <span class="status-pill" :class="`is-${item?.status ?? 'pending'}`">
          {{ item ? $t(`planner.itemStatus.${item.status}`) as string : "—" }}
        </span>
      </div>

      <div v-if="item && canMutate" class="header-actions">
        <GlassButton variant="danger" :loading="cancelling" @click="onCancelItem">
          {{ $t("planner.detail.cancelItem") as string }}
        </GlassButton>
      </div>
    </header>

    <div v-if="isLoading" class="state-block text-tertiary">
      {{ $t("common.loading") as string }}
    </div>

    <div v-else-if="!item || !plan" class="state-block text-tertiary">
      {{ $t("common.notFound") as string }}
    </div>

    <div v-else class="detail-body">
      <!-- Schedule section -->
      <section class="detail-section">
        <h2 class="section-title">{{ $t("planner.detail.scheduleSection") as string }}</h2>
        <dl class="kv">
          <dt>{{ $t("planner.detail.fields.date") as string }}</dt>
          <dd>
            <span v-if="!editingSlotDate" class="mono">{{ slotDateDisplay }}</span>
            <PlannerSlotDateEditor
              v-else
              :initial-date="item.slotDate"
              :min-date="plan.weekStartDate.slice(0, 10)"
              :max-date="plan.weekEndDate.slice(0, 10)"
              :saving="reschedSaving"
              @save="onSaveSlotDate"
              @cancel="editingSlotDate = false"
            />
            <GlassButton
              v-if="!editingSlotDate && canMutateSlotDate"
              variant="ghost"
              size="sm"
              class="inline-edit"
              @click="editingSlotDate = true"
            >
              {{ $t("planner.detail.editSlotDate") as string }}
            </GlassButton>
          </dd>

          <dt>{{ $t("planner.detail.fields.planWeek") as string }}</dt>
          <dd class="mono">
            {{ $t("planner.week", { n: plan.isoWeek, year: plan.year }) as string }}
            <span class="text-tertiary">
              · {{ planWeekRange }}
            </span>
          </dd>
        </dl>
      </section>

      <!-- Content section -->
      <section class="detail-section">
        <h2 class="section-title">{{ $t("planner.detail.contentSection") as string }}</h2>
        <dl class="kv">
          <dt>{{ $t("planner.detail.fields.type") as string }}</dt>
          <dd>{{ contentTypeLabel }}</dd>
          <dt>{{ $t("planner.detail.fields.pipeline") as string }}</dt>
          <dd class="mono">{{ item.pipelineName }}</dd>
          <dt>{{ $t("planner.detail.fields.source") as string }}</dt>
          <dd>{{ $t(`planner.sourceKind.${item.sourceKind}`) as string }}</dd>
          <dt v-if="item.selectionReason">{{ $t("planner.detail.fields.reason") as string }}</dt>
          <dd v-if="item.selectionReason">{{ item.selectionReason }}</dd>
        </dl>
      </section>

      <!-- Cost section -->
      <section class="detail-section">
        <h2 class="section-title">{{ $t("planner.detail.costSection") as string }}</h2>
        <dl class="kv">
          <dt>{{ $t("planner.detail.fields.estimated") as string }}</dt>
          <dd class="mono">€{{ estimatedDisplay }}</dd>
          <dt>{{ $t("planner.detail.fields.actual") as string }}</dt>
          <dd class="mono">
            <span v-if="actualDisplay !== null">€{{ actualDisplay }}</span>
            <span v-else class="text-tertiary">{{ $t("planner.detail.fields.notExecuted") as string }}</span>
          </dd>
        </dl>
      </section>

      <!-- Sibling section -->
      <section v-if="hasSibling" class="detail-section">
        <h2 class="section-title">{{ $t("planner.detail.siblingSection") as string }}</h2>
        <p v-if="parentItem">
          <span class="text-secondary">{{ $t("planner.detail.siblingParent") as string }}:</span>
          <router-link
            class="link-arrow mono"
            :to="{ name: 'planner-item-detail', params: { itemId: parentItem.id } }"
          >
            {{ parentItem.id }} →
          </router-link>
        </p>
        <ul v-if="childSiblings.length > 0" class="sibling-list">
          <li v-for="sib in childSiblings" :key="sib.id">
            <span class="text-secondary">{{ $t("planner.detail.siblingChild") as string }}:</span>
            <router-link
              class="link-arrow mono"
              :to="{ name: 'planner-item-detail', params: { itemId: sib.id } }"
            >
              {{ sib.id }} →
            </router-link>
          </li>
        </ul>
      </section>

      <!-- Source brief link -->
      <section v-if="item.sourceBriefId" class="detail-section">
        <h2 class="section-title">{{ $t("planner.detail.sourceBriefSection") as string }}</h2>
        <router-link
          class="link-arrow"
          :to="`/projects/${slug}/briefs/${item.sourceBriefId}`"
        >
          {{ $t("planner.detail.viewSourceBrief") as string }} →
        </router-link>
      </section>

      <!-- Pipeline input JSON -->
      <section class="detail-section">
        <h2 class="section-title">{{ $t("planner.detail.pipelineInputSection") as string }}</h2>
        <pre class="json-display mono">{{ pipelineInputJson }}</pre>
      </section>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuasar } from "quasar";
import GlassButton from "src/components/ui/GlassButton.vue";
import PlannerSlotDateEditor from "src/components/planner/PlannerSlotDateEditor.vue";
import { usePlanItemContext } from "src/composables/planner/usePlanItemContext";
import { usePlanItemActions } from "src/composables/planner/usePlanItemActions";
import { useProjectStore } from "src/stores/project";
import { useRoute } from "vue-router";
import { formatShortDate } from "src/lib/iso-week";
import type { PlannedItem, WeeklyPlanStatus } from "src/types/ui";

const KNOWN_CONTENT_TYPE_KEYS = new Set([
  "cluster",
  "comparison",
  "ki_wissen",
  "social_post",
  "article",
  "refresh",
  "translation",
]);

/**
 * Detail page for one planned_item. The route param `itemId` is static for the
 * component lifetime — Vue Router remounts on navigation to a different item.
 *
 * Loading strategy: we don't have a dedicated GET /items/:id endpoint; instead
 * we resolve which plan owns the item by fetching the active plan for the
 * currently selected week. As a fallback we hit /plans (lists) to find the
 * row when the URL was deep-linked without first visiting the calendar.
 */
export default defineComponent({
  name: "PlannerItemDetailPage",

  components: { GlassButton, PlannerSlotDateEditor },

  setup() {
    const projectStore = useProjectStore();
    const $q = useQuasar();
    const route = useRoute();
    const rawId = route.params["itemId"];
    const itemId = Array.isArray(rawId) ? rawId[0] ?? "" : rawId ?? "";
    const context = usePlanItemContext(itemId);
    const actions = usePlanItemActions();
    return { projectStore, context, actions, $q, itemId };
  },

  data: () => ({
    editingSlotDate: false,
    reschedSaving: false,
    cancelling: false,
  }),

  computed: {
    slug(): string {
      return this.projectStore.currentSlug;
    },
    plan() {
      return this.context.plan.value;
    },
    items() {
      return this.context.items.value;
    },
    isLoading(): boolean {
      // While the composable's search window is still walking the ±N range,
      // hide the "not found" state — show loading instead.
      return this.context.isPending.value || (!this.context.resolved.value && this.items.length === 0);
    },
    item(): PlannedItem | undefined {
      return this.items.find((i: PlannedItem) => i.id === this.itemId);
    },
    title(): string {
      if (!this.item) return this.$t("planner.detail.title") as string;
      const input = this.item.pipelineInput;
      if (input && typeof input["title"] === "string") return input["title"];
      if (input && typeof input["topicTitle"] === "string") return input["topicTitle"];
      return this.contentTypeLabel;
    },
    contentTypeLabel(): string {
      if (!this.item) return "";
      const key = this.item.contentType.toLowerCase();
      if (KNOWN_CONTENT_TYPE_KEYS.has(key)) {
        return this.$t(`planner.contentType.${key}`) as string;
      }
      return this.item.contentType;
    },
    slotDateDisplay(): string {
      if (!this.item) return "";
      const locale: "de" | "en" = this.$i18n.locale === "de" ? "de" : "en";
      return formatShortDate(this.item.slotDate.slice(0, 10), locale);
    },
    planWeekRange(): string {
      if (!this.plan) return "";
      const locale: "de" | "en" = this.$i18n.locale === "de" ? "de" : "en";
      return this.$t("planner.weekRange", {
        start: formatShortDate(this.plan.weekStartDate.slice(0, 10), locale),
        end: formatShortDate(this.plan.weekEndDate.slice(0, 10), locale),
      }) as string;
    },
    estimatedDisplay(): string {
      const parsed = parseFloat(this.item?.estimatedCostEur ?? "0");
      return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
    },
    actualDisplay(): string | null {
      if (!this.item?.actualCostEur) return null;
      const parsed = parseFloat(this.item.actualCostEur);
      return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
    },
    canMutate(): boolean {
      if (!this.item) return false;
      // Spec §6: Cancel is allowed for pending OR enqueued items.
      return this.item.status === "pending" || this.item.status === "enqueued";
    },
    canMutateSlotDate(): boolean {
      if (!this.item || !this.plan) return false;
      const planStatus: WeeklyPlanStatus = this.plan.status;
      return (
        this.item.status === "pending" &&
        (planStatus === "draft" || planStatus === "approved")
      );
    },
    parentItem(): PlannedItem | null {
      // Spec 62.4-followup Issue 1: sibling_locale rows are deleted from
      // draft/approved plans by migration 0075. Items in still-running plans
      // can keep a parent_item_id pointing at a deleted row — fall back to
      // null and skip the sibling section in that case rather than rendering
      // a dead link.
      if (!this.item?.parentItemId) return null;
      return (
        this.items.find((i: PlannedItem) => i.id === this.item?.parentItemId) ?? null
      );
    },
    hasSibling(): boolean {
      return Boolean(this.parentItem) || this.childSiblings.length > 0;
    },
    childSiblings(): PlannedItem[] {
      if (!this.item) return [];
      return this.items.filter((i: PlannedItem) => i.parentItemId === this.item?.id);
    },
    pipelineInputJson(): string {
      if (!this.item) return "";
      try {
        return JSON.stringify(this.item.pipelineInput ?? {}, null, 2);
      } catch {
        return String(this.item.pipelineInput);
      }
    },
  },

  methods: {
    goBack(): void {
      // Prefer router.back so the user lands back on the calendar at their week.
      if (globalThis.history.length > 1) {
        this.$router.back();
        return;
      }
      void this.$router.push(`/projects/${this.slug}/planner`);
    },
    async onSaveSlotDate(newDate: string): Promise<void> {
      if (!this.item || !this.plan) return;
      this.reschedSaving = true;
      try {
        await this.actions.rescheduleItem(this.plan.id, this.item.id, newDate);
        this.editingSlotDate = false;
        this.$q.notify({
          message: this.$t("planner.toast.itemRescheduled") as string,
          type: "positive",
          position: "top",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const labelKey = msg.includes("slot_date_outside")
          ? "planner.toast.rescheduleOutOfRange"
          : "planner.toast.actionFailed";
        this.$q.notify({
          message: this.$t(labelKey) as string,
          type: "negative",
          position: "top",
        });
      } finally {
        this.reschedSaving = false;
      }
    },
    async onCancelItem(): Promise<void> {
      if (!this.item || !this.plan) return;
      this.cancelling = true;
      try {
        await this.actions.cancelItem(this.plan.id, this.item.id);
        this.$q.notify({
          message: this.$t("planner.toast.itemCancelled") as string,
          type: "positive",
          position: "top",
        });
      } catch (err) {
        void err;
        this.$q.notify({
          message: this.$t("planner.toast.actionFailed") as string,
          type: "negative",
          position: "top",
        });
      } finally {
        this.cancelling = false;
      }
    },
  },
});

</script>

<style scoped>
.planner-item-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  max-width: 960px;
  margin: 0 auto;
  width: 100%;
}

.detail-header {
  display: grid;
  grid-template-columns: 1fr auto auto;
  grid-template-rows: auto auto;
  column-gap: var(--space-3);
  row-gap: var(--space-2);
  align-items: center;
}

.back-btn {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  align-self: flex-start;
  width: max-content;
}

@media (hover: hover) and (pointer: fine) {
  .back-btn:hover {
    color: var(--text-primary);
  }
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  min-width: 0;
  overflow-wrap: break-word;
}

.header-meta {
  justify-self: end;
}

.header-actions {
  justify-self: end;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 14px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: var(--bg-glass-strong);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.is-pending {
  color: var(--text-secondary);
}

.is-completed {
  color: #16d97e;
  border-color: rgba(22, 217, 126, 0.3);
}

.is-failed {
  color: #ff4d6d;
  border-color: rgba(255, 77, 109, 0.3);
}

.is-cancelled {
  opacity: 0.7;
}

.state-block {
  padding: var(--space-6) 0;
  text-align: center;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.section-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin: 0 0 var(--space-1);
}

.kv {
  display: grid;
  grid-template-columns: 160px 1fr;
  column-gap: var(--space-3);
  row-gap: var(--space-2);
  margin: 0;
}

.kv dt {
  font-size: 12px;
  color: var(--text-tertiary);
}

.kv dd {
  font-size: 14px;
  color: var(--text-primary);
  margin: 0;
}

.link-arrow {
  color: var(--accent-primary);
  text-decoration: none;
  font-size: 14px;
}

@media (hover: hover) and (pointer: fine) {
  .link-arrow:hover {
    text-decoration: underline;
  }
}

.inline-edit {
  margin-left: var(--space-2);
}

.sibling-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.json-display {
  margin: 0;
  padding: var(--space-3);
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-sm, 6px);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow: auto;
  color: var(--text-secondary);
}

@media (max-width: 767px) {
  .detail-header {
    grid-template-columns: 1fr;
  }
  .header-meta,
  .header-actions {
    justify-self: flex-start;
  }
  .kv {
    grid-template-columns: 1fr;
  }
}
</style>
