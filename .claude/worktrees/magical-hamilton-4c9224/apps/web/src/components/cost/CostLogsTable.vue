<template>
  <div class="logs-card">
    <div class="logs-card__filters">
      <q-select
        v-model="localFilters.service"
        outlined
        dense
        :options="serviceOptions"
        emit-value
        map-options
        :label="$t('cost.filters.service')"
        clearable
        style="min-width: 160px;"
        @update:model-value="onFilterChange"
      />
      <q-input
        v-model="localFilters.operation"
        outlined
        dense
        :label="$t('cost.filters.operation')"
        :placeholder="$t('cost.filters.operationPlaceholder') as string"
        debounce="400"
        clearable
        style="min-width: 200px;"
        @update:model-value="onFilterChange"
      />
    </div>

    <table v-if="costStore.logs && costStore.logs.logs.length > 0" class="logs-table">
      <thead>
        <tr>
          <th>{{ $t('cost.table.date') }}</th>
          <th>{{ $t('cost.table.project') }}</th>
          <th>{{ $t('cost.table.service') }}</th>
          <th>{{ $t('cost.table.operation') }}</th>
          <th class="num">{{ $t('cost.table.totalEur') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in costStore.logs.logs" :key="log.id">
          <td class="date-cell">{{ formatDateTime(log.createdAt) }}</td>
          <td>{{ log.projectName ?? '—' }}</td>
          <td>
            <span :class="`service-pill service-pill--${log.service}`">{{ log.service }}</span>
          </td>
          <td class="op-cell">{{ log.operation }}</td>
          <td class="num">€ {{ formatEur(log.costEur) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-else-if="costStore.logs" class="logs-card__empty">
      {{ $t('cost.table.noResults') }}
    </div>

    <div v-if="costStore.logs && costStore.logs.total > limit" class="logs-card__pagination">
      <q-btn
        flat
        dense
        icon="chevron_left"
        :disable="offset === 0"
        :aria-label="$t('common.prev')"
        @click="changePage(offset - limit)"
      />
      <span class="page-info">
        {{ offset + 1 }}–{{ Math.min(offset + limit, costStore.logs.total) }}
        {{ $t('cost.table.of') }}
        {{ costStore.logs.total }}
      </span>
      <q-btn
        flat
        dense
        icon="chevron_right"
        :disable="offset + limit >= costStore.logs.total"
        :aria-label="$t('common.next')"
        @click="changePage(offset + limit)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { formatEur } from "src/lib/format-eur";
import { useCostStore } from "src/stores/cost";
import { defineComponent } from "vue";

export default defineComponent({
  name: "CostLogsTable",

  setup() {
    return { costStore: useCostStore() };
  },

  data: () => ({
    limit: 50,
    offset: 0,
    localFilters: {
      service: null as string | null,
      operation: "",
    },
  }),

  computed: {
    serviceOptions() {
      return [
        { label: this.$t("cost.services.anthropic") as string, value: "anthropic" },
        { label: this.$t("cost.services.replicate") as string, value: "replicate" },
        { label: this.$t("cost.services.dataforseo") as string, value: "dataforseo" },
        { label: this.$t("cost.services.smtp") as string, value: "smtp" },
      ];
    },
  },

  methods: {
    formatEur,

    formatDateTime(iso: string): string {
      const d = new Date(iso);
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return d.toLocaleString(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    },

    async onFilterChange(): Promise<void> {
      this.costStore.setFilters(this.localFilters);
      this.offset = 0;
      await this.costStore.fetchLogs(this.limit, 0);
    },

    async changePage(newOffset: number): Promise<void> {
      this.offset = newOffset;
      await this.costStore.fetchLogs(this.limit, newOffset);
    },
  },
});
</script>

<style lang="scss" scoped>
.logs-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);
  overflow: hidden;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.logs-card__filters {
  display: flex;
  gap: 12px;
  padding: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    padding: 10px 16px;
    border-bottom: 1px solid var(--q-grey-2, #f0f0f0);
    text-align: left;

    body.body--dark & {
      border-bottom-color: rgba(255, 255, 255, 0.06);
    }
  }

  th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
    background: var(--q-grey-1, #fafafa);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.03);
    }
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .op-cell {
    font-family: monospace;
    font-size: 12px;
  }

  .date-cell {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
}

.service-pill {
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;

  &--anthropic  { background: rgba(63, 81, 181, 0.12); color: #3f51b5; }
  &--replicate  { background: rgba(124, 77, 255, 0.12); color: #7c4dff; }
  &--dataforseo { background: rgba(38, 166, 154, 0.12); color: #26a69a; }
  &--smtp       { background: rgba(242, 192, 55, 0.18); color: #b07b00; }
}

.logs-card__empty {
  text-align: center;
  padding: 40px 0;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}

.logs-card__pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--q-grey-2, #f0f0f0);
  gap: 12px;

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}

.page-info {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-variant-numeric: tabular-nums;
}
</style>
