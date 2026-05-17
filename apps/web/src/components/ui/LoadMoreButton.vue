<template>
  <div v-if="hasMore || loading" class="load-more-wrap">
    <GlassButton variant="secondary" :loading="loading" @click="$emit('load-more')">
      {{ $t("common.loadMore") }}
    </GlassButton>
    <span v-if="totalLoaded" class="load-more-meta mono">
      {{ totalLoaded }} {{ $t("common.loaded") }}
    </span>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlassButton from "./GlassButton.vue";

export default defineComponent({
  name: "LoadMoreButton",

  components: { GlassButton },

  emits: ["load-more"],

  props: {
    hasMore: { type: Boolean, required: true },
    loading: { type: Boolean, default: false },
    totalLoaded: { type: Number, default: 0 },
  },
});
</script>

<style scoped>
.load-more-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 16px;
}

.load-more-meta {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
