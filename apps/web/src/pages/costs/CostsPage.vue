<template>
  <div class="costs-page">
    <h1 class="page-title">{{ $t("cost.title") }}</h1>
    <p class="page-coming-soon">{{ $t("common.comingSoon") }}</p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "CostsPage",
});
</script>

<style scoped>
.costs-page {
  padding: 24px 32px;
  overflow-y: auto;
  height: 100%;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.page-coming-soon {
  font-size: 13px;
  color: var(--text-tertiary);
}
</style>
