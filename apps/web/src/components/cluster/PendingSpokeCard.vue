<template>
  <div class="pending-spoke-card" :aria-label="$t('clusters.detail.spokePending') as string">
    <div class="shimmer-line shimmer-line--short" />
    <div class="shimmer-line" />
    <div class="pending-label mono">{{ $t("clusters.detail.spokePending") as string }}</div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "PendingSpokeCard",
});
</script>

<style scoped>
.pending-spoke-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  opacity: 0.6;
}

.shimmer-line {
  height: 10px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--border-subtle) 25%,
    var(--border-medium) 50%,
    var(--border-subtle) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s infinite;
}

.shimmer-line--short {
  width: 40%;
  height: 8px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.pending-label {
  font-size: 9px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 2px;
}
</style>
