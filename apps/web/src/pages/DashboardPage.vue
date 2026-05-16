<template>
  <div class="dashboard-page">
    <!-- Session 1: blank canvas. Full implementation in Sessions 5-6. -->
    <div class="dashboard-placeholder">
      <p class="label-caps text-tertiary">Pipeline Dashboard</p>
      <p class="text-dim text-sm" style="margin-top: 8px;">
        Sessions 5–6 will render stats, lanes, clusters, and detail pane here.
      </p>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

/**
 * Dashboard page — root view for pipeline orchestration.
 * Spec 56.1 Session 1: blank canvas placeholder.
 * Full layout (stats, kanban lanes, clusters, detail pane) added in Sessions 5–6.
 */
export default defineComponent({
  name: "DashboardPage",
});
</script>

<style scoped>
.dashboard-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dashboard-placeholder {
  text-align: center;
}
</style>
