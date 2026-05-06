<template>
  <div class="cold-start">
    <p class="text-body2 q-mb-lg">{{ $t('coldStart.intro') }}</p>

    <PhaseSection
      :index="1"
      :title="$t('coldStart.phase1.title')"
      :description="$t('coldStart.phase1.description')"
      :status="voiceStatus"
      :unlocked="true"
    >
      <Phase1VoiceRefinement :slug="slug" @done="onPhaseDone" />
    </PhaseSection>

    <PhaseSection
      :index="2"
      :title="$t('coldStart.phase2.title')"
      :description="$t('coldStart.phase2.description')"
      :status="competitorStatus"
      :unlocked="voiceStatus === 'complete'"
    >
      <Phase2CompetitorAnalysis :slug="slug" @done="onPhaseDone" />
    </PhaseSection>

    <PhaseSection
      :index="3"
      :title="$t('coldStart.phase3.title')"
      :description="$t('coldStart.phase3.description')"
      :status="clusterStatus"
      :unlocked="competitorStatus === 'complete'"
    >
      <Phase3ClusterPlan :slug="slug" @done="onPhaseDone" />
    </PhaseSection>

    <PhaseSection
      :index="4"
      :title="$t('coldStart.phase4.title')"
      :description="$t('coldStart.phase4.description')"
      :status="cornerstoneStatus"
      :unlocked="clusterStatus === 'complete'"
    >
      <Phase4Cornerstones :slug="slug" @done="onPhaseDone" />
    </PhaseSection>

    <PhaseSection
      :index="5"
      :title="$t('coldStart.phase5.title')"
      :description="$t('coldStart.phase5.description')"
      :status="goLiveStatus"
      :unlocked="cornerstoneStatus === 'complete'"
    >
      <Phase5GoLive :slug="slug" @done="onPhaseDone" />
    </PhaseSection>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useColdStartStore } from 'src/stores/cold-start';
import PhaseSection from 'src/components/cold-start/PhaseSection.vue';
import Phase1VoiceRefinement from 'src/components/cold-start/Phase1VoiceRefinement.vue';
import Phase2CompetitorAnalysis from 'src/components/cold-start/Phase2CompetitorAnalysis.vue';
import Phase3ClusterPlan from 'src/components/cold-start/Phase3ClusterPlan.vue';
import Phase4Cornerstones from 'src/components/cold-start/Phase4Cornerstones.vue';
import Phase5GoLive from 'src/components/cold-start/Phase5GoLive.vue';

export default defineComponent({
  name: 'ColdStartPanel',

  components: {
    PhaseSection,
    Phase1VoiceRefinement,
    Phase2CompetitorAnalysis,
    Phase3ClusterPlan,
    Phase4Cornerstones,
    Phase5GoLive,
  },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { coldStartStore: useColdStartStore() };
  },

  computed: {
    status() {
      return this.coldStartStore.statusByProject[this.slug];
    },
    voiceStatus() { return this.status?.voice.status ?? 'pending'; },
    competitorStatus() { return this.status?.competitors.status ?? 'pending'; },
    clusterStatus() { return this.status?.clusters.status ?? 'pending'; },
    cornerstoneStatus() { return this.status?.cornerstones.status ?? 'pending'; },
    goLiveStatus() { return this.status?.goLive.status ?? 'pending'; },
  },

  async created() {
    await this.coldStartStore.fetchStatus(this.slug);
  },

  methods: {
    async onPhaseDone(): Promise<void> {
      await this.coldStartStore.fetchStatus(this.slug);
    },
  },
});
</script>
