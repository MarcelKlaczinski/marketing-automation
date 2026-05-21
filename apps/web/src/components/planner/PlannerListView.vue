<template>
  <div class="planner-list">
    <section v-for="day in days" :key="day.iso" class="day-group">
      <header class="day-header">
        <span class="dow">{{ $t(`planner.days.${day.dowKey}`) as string }}</span>
        <span class="date mono">{{ day.shortDate }}</span>
        <span class="day-count text-tertiary">·  {{ day.items.length }}</span>
      </header>

      <p v-if="day.items.length === 0" class="empty-day text-tertiary">
        {{ $t("planner.emptyDay") as string }}
      </p>

      <ul v-else class="day-items">
        <li v-for="item in day.items" :key="item.id">
          <PlannerItemCard
            variant="compact"
            :item="item"
            :show-checkbox="showCheckboxes"
            :checked="selectedIds.has(item.id)"
            @open="$emit('open-item', $event)"
            @toggle-select="onToggleSelect"
          />
        </li>
      </ul>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import PlannerItemCard from "./PlannerItemCard.vue";
import { formatShortDate, isoDayOfWeek, isoWeekDays } from "src/lib/iso-week";
import type { PlannedItem } from "src/types/ui";

interface DayGroup {
  iso: string;
  shortDate: string;
  dowKey: "mo" | "tu" | "we" | "th" | "fr" | "sa" | "su";
  items: PlannedItem[];
}

const DOW_KEYS: Array<DayGroup["dowKey"]> = ["mo", "tu", "we", "th", "fr", "sa", "su"];

/**
 * Compact list view grouped by day. No drag&drop — Mobile gets this view by
 * default and reschedules happen via the item-detail page's date picker.
 */
export default defineComponent({
  name: "PlannerListView",

  components: { PlannerItemCard },

  emits: ["open-item", "toggle-select"],

  props: {
    year: { type: Number, required: true },
    isoWeek: { type: Number, required: true },
    items: { type: Array as PropType<PlannedItem[]>, required: true },
    selectedIds: { type: Object as PropType<Set<string>>, default: () => new Set() },
    showCheckboxes: { type: Boolean, default: false },
  },

  computed: {
    days(): DayGroup[] {
      const isoDates = isoWeekDays(this.year, this.isoWeek);
      const byDate = new Map<string, PlannedItem[]>();
      for (const it of this.items) {
        const iso = it.slotDate.slice(0, 10);
        const bucket = byDate.get(iso);
        if (bucket) bucket.push(it);
        else byDate.set(iso, [it]);
      }
      const locale: "de" | "en" = this.$i18n.locale === "de" ? "de" : "en";
      return isoDates.map((iso) => {
        const dow = isoDayOfWeek(new Date(`${iso}T00:00:00.000Z`));
        const dowKey = DOW_KEYS[dow - 1] ?? "mo";
        const items = (byDate.get(iso) ?? []).slice();
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
    onToggleSelect(itemId: string, checked: boolean): void {
      this.$emit("toggle-select", itemId, checked);
    },
  },
});
</script>

<style scoped>
.planner-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.day-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.day-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: 0 var(--space-2) 4px;
  border-bottom: 1px solid var(--border-subtle);
}

.dow {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.date {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.day-count {
  font-size: 11px;
}

.day-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty-day {
  font-size: 11px;
  font-style: italic;
  margin: 0;
  padding: 0 var(--space-2);
}
</style>
