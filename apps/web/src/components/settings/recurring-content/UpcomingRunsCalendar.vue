<template>
  <div class="upcoming-calendar">
    <div class="calendar-nav">
      <q-btn flat dense round icon="chevron_left" :aria-label="$t('common.back') as string" @click="prevMonth" />
      <span class="calendar-title">{{ monthLabel }}</span>
      <q-btn flat dense round icon="chevron_right" :aria-label="$t('common.next') as string" @click="nextMonth" />
      <div class="calendar-spacer" />
      <q-btn
        flat
        dense
        :label="$t('common.today') as string"
        @click="goToday"
      />
    </div>

    <QCalendarMonth
      ref="calendar"
      v-model="currentDate"
      :now="todayStr"
      :short-weekday-label="false"
      :weekday-format="weekdayFormat"
      :focus-type="['day']"
      animated
      bordered
      no-active-date
      enable-outside-days
      day-height="0"
      day-min-height="78"
      class="calendar"
    >
      <template #day="{ scope }">
        <div class="day-cell">
          <span :class="{ 'today-marker': isToday(scope.timestamp.date) }">
            {{ scope.timestamp.day }}
          </span>
          <div v-if="runsForDate(scope.timestamp.date).length > 0" class="day-chips">
            <span
              v-for="(_run, i) in runsForDate(scope.timestamp.date)"
              :key="`${scope.timestamp.date}-${i}`"
              class="run-chip mono"
              :title="formatRunTime(runsForDate(scope.timestamp.date)[i])"
            >
              {{ formatRunTime(runsForDate(scope.timestamp.date)[i]) }}
            </span>
          </div>
        </div>
      </template>
    </QCalendarMonth>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import QCalendarMonth from "@quasar/quasar-ui-qcalendar/QCalendarMonth";
import "@quasar/quasar-ui-qcalendar/QCalendar.css";

/**
 * Per-definition upcoming-runs calendar (Spec 65.V1.5c).
 *
 * Replaces the 4-row list in `SettingsRecurringDefinitionDetailPage`'s
 * Upcoming tab with a q-calendar-month view. Takes the `upcoming` array
 * of ISO timestamps as input (already computed server-side via the
 * `/upcoming?count=N` endpoint) and renders chips per day that has at
 * least one run.
 *
 * Marcel may navigate months back/forward; the chips disappear/reappear
 * naturally since `upcoming` is just the upcoming ISO strings. The
 * "Today" button jumps back to the current month.
 */
function isoDate(d: Date): string {
  // q-calendar expects YYYY-MM-DD format.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export default defineComponent({
  name: "UpcomingRunsCalendar",

  // biome-ignore lint/style/useNamingConvention: q-calendar exports PascalCase named component
  components: { QCalendarMonth },

  props: {
    /** ISO timestamps (e.g. `"2026-06-03T09:00:00.000Z"`) — already sorted ascending. */
    runs: { type: Array as PropType<string[]>, default: () => [] },
  },

  data: () => ({
    currentDate: isoDate(new Date()),
    todayStr: isoDate(new Date()),
  }),

  computed: {
    monthLabel(): string {
      const [yearStr, monthStr] = this.currentDate.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr) - 1;
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return new Date(Date.UTC(year, month, 1)).toLocaleDateString(locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    },

    /**
     * Map YYYY-MM-DD → ISO timestamps for fast per-day lookup in the slot.
     * The slot is called once per day cell during render, so memoising
     * here avoids a linear scan over `runs` for every visible day.
     */
    runsByDate(): Record<string, string[]> {
      const map: Record<string, string[]> = {};
      for (const iso of this.runs) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) continue;
        const key = isoDate(d);
        if (!map[key]) map[key] = [];
        map[key].push(iso);
      }
      return map;
    },
  },

  methods: {
    weekdayFormat(_locale: string, date: { weekday: number }): string {
      // q-calendar's built-in `short-weekday-label` uses 3 chars; we
      // override here to use 2-char DE/EN per app convention.
      const codes =
        this.$i18n.locale === "de"
          ? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
          : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return codes[date.weekday] ?? "";
    },

    runsForDate(dateKey: string): string[] {
      return this.runsByDate[dateKey] ?? [];
    },

    formatRunTime(iso: string | undefined): string {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return d.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
    },

    isToday(dateKey: string): boolean {
      return dateKey === this.todayStr;
    },

    prevMonth(): void {
      const [yearStr, monthStr] = this.currentDate.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr) - 1;
      const prev = new Date(Date.UTC(year, month - 1, 1));
      this.currentDate = isoDate(prev);
    },

    nextMonth(): void {
      const [yearStr, monthStr] = this.currentDate.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr) - 1;
      const next = new Date(Date.UTC(year, month + 1, 1));
      this.currentDate = isoDate(next);
    },

    goToday(): void {
      this.currentDate = this.todayStr;
    },
  },
});
</script>

<style scoped>
.upcoming-calendar {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.calendar-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.calendar-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  min-width: 160px;
  text-align: center;
}

.calendar-spacer {
  flex: 1;
}

.calendar {
  background: var(--surface-strong);
  border-radius: 10px;
  overflow: hidden;
}

.day-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  padding: 4px 6px;
  font-size: 13px;
}

.today-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--brand-primary);
  color: var(--brand-primary-contrast, #fff);
  font-weight: 600;
  font-size: 12px;
}

.day-chips {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 2px;
}

.run-chip {
  display: inline-block;
  background: color-mix(in oklch, var(--brand-primary) 18%, transparent);
  color: var(--brand-primary);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  font-family: ui-monospace, "JetBrains Mono", "Menlo", monospace;
  white-space: nowrap;
}
</style>
