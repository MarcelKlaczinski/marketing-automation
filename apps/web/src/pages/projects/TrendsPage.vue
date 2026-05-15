<template>
  <q-page class="q-pa-md">
    <!-- Header row: title + synthesis trigger -->
    <div class="row items-start q-mb-md q-gutter-md">
      <div class="col">
        <div class="text-h5">{{ $t('trends.title') }}</div>
        <div class="text-caption text-grey-6">{{ $t('trends.subtitle', { threshold: 25 }) }}</div>
      </div>
      <div class="col-auto">
        <SynthesisTriggerCard
          :project-slug="slug"
          @synthesis-complete="onSynthesisComplete"
        />
      </div>
    </div>

    <q-tabs
      v-model="activeTab"
      dense
      align="left"
      narrow-indicator
      class="q-mb-md"
    >
      <q-tab name="pending" :label="$t('trends.tabs.pending')" />
      <q-tab name="rejected" :label="$t('trends.tabs.rejected')" />
      <q-tab name="signals" :label="$t('trends.tabs.signals')" />
    </q-tabs>

    <q-tab-panels v-model="activeTab" animated keep-alive>
      <!-- Pending briefs: master/detail -->
      <q-tab-panel name="pending" class="q-pa-none">
        <div class="row q-col-gutter-md">
          <div class="col-12 col-md-5">
            <TrendBriefList
              :project-slug="slug"
              :selected-id="selectedBrief?.id ?? ''"
              :refresh-key="refreshKey"
              @select="onSelectBrief"
            />
          </div>
          <div class="col-12 col-md-7">
            <TrendBriefDetail
              v-if="selectedBrief"
              :brief="selectedBrief"
              :project-slug="slug"
              @approved="onBriefApproved"
              @dismissed="onBriefDismissed"
              @edited="onBriefEdited"
            />
            <q-card v-else flat bordered class="flex flex-center q-pa-xl text-grey-5">
              <div class="text-center">
                <q-icon name="trending_up" size="48px" class="q-mb-sm" />
                <div>{{ $t('trends.selectBriefHint') }}</div>
              </div>
            </q-card>
          </div>
        </div>
      </q-tab-panel>

      <!-- Rejected topics -->
      <q-tab-panel name="rejected" class="q-pa-none">
        <RejectedTopicsBrowser :project-slug="slug" />
      </q-tab-panel>

      <!-- Signal pool -->
      <q-tab-panel name="signals" class="q-pa-none">
        <SignalPoolInspector :project-slug="slug" />
      </q-tab-panel>
    </q-tab-panels>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import TrendBriefList, { type TrendBriefRow } from "src/components/trends/TrendBriefList.vue";
import TrendBriefDetail, { type TrendBriefDetailData } from "src/components/trends/TrendBriefDetail.vue";
import RejectedTopicsBrowser from "src/components/trends/RejectedTopicsBrowser.vue";
import SignalPoolInspector from "src/components/trends/SignalPoolInspector.vue";
import SynthesisTriggerCard from "src/components/trends/SynthesisTriggerCard.vue";

export default defineComponent({
  name: "TrendsPage",

  components: { TrendBriefList, TrendBriefDetail, RejectedTopicsBrowser, SignalPoolInspector, SynthesisTriggerCard },

  props: {
    slug: { type: String, required: true },
  },

  data: () => ({
    activeTab: "pending" as string,
    selectedBrief: null as TrendBriefDetailData | null,
    refreshKey: 0,
  }),

  watch: {
    activeTab(tab: string) {
      void this.$router.replace({ query: { tab } });
    },
    "$route.query.tab": {
      immediate: true,
      handler(val: unknown) {
        const tab = typeof val === "string" ? val : "pending";
        if (["pending", "rejected", "signals"].includes(tab)) {
          this.activeTab = tab;
        }
      },
    },
  },

  methods: {
    onSelectBrief(brief: TrendBriefRow): void {
      // TrendBriefRow is a structural superset of TrendBriefDetailData (same fields, separate declarations)
      this.selectedBrief = brief as TrendBriefDetailData;
    },

    onBriefApproved(): void {
      this.selectedBrief = null;
      this.refreshKey++;
    },

    onBriefDismissed(): void {
      this.selectedBrief = null;
      this.refreshKey++;
    },

    onBriefEdited(): void {
      this.refreshKey++;
    },

    onSynthesisComplete(): void {
      this.refreshKey++;
    },
  },
});
</script>
