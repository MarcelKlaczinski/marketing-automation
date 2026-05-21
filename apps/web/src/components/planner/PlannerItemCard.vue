<template>
  <div
    class="planner-item-card"
    :class="[
      `status-${item.status}`,
      `source-${item.sourceKind}`,
      { selectable: showCheckbox, selected: checked, compact: variant === 'compact' },
    ]"
    role="button"
    :tabindex="0"
    :aria-label="$t('planner.card.openAria') as string"
    @click="onCardClick"
    @keydown.enter.prevent="onCardClick"
    @keydown.space.prevent="onCardClick"
  >
    <div v-if="showCheckbox" class="item-checkbox-wrap" @click.stop>
      <input
        type="checkbox"
        :checked="checked"
        :aria-label="$t('planner.card.selectAria') as string"
        @change="$emit('toggle-select', item.id, ($event.target as HTMLInputElement).checked)"
      />
    </div>

    <div class="item-body">
      <div class="item-row-top">
        <span class="content-type-badge" :class="`ct-${contentTypeKey}`">
          {{ contentTypeLabel }}
        </span>
        <!--
          Spec 62.4-followup Issue 3: friendly label on the badge ("Geplant"
          / "Trend" / "EN-Version"). Audit-detail selection_reason shows on
          hover via q-tooltip (mobile tap-hold also fires it).
        -->
        <span class="source-kind-badge" :class="`sk-${item.sourceKind}`">
          {{ $t(`planner.sourceKind.${item.sourceKind}`) as string }}
          <q-tooltip
            v-if="item.selectionReason"
            anchor="bottom middle"
            self="top middle"
            :delay="200"
          >
            {{ item.selectionReason }}
          </q-tooltip>
        </span>
      </div>

      <!--
        Spec 62.4-followup Issue 4: the title is clamped to 1-2 lines via
        -webkit-line-clamp. q-tooltip surfaces the full title on hover (and
        on mobile tap-hold via Quasar's default touch handling).
      -->
      <p class="item-title">
        {{ title }}
        <q-tooltip
          anchor="bottom middle"
          self="top middle"
          :delay="200"
          max-width="320px"
        >
          {{ title }}
        </q-tooltip>
      </p>

      <div class="item-row-bottom">
        <span class="cost mono">€{{ costDisplay }}</span>
        <span class="item-status-icon" :title="$t(`planner.itemStatus.${item.status}`) as string" aria-hidden="true">
          <span v-if="item.status === 'pending'">⏳</span>
          <span v-else-if="item.status === 'enqueued'">▶</span>
          <span v-else-if="item.status === 'in_progress'">🔄</span>
          <span v-else-if="item.status === 'completed'">✓</span>
          <span v-else-if="item.status === 'failed'">✗</span>
          <span v-else-if="item.status === 'skipped'">⏭</span>
          <span v-else-if="item.status === 'cancelled'">⊘</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { PlannedItem } from "src/types/ui";

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
 * Single planned-item card — shared between Grid and List views.
 * Status, content-type and source-kind drive colour + iconography.
 * Title is derived from `pipelineInput.title` / `pipelineInput.topicTitle`
 * with a sensible fallback to the content type.
 */
export default defineComponent({
  name: "PlannerItemCard",

  emits: ["open", "toggle-select"],

  props: {
    item: { type: Object as PropType<PlannedItem>, required: true },
    showCheckbox: { type: Boolean, default: false },
    checked: { type: Boolean, default: false },
    variant: { type: String as PropType<"default" | "compact">, default: "default" },
  },

  computed: {
    contentTypeKey(): string {
      const raw = (this.item.contentType ?? "").trim().toLowerCase();
      return KNOWN_CONTENT_TYPE_KEYS.has(raw) ? raw : "article";
    },
    contentTypeLabel(): string {
      // Fall back to the raw string when an unknown type lands — better than a blank.
      const raw = this.item.contentType;
      if (KNOWN_CONTENT_TYPE_KEYS.has(this.contentTypeKey)) {
        return this.$t(`planner.contentType.${this.contentTypeKey}`) as string;
      }
      return raw;
    },
    title(): string {
      const input = this.item.pipelineInput;
      if (input && typeof input["title"] === "string") return input["title"];
      if (input && typeof input["topicTitle"] === "string") return input["topicTitle"];
      if (this.item.selectionReason) return this.item.selectionReason;
      return this.contentTypeLabel;
    },
    costDisplay(): string {
      // estimatedCostEur is a numeric string ("0.300000") — keep 2 decimals.
      const parsed = parseFloat(this.item.estimatedCostEur);
      if (!Number.isFinite(parsed)) return "0.00";
      return parsed.toFixed(2);
    },
  },

  methods: {
    onCardClick(): void {
      this.$emit("open", this.item.id);
    },
  },
});
</script>

<style scoped>
.planner-item-card {
  position: relative;
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  text-align: left;
  min-width: 0;
  transition: background 160ms cubic-bezier(0.23, 1, 0.32, 1),
              border-color 160ms cubic-bezier(0.23, 1, 0.32, 1),
              transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
}

@media (hover: hover) and (pointer: fine) {
  .planner-item-card:hover {
    background: var(--bg-glass-strong);
    border-color: var(--border-soft);
  }
}

.planner-item-card:active {
  transform: scale(0.98);
  transition-duration: 160ms;
}

/* selectable + selected states */
.planner-item-card.selected {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary-glow, rgba(124, 92, 255, 0.4));
}

.item-checkbox-wrap {
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}

.item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-row-top,
.item-row-bottom {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.item-row-bottom {
  justify-content: space-between;
}

.content-type-badge,
.source-kind-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid transparent;
  flex-shrink: 0;
}

.content-type-badge {
  background: rgba(124, 92, 255, 0.12);
  color: var(--accent-primary, #7c5cff);
  border-color: rgba(124, 92, 255, 0.25);
}

.ct-comparison {
  background: rgba(255, 158, 80, 0.12);
  color: #ff9e50;
  border-color: rgba(255, 158, 80, 0.25);
}

.ct-ki_wissen {
  background: rgba(0, 212, 255, 0.12);
  color: #00d4ff;
  border-color: rgba(0, 212, 255, 0.25);
}

.ct-social_post {
  background: rgba(255, 77, 109, 0.1);
  color: #ff4d6d;
  border-color: rgba(255, 77, 109, 0.22);
}

.source-kind-badge {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-tertiary);
  border-color: var(--border-subtle);
}

.sk-overage_signal {
  background: rgba(245, 165, 36, 0.12);
  color: #f5a524;
  border-color: rgba(245, 165, 36, 0.3);
}

.sk-sibling_locale {
  background: rgba(132, 132, 255, 0.12);
  color: #8484ff;
  border-color: rgba(132, 132, 255, 0.3);
}

.item-title {
  font-size: 13px;
  line-height: 1.3;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cost {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.item-status-icon {
  font-size: 12px;
  line-height: 1;
}

/* Cancelled state — grey out and strike through */
.planner-item-card.status-cancelled {
  opacity: 0.5;
}

.planner-item-card.status-cancelled .item-title {
  text-decoration: line-through;
}

.planner-item-card.status-completed {
  border-color: rgba(22, 217, 126, 0.3);
}

.planner-item-card.status-failed {
  border-color: rgba(255, 77, 109, 0.3);
}

/* Compact variant — used inside list view for denser layout */
.compact {
  padding: 6px var(--space-2);
}

.compact .item-title {
  font-size: 12px;
  -webkit-line-clamp: 1;
}
</style>
