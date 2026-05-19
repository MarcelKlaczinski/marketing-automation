<template>
  <div class="signal-sources-page">
    <h1 class="page-title">{{ $t("settings.signalSources.title") as string }}</h1>
    <p class="page-description">{{ $t("settings.signalSources.description") as string }}</p>

    <div class="source-cards">
      <SignalSourceCard
        v-for="source in sources"
        :key="source.id"
        :source-id="source.id"
        :requires-credentials="source.requiresCredentials"
        :credentials-status="credentialsStatus(source.id)"
        :config="getSourceConfig(source.id)"
        :cron-active="getCronState(source.id)"
        :project-slug="projectSlug"
        @toggle-enabled="onToggleEnabled"
        @toggle-cron="onToggleCron"
        @verify="onVerify"
        @manual-trigger="onManualTrigger"
        @config-saved="refetchConfig"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import SignalSourceCard from "src/components/settings/SignalSourceCard.vue";
import { apiGet, apiPatch, apiPost } from "src/lib/api";

interface AdapterStatusRow {
  configured: boolean;
  verified: boolean | null;
}

interface SystemStatusData {
  adapters: Record<string, AdapterStatusRow>;
}

interface ProjectData {
  redditSignalCronEnabled: boolean;
  githubSignalCronEnabled: boolean;
  hackernewsSignalCronEnabled: boolean;
  producthuntSignalCronEnabled: boolean;
  vendorRssSignalCronEnabled: boolean;
}

interface SignalSourcesConfig {
  reddit: { enabled: boolean; subreddits: string[]; sortMode: string; timeWindow: string; minUpvotes: number; minComments: number; maxAgeDays: number; cronPattern: string };
  github: { enabled: boolean; topics: string[]; timeWindowDays: number; minStarsNew: number; minStarsEstablished: number; maxAgeDays: number; cronPattern: string };
  hackernews: { enabled: boolean; queries: string[]; hitsPerPage: number; minPoints: number };
  producthunt: boolean;
  vendor_rss: { enabled: boolean; feeds: unknown[] };
}

const CRON_FIELD_MAP: Record<string, keyof ProjectData> = {
  reddit: "redditSignalCronEnabled",
  github: "githubSignalCronEnabled",
  hackernews: "hackernewsSignalCronEnabled",
  producthunt: "producthuntSignalCronEnabled",
  vendor_rss: "vendorRssSignalCronEnabled",
};

export default defineComponent({
  name: "SettingsSignalSourcesPage",

  components: { SignalSourceCard },

  setup() {
    const { data: systemStatus, refetch: refetchStatus } = useQuery({
      queryKey: ["system-status"],
      queryFn: () => apiGet<SystemStatusData>("/system/status"),
      refetchInterval: 30_000,
    });
    return { systemStatus, refetchStatus };
  },

  data: () => ({
    projectData: null as ProjectData | null,
    signalConfig: null as SignalSourcesConfig | null,
    sources: [
      { id: "reddit", requiresCredentials: true },
      { id: "github", requiresCredentials: true },
      { id: "producthunt", requiresCredentials: true },
      { id: "hackernews", requiresCredentials: false },
      { id: "vendor_rss", requiresCredentials: false },
    ],
  }),

  computed: {
    projectSlug(): string {
      return this.$route.params.slug as string;
    },
  },

  mounted() {
    void this.fetchData();
  },

  methods: {
    async fetchData() {
      const [proj, config] = await Promise.all([
        apiGet<ProjectData>(`/projects/${this.projectSlug}`),
        apiGet<SignalSourcesConfig>(`/projects/${this.projectSlug}/signal-sources`),
      ]);
      this.projectData = proj;
      this.signalConfig = config;
    },

    async refetchConfig() {
      this.signalConfig = await apiGet<SignalSourcesConfig>(`/projects/${this.projectSlug}/signal-sources`);
    },

    credentialsStatus(sourceId: string): "configured" | "not-configured" | "error" | "publicApi" {
      const src = this.sources.find((s) => s.id === sourceId);
      if (!src?.requiresCredentials) return "publicApi";
      const row = (this.systemStatus as SystemStatusData | undefined)?.adapters?.[sourceId];
      if (!row) return "not-configured";
      if (row.verified === false) return "error";
      if (row.configured) return "configured";
      return "not-configured";
    },

    getSourceConfig(sourceId: string): { enabled?: boolean } | boolean | null {
      const val = this.signalConfig?.[sourceId as keyof SignalSourcesConfig];
      if (val === undefined) return null;
      return val as { enabled?: boolean } | boolean;
    },

    getCronState(sourceId: string): boolean {
      const key = CRON_FIELD_MAP[sourceId];
      if (!key || !this.projectData) return false;
      return this.projectData[key] ?? false;
    },

    async onToggleEnabled({ sourceId, enabled }: { sourceId: string; enabled: boolean }) {
      await apiPatch(`/projects/${this.projectSlug}/signal-sources/${sourceId}`, { enabled });
      await this.refetchConfig();
    },

    async onToggleCron({ sourceId, active }: { sourceId: string; active: boolean }) {
      const key = CRON_FIELD_MAP[sourceId];
      if (!key) return;
      await apiPatch(`/projects/${this.projectSlug}`, { [key]: active });
      this.projectData = await apiGet<ProjectData>(`/projects/${this.projectSlug}`);
    },

    async onVerify(sourceId: string) {
      try {
        await apiPost(`/system/verify/${sourceId}`);
        this.$q.notify({ type: "positive", message: this.$t("settings.signalSources.verifySuccess") as string });
        void this.refetchStatus();
      } catch {
        this.$q.notify({ type: "negative", message: this.$t("settings.credentials.verifyFailed") as string });
      }
    },

    async onManualTrigger(sourceId: string) {
      const sourceName = this.$t(`settings.signalSources.sources.${sourceId}.name`) as string;
      this.$q.dialog({
        title: this.$t("settings.signalSources.confirmTrigger.title") as string,
        message: this.$t("settings.signalSources.confirmTrigger.message", { source: sourceName }) as string,
        cancel: true,
        persistent: true,
      }).onOk(async () => {
        try {
          const result = await apiPost<{ jobId: string }>(`/projects/${this.projectSlug}/signal-sources/${sourceId}/trigger`);
          this.$q.notify({
            type: "positive",
            message: this.$t("settings.signalSources.triggerStarted", { jobId: result.jobId }) as string,
          });
        } catch {
          this.$q.notify({ type: "negative", message: this.$t("settings.credentials.verifyFailed") as string });
        }
      });
    },
  },
});
</script>

<style scoped>
.signal-sources-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.page-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.source-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
