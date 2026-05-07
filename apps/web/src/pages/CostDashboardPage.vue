<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('cost.title') }}</h1>
      </div>
      <div class="col-auto">
        <q-select
          v-model="selectedProjectId"
          outlined
          dense
          :options="projectOptions"
          emit-value
          map-options
          :label="$t('cost.filters.project')"
          style="min-width: 220px;"
          @update:model-value="onProjectChange"
        />
      </div>
    </div>

    <CostAlertsBanner
      v-if="costStore.alerts.length > 0"
      :alerts="costStore.alerts"
      @acknowledge="onAcknowledge"
    />

    <CostSummaryCards :aggregations="costStore.aggregations" :loading="costStore.loading" />
    <CostByServiceChart :aggregations="costStore.aggregations" class="q-mt-lg" />
    <CostDailyChart :aggregations="costStore.aggregations" class="q-mt-lg" />
    <CostByOperationTable :aggregations="costStore.aggregations" class="q-mt-lg" />

    <h2 class="text-h6 q-mt-xl q-mb-md">{{ $t('cost.detailLogs') }}</h2>
    <CostLogsTable />
  </q-page>
</template>

<script lang="ts">
import CostAlertsBanner from "src/components/cost/CostAlertsBanner.vue";
import CostByOperationTable from "src/components/cost/CostByOperationTable.vue";
import CostByServiceChart from "src/components/cost/CostByServiceChart.vue";
import CostDailyChart from "src/components/cost/CostDailyChart.vue";
import CostLogsTable from "src/components/cost/CostLogsTable.vue";
import CostSummaryCards from "src/components/cost/CostSummaryCards.vue";
import { useCostStore } from "src/stores/cost";
import { useProjectsStore } from "src/stores/projects";
import { defineComponent } from "vue";

export default defineComponent({
  name: "CostDashboardPage",

  components: {
    CostSummaryCards,
    CostByServiceChart,
    CostDailyChart,
    CostByOperationTable,
    CostLogsTable,
    CostAlertsBanner,
  },

  setup() {
    return {
      costStore: useCostStore(),
      projectsStore: useProjectsStore(),
    };
  },

  data: () => ({
    selectedProjectId: null as string | null,
  }),

  computed: {
    projectOptions() {
      const opts = this.projectsStore.list.map((p) => ({
        label: p.name,
        value: p.id,
      }));
      return [{ label: this.$t("cost.filters.allProjects") as string, value: null }, ...opts];
    },
  },

  async created() {
    if (this.projectsStore.list.length === 0) {
      await this.projectsStore.fetchList();
    }
    await Promise.all([
      this.costStore.fetchAggregations(),
      this.costStore.fetchLogs(),
      this.costStore.fetchAlerts(),
    ]);
  },

  methods: {
    async onProjectChange(): Promise<void> {
      this.costStore.setFilters({ projectId: this.selectedProjectId });
      await Promise.all([
        this.costStore.fetchAggregations(),
        this.costStore.fetchLogs(),
        this.costStore.fetchAlerts(),
      ]);
    },

    async onAcknowledge(id: string): Promise<void> {
      await this.costStore.acknowledgeAlert(id);
    },
  },
});
</script>
