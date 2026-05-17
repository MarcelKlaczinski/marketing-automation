<template>
  <div class="cost-tab">
    <LoadingShimmer v-if="isPending" variant="card" :count="3" />
    <EmptyState
      v-else-if="!costs.length"
      :title="$t('articles.costTab.noData') as string"
    />
    <template v-else>
      <div class="total-row">
        <span class="total-label">{{ $t("articles.costTab.totalCost") as string }}</span>
        <span class="total-value mono">€{{ totalCost.toFixed(4) }}</span>
      </div>
      <div class="costs-list">
        <div
          v-for="entry in costs"
          :key="entry.id"
          class="cost-row"
        >
          <div class="cost-op mono">{{ entry.operation }}</div>
          <div class="cost-service mono">{{ entry.service }}</div>
          <div class="cost-amount mono">€{{ parseFloat(entry.costEur ?? "0").toFixed(4) }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "src/lib/api";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import type { RunCostEntry } from "src/types/ui";

export default defineComponent({
  name: "ArticleCostTab",

  components: { LoadingShimmer, EmptyState },

  props: {
    articleId: { type: String, required: true },
  },

  setup(props) {
    const { data, isPending } = useQuery({
      queryKey: ["article-costs", props.articleId],
      queryFn: () =>
        apiGet<{ costs: RunCostEntry[]; totalCostEur: number }>(
          `/articles/${props.articleId}/costs`,
        ),
    });
    return { data, isPending };
  },

  computed: {
    costs(): RunCostEntry[] {
      return (this.data as { costs: RunCostEntry[] } | undefined)?.costs ?? [];
    },
    totalCost(): number {
      const raw = (this.data as { totalCostEur: string | number | null } | undefined)?.totalCostEur;
      return parseFloat(String(raw ?? "0")) || 0;
    },
  },
});
</script>

<style scoped>
.cost-tab {
  padding: 16px;
}

.total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: color-mix(in oklch, var(--accent-primary) 8%, transparent);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
}

.total-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.total-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--accent-primary);
}

.costs-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cost-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.cost-op {
  font-size: 11px;
  color: var(--text-secondary);
  flex: 1;
}

.cost-service {
  font-size: 10px;
  color: var(--text-tertiary);
  min-width: 80px;
}

.cost-amount {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
  min-width: 70px;
}
</style>
