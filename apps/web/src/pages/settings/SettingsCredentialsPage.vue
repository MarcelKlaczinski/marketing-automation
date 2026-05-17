<template>
  <div class="settings-credentials-page">
    <h1 class="page-title">{{ $t("settings.credentials.title") as string }}</h1>
    <p class="page-description">{{ $t("settings.credentials.description") as string }}</p>

    <div class="credential-cards">
      <CredentialCard
        v-for="adapter in adapters"
        :key="adapter.id"
        :adapter="adapter"
        :status="adapterStatus(adapter.id)"
        @refresh="refetchStatus"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import CredentialCard from "src/components/settings/CredentialCard.vue";
import { apiGet } from "src/lib/api";

interface AdapterStatusRow {
  configured: boolean;
  verified: boolean | null;
}

interface SystemStatusData {
  adapters: Record<string, AdapterStatusRow>;
}

export default defineComponent({
  name: "SettingsCredentialsPage",

  components: { CredentialCard },

  setup() {
    const { data: systemStatus, refetch } = useQuery({
      queryKey: ["system-status"],
      queryFn: () => apiGet<SystemStatusData>("/system/status"),
      refetchInterval: 30_000,
    });
    return { systemStatus, refetchStatus: refetch };
  },

  data: () => ({
    adapters: [
      {
        id: "anthropic",
        name: "Anthropic Claude",
        keys: [{ key: "api_key", labelKey: "settings.credentials.keys.apiKey" }],
      },
      {
        id: "voyage",
        name: "Voyage AI",
        keys: [{ key: "api_key", labelKey: "settings.credentials.keys.apiKey" }],
      },
      {
        id: "dataforseo",
        name: "DataForSEO",
        keys: [
          { key: "login", labelKey: "settings.credentials.keys.login" },
          { key: "password", labelKey: "settings.credentials.keys.password" },
        ],
      },
      {
        id: "replicate",
        name: "Replicate",
        keys: [{ key: "api_token", labelKey: "settings.credentials.keys.apiToken" }],
      },
    ],
  }),

  methods: {
    adapterStatus(adapterId: string): AdapterStatusRow | null {
      return (this.systemStatus as SystemStatusData | undefined)?.adapters?.[adapterId] ?? null;
    },
  },
});
</script>

<style scoped>
.settings-credentials-page {
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

.credential-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
