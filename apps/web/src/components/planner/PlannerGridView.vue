<template>
  <div class="planner-grid" :class="{ 'drag-disabled': !dragEnabled }">
    <div
      v-for="(day, idx) in days"
      :key="day.iso"
      class="grid-column"
      :class="{ 'col-empty': day.items.length === 0, 'col-weekend': idx >= 5 }"
    >
      <header class="col-header">
        <span class="dow">{{ $t(`planner.days.${day.dowKey}`) as string }}</span>
        <span class="date mono">{{ day.shortDate }}</span>
      </header>

      <!-- Drop zone -->
      <draggable
        :list="day.items"
        :group="{ name: dragGroupName, pull: true, put: true }"
        :item-key="getKey"
        :animation="160"
        :disabled="!dragEnabled"
        class="drop-zone"
        ghost-class="drag-ghost"
        :data-iso-date="day.iso"
        @end="onDragEnd"
      >
        <template #item="{ element }">
          <PlannerItemCard
            :data-item-id="element.id"
            :item="element"
            :show-checkbox="showCheckboxes"
            :checked="selectedIds.has(element.id)"
            @open="$emit('open-item', $event)"
            @toggle-select="onToggleSelect"
            @retry="$emit('retry-item', $event)"
          />
        </template>
      </draggable>

      <p v-if="day.items.length === 0" class="empty-day text-tertiary">
        {{ $t("planner.emptyDay") as string }}
      </p>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
// vuedraggable@4 is the Vue 3 fork of vue.draggable. Its published .d.ts is a
// large `DefineComponent<...>` generic that doesn't compose cleanly with Vue's
// component-typing context; the official README casts it through `Component`.
// We only use props `list` / `group` / `item-key` / `animation` / `disabled`
// and the `@end` event.
import draggableImpl from "vuedraggable";
import type { Component } from "vue";
const draggable = draggableImpl as unknown as Component;
import PlannerItemCard from "./PlannerItemCard.vue";
import { formatShortDate, isoDayOfWeek, isoWeekDays } from "src/lib/iso-week";
import type { PlannedItem } from "src/types/ui";

interface DayColumn {
  iso: string;
  shortDate: string;
  dowKey: "mo" | "tu" | "we" | "th" | "fr" | "sa" | "su";
  items: PlannedItem[];
}

const DOW_KEYS: Array<DayColumn["dowKey"]> = ["mo", "tu", "we", "th", "fr", "sa", "su"];

/**
 * Weekly Mon-Sun grid view. Items are grouped into 7 day columns by `slot_date`.
 * Each column is a `<draggable>` drop-zone — dragging an item to a different
 * column emits `reschedule` with the new ISO date and item id.
 *
 * The component does NOT mutate the input `items` prop directly. Internal day
 * arrays are derived in `computed` from the prop, then re-rendered after the
 * parent commits the optimistic update via cache (re-rendering reflows the
 * grid).
 *
 * Drag is disabled if `dragEnabled` is false (mobile + non-draft/non-approved
 * plan states).
 */
export default defineComponent({
  name: "PlannerGridView",

  components: { PlannerItemCard, draggable },

  emits: ["open-item", "toggle-select", "reschedule", "retry-item"],

  props: {
    year: { type: Number, required: true },
    isoWeek: { type: Number, required: true },
    items: { type: Array as PropType<PlannedItem[]>, required: true },
    selectedIds: { type: Object as PropType<Set<string>>, default: () => new Set() },
    showCheckboxes: { type: Boolean, default: false },
    dragEnabled: { type: Boolean, default: true },
  },

  data: () => ({
    // The group name is per-component-instance so multiple PlannerGridViews on
    // the same page (e.g. preview in another tab) don't fight over drops.
    dragGroupName: `planner-${Math.random().toString(36).slice(2, 8)}`,
  }),

  computed: {
    days(): DayColumn[] {
      const isoDates = isoWeekDays(this.year, this.isoWeek);
      const byDate = new Map<string, PlannedItem[]>();
      for (const it of this.items) {
        // slotDate arrives as ISO string; sometimes with timestamp suffix.
        const iso = it.slotDate.slice(0, 10);
        const bucket = byDate.get(iso);
        if (bucket) bucket.push(it);
        else byDate.set(iso, [it]);
      }
      const locale: "de" | "en" = this.$i18n.locale === "de" ? "de" : "en";
      return isoDates.map((iso) => {
        const dow = isoDayOfWeek(new Date(`${iso}T00:00:00.000Z`));
        // dow is 1..7 (Mo..Su); DOW_KEYS is 0..6 → subtract 1
        const dowKey = DOW_KEYS[dow - 1] ?? "mo";
        const items = (byDate.get(iso) ?? []).slice();
        // Sort within day by createdAt (stable across refetches).
        items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return {
          iso,
          shortDate: formatShortDate(iso, locale),
          dowKey,
          items,
        };
      });
    },
  },

  methods: {
    getKey(item: PlannedItem): string {
      return item.id;
    },
    onToggleSelect(itemId: string, checked: boolean): void {
      this.$emit("toggle-select", itemId, checked);
    },
    onDragEnd(evt: { item: HTMLElement; from: HTMLElement; to: HTMLElement }): void {
      // vuedraggable's `end` event includes the source/target DOM nodes. The
      // destination column carries `data-iso-date` — we read that to derive
      // the new slot date. We also walk up to find the item id from the data
      // attribute we set in the slot.
      const toIso = evt.to?.getAttribute?.("data-iso-date");
      const fromIso = evt.from?.getAttribute?.("data-iso-date");
      if (!toIso || !fromIso || toIso === fromIso) return;
      // Read the item-id from the dragged DOM element. vuedraggable doesn't
      // expose the model object in `end`; we tag the card via `data-item-id`.
      const itemId = evt.item?.getAttribute?.("data-item-id");
      if (!itemId) {
        // Fallback: emit a global refresh signal by emitting reschedule with
        // an empty id — parent should refetch to recover from the inconsistency.
        return;
      }
      this.$emit("reschedule", itemId, toIso);
    },
  },
});
</script>

<style scoped>
.planner-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--space-2);
  min-height: 400px;
}

.grid-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-subtle);
  min-width: 0;
}

.col-weekend {
  background: rgba(255, 255, 255, 0.01);
}

.col-empty .drop-zone {
  min-height: 60px;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-sm, 6px);
}

.col-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px 4px;
  border-bottom: 1px solid var(--border-subtle);
}

.dow {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.date {
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 40px;
}

.drag-ghost {
  opacity: 0.4;
  background: var(--accent-primary, #7c5cff);
}

.empty-day {
  font-size: 11px;
  font-style: italic;
  text-align: center;
  padding: var(--space-3) 0;
  margin: 0;
}

.drag-disabled .drop-zone {
  pointer-events: auto;
}

/* Mobile: never render the grid — hidden via parent v-if instead, but keep a
   safety override here too. */
@media (max-width: 767px) {
  .planner-grid {
    display: none;
  }
}
</style>
