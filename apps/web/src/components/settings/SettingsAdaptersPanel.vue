<template>
  <div>
    <p class="text-body2 q-mb-lg">{{ $t('settings.adapters.intro') }}</p>

    <div class="adapter-grid">
      <SettingsAdapterCard
        v-for="adapter in adapterList"
        :key="adapter.service"
        :service="adapter.service"
        :icon="adapter.icon"
        :title="$t(`installer.steps.${adapter.stepKey}.title`) as string"
        :description="$t(`installer.steps.${adapter.stepKey}.description`) as string"
        :status="systemStatusStore.adapters[adapter.statusKey]"
        :step-component="adapter.component"
        @configured="onAdapterChanged"
        @disconnected="onAdapterChanged"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { useSystemStatusStore } from "src/stores/system-status";
import { defineAsyncComponent, defineComponent } from "vue";
import SettingsAdapterCard from "./SettingsAdapterCard.vue";

const adapterList = [
  {
    service: "smtp",
    statusKey: "smtp" as const,
    stepKey: "smtp",
    icon: "mail",
    component: defineAsyncComponent(() => import("src/components/installer/StepSmtp.vue")),
  },
  {
    service: "anthropic",
    statusKey: "anthropic" as const,
    stepKey: "anthropic",
    icon: "psychology",
    component: defineAsyncComponent(() => import("src/components/installer/StepAnthropic.vue")),
  },
  {
    service: "replicate",
    statusKey: "replicate" as const,
    stepKey: "replicate",
    icon: "image",
    component: defineAsyncComponent(() => import("src/components/installer/StepReplicate.vue")),
  },
  {
    service: "r2",
    statusKey: "r2" as const,
    stepKey: "r2",
    icon: "cloud",
    component: defineAsyncComponent(() => import("src/components/installer/StepR2.vue")),
  },
  {
    service: "dataforseo",
    statusKey: "dataforseo" as const,
    stepKey: "dataforseo",
    icon: "search",
    component: defineAsyncComponent(() => import("src/components/installer/StepDataforseo.vue")),
  },
  {
    service: "github_app",
    statusKey: "githubApp" as const,
    stepKey: "githubApp",
    icon: "code",
    component: defineAsyncComponent(() => import("src/components/installer/StepGithubApp.vue")),
  },
  {
    service: "producthunt",
    statusKey: "producthunt" as const,
    stepKey: "producthunt",
    icon: "rocket_launch",
    component: defineAsyncComponent(() => import("src/components/installer/StepProducthunt.vue")),
  },
  {
    service: "voyage",
    statusKey: "voyage" as const,
    stepKey: "voyage",
    icon: "explore",
    component: defineAsyncComponent(() => import("src/components/installer/StepVoyage.vue")),
  },
];

export default defineComponent({
  name: "SettingsAdaptersPanel",

  components: {
    SettingsAdapterCard,
  },

  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },

  data: () => ({
    adapterList,
  }),

  methods: {
    async onAdapterChanged(): Promise<void> {
      await this.systemStatusStore.fetchStatus();
    },
  },
});
</script>

<style lang="scss" scoped>
.adapter-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 1024px) {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
