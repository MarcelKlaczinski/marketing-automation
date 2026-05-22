<template>
  <div class="settings-credentials-page">
    <h1 class="page-title">{{ $t("settings.credentials.title") as string }}</h1>
    <p class="page-description">{{ $t("settings.credentials.description") as string }}</p>

    <div class="cross-ref-banner glass-card-subtle">
      <p class="cross-ref-text">{{ $t("settings.credentials.signalSourcesNote") as string }}</p>
      <router-link :to="`/projects/${$route.params.slug}/settings/signal-sources`" class="cross-ref-link">
        {{ $t("settings.credentials.signalSourcesLink") as string }} →
      </router-link>
    </div>

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
      {
        id: "nano-banana",
        name: "Google Gemini (Nano Banana)",
        keys: [{ key: "api_key", labelKey: "settings.credentials.keys.apiKey" }],
      },
      {
        id: "producthunt",
        name: "Product Hunt",
        keys: [
          { key: "api_key", labelKey: "settings.credentials.keys.apiKey" },
          { key: "api_secret", labelKey: "settings.credentials.keys.apiSecret" },
        ],
      },
      {
        id: "reddit",
        name: "Reddit",
        keys: [
          { key: "client_id", labelKey: "settings.credentials.keys.clientId" },
          { key: "client_secret", labelKey: "settings.credentials.keys.clientSecret" },
          { key: "user_agent", labelKey: "settings.credentials.keys.userAgent" },
        ],
      },
      {
        id: "github",
        name: "GitHub Trending",
        keys: [
          { key: "personal_access_token", labelKey: "settings.credentials.keys.personalAccessToken" },
        ],
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

.cross-ref-banner {
  padding: 12px 16px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--glass-bg, rgba(255,255,255,0.06)) 100%, transparent);
  border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.cross-ref-text {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  flex: 1;
}

.cross-ref-link {
  font-size: 13px;
  color: var(--brand, #6366f1);
  text-decoration: none;
  white-space: nowrap;
}

.credential-cards {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
