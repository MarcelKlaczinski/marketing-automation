<template>
  <section class="cluster-gaps-section">
    <header class="section-header">
      <div class="section-info">
        <h2 class="section-title">{{ $t("clusters.gaps.title") as string }}</h2>
        <p class="section-desc">{{ $t("clusters.gaps.description") as string }}</p>
      </div>
      <GlassButton
        variant="primary"
        size="sm"
        :loading="detecting"
        @click="onDetect"
      >
        {{ gaps.length ? $t("clusters.gaps.redetect") as string : $t("clusters.gaps.detect") as string }}
      </GlassButton>
    </header>

    <LoadingShimmer v-if="isLoading" variant="card" :count="3" />

    <EmptyState
      v-else-if="!gaps.length && !detecting"
      :title="$t('clusters.gaps.empty.title') as string"
      :description="$t('clusters.gaps.empty.description') as string"
    />

    <div v-else class="gaps-grid">
      <ContentGapCard
        v-for="gap in gaps"
        :key="gap.id"
        :gap="gap"
        :auto-approve-enabled="autoApproveGaps"
        :suggesting="suggesting === gap.id"
        :generating="generating === gap.id"
        @suggest="onSuggest(gap.id)"
        @generate="onGenerate(gap.id)"
        @dismiss="onDismiss(gap.id)"
      />
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useClusterGaps } from "src/composables/useClusterGaps";
import GlassButton from "src/components/ui/GlassButton.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import ContentGapCard from "./ContentGapCard.vue";

export default defineComponent({
  name: "ClusterGapsSection",

  components: { GlassButton, EmptyState, LoadingShimmer, ContentGapCard },

  props: {
    clusterId: { type: String, required: true },
    autoApproveGaps: { type: Boolean, default: false },
  },

  setup(props) {
    return useClusterGaps(props.clusterId);
  },

  methods: {
    async onDetect(): Promise<void> {
      await this.detectGaps();
    },
    async onSuggest(gapId: string): Promise<void> {
      await this.suggestGap(gapId);
    },
    async onGenerate(gapId: string): Promise<void> {
      await this.generateGap(gapId);
    },
    async onDismiss(gapId: string): Promise<void> {
      await this.dismissGap(gapId);
    },
  },
});
</script>

<style scoped>
.cluster-gaps-section {
  /* Placed by caller (ClusterDetailPage) */
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.section-info {
  flex: 1;
  min-width: 0;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 3px;
}

.section-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.gaps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

@media (max-width: 767px) {
  .gaps-grid {
    grid-template-columns: 1fr;
  }
}
</style>
