<template>
  <div class="ph-config-info glass-card-subtle">
    <p class="ph-config-text">{{ $t("settings.signalSources.sources.producthunt.noFurtherConfig") as string }}</p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "ProductHuntConfigEditor",
});
</script>

<style scoped>
.ph-config-info {
  padding: 12px 16px;
  border-radius: 8px;
}

.ph-config-text {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}
</style>
