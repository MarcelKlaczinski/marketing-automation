<template>
  <div class="op-table-card">
    <div class="op-table-card__title">{{ $t('cost.charts.byOperation') }}</div>

    <table v-if="rows.length > 0" class="op-table">
      <thead>
        <tr>
          <th>{{ $t('cost.table.service') }}</th>
          <th>{{ $t('cost.table.operation') }}</th>
          <th class="num">{{ $t('cost.table.callCount') }}</th>
          <th class="num">{{ $t('cost.table.totalEur') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, idx) in rows" :key="`${row.service}-${row.operation}-${idx}`">
          <td>
            <span :class="`service-pill service-pill--${row.service}`">{{ row.service }}</span>
          </td>
          <td class="op-cell">{{ row.operation }}</td>
          <td class="num">{{ row.callCount ?? 0 }}</td>
          <td class="num">€ {{ formatEur(row.totalEur) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-else class="op-table-card__empty">{{ $t('cost.charts.noData') }}</div>
  </div>
</template>

<script lang="ts">
import { formatEur } from "src/lib/format-eur";
import type { CostAggregations } from "src/stores/cost";
import { type PropType, defineComponent } from "vue";

export default defineComponent({
  name: "CostByOperationTable",

  props: {
    aggregations: { type: Object as PropType<CostAggregations | null>, default: null },
  },

  computed: {
    rows() {
      return this.aggregations?.thisMonth.byServiceAndOperation ?? [];
    },
  },

  methods: {
    formatEur,
  },
});
</script>

<style lang="scss" scoped>
.op-table-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.op-table-card__title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.op-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

    body.body--dark & {
      border-bottom-color: rgba(255, 255, 255, 0.06);
    }
  }

  th {
    font-weight: 600;
    color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
    background: var(--q-grey-1, #fafafa);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;

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
}

.service-pill {
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.04em;

  &--anthropic  { background: rgba(63, 81, 181, 0.12); color: #3f51b5; }
  &--replicate  { background: rgba(124, 77, 255, 0.12); color: #7c4dff; }
  &--dataforseo { background: rgba(38, 166, 154, 0.12); color: #26a69a; }
  &--smtp       { background: rgba(242, 192, 55, 0.18); color: #b07b00; }
}

.op-table-card__empty {
  text-align: center;
  padding: 40px 0;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}
</style>
