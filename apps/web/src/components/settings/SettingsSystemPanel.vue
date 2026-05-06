<template>
  <div>
    <p class="text-body2 q-mb-lg">{{ $t('settings.system.intro') }}</p>

    <div class="system-grid">
      <div class="system-card">
        <div class="system-card__label">{{ $t('settings.system.deploymentMode') }}</div>
        <div class="system-card__value">{{ deploymentMode }}</div>
        <div class="system-card__caption">
          {{ deploymentMode === 'lokal' ? $t('settings.system.lokalCaption') : $t('settings.system.selfHostedCaption') }}
        </div>
      </div>

      <div class="system-card">
        <div class="system-card__label">PostgreSQL</div>
        <div class="system-card__value">
          <q-icon
            :name="postgresStatus.verified ? 'check_circle' : 'error'"
            :color="postgresStatus.verified ? 'positive' : 'negative'"
            size="20px"
            class="q-mr-sm"
          />
          {{ postgresStatus.verified ? $t('settings.system.connected') : $t('settings.system.disconnected') }}
        </div>
        <div v-if="postgresStatus.lastVerifiedAt" class="system-card__caption">
          {{ $t('settings.system.lastChecked') }}: {{ formatDate(postgresStatus.lastVerifiedAt) }}
        </div>
      </div>

      <div class="system-card">
        <div class="system-card__label">Redis</div>
        <div class="system-card__value">
          <q-icon
            :name="redisStatus.verified ? 'check_circle' : 'error'"
            :color="redisStatus.verified ? 'positive' : 'negative'"
            size="20px"
            class="q-mr-sm"
          />
          {{ redisStatus.verified ? $t('settings.system.connected') : $t('settings.system.disconnected') }}
        </div>
        <div v-if="redisStatus.lastVerifiedAt" class="system-card__caption">
          {{ $t('settings.system.lastChecked') }}: {{ formatDate(redisStatus.lastVerifiedAt) }}
        </div>
      </div>

      <div class="system-card">
        <div class="system-card__label">{{ $t('settings.system.apiVersion') }}</div>
        <div class="system-card__value">{{ apiVersion || '—' }}</div>
        <div class="system-card__caption">Bun {{ nodeVersion || '—' }}</div>
      </div>
    </div>

    <div class="q-mt-xl">
      <q-btn
        outline
        color="primary"
        :label="$t('settings.system.refreshButton') as string"
        icon="refresh"
        :loading="systemStatusStore.loading"
        @click="onRefresh"
      />
    </div>

    <q-banner v-if="postgresStatus.verified === false || redisStatus.verified === false" class="q-mt-lg bg-negative text-white">
      <template #avatar><q-icon name="warning" /></template>
      {{ $t('settings.system.coreUnreachable') }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { api } from 'src/lib/api-client';
import { useSystemStatusStore } from 'src/stores/system-status';

interface SystemInfo {
  deploymentMode: 'lokal' | 'self_hosted';
  nodeVersion: string;
  apiVersion: string;
}

export default defineComponent({
  name: 'SettingsSystemPanel',

  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },

  data: () => ({
    deploymentMode: 'lokal' as 'lokal' | 'self_hosted',
    nodeVersion: '',
    apiVersion: '',
  }),

  computed: {
    postgresStatus() {
      return this.systemStatusStore.postgres;
    },
    redisStatus() {
      return this.systemStatusStore.redis;
    },
  },

  async created() {
    await this.fetchSystemInfo();
  },

  methods: {
    async fetchSystemInfo(): Promise<void> {
      try {
        const res = await api.get<{ ok: boolean; data: SystemInfo }>('/system/info');
        const info = res.data.data;
        this.deploymentMode = info.deploymentMode;
        this.nodeVersion = info.nodeVersion ?? '';
        this.apiVersion = info.apiVersion;
      } catch {
        // non-critical
      }
    },

    async onRefresh(): Promise<void> {
      await Promise.all([this.systemStatusStore.fetchStatus(), this.fetchSystemInfo()]);
    },

    formatDate(iso: string): string {
      const locale = this.$i18n.locale === 'de' ? 'de-DE' : 'en-US';
      return new Date(iso).toLocaleString(locale);
    },
  },
});
</script>

<style lang="scss" scoped>
.system-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
}

.system-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.system-card__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 8px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}

.system-card__value {
  font-size: 18px;
  font-weight: 500;
  display: flex;
  align-items: center;
}

.system-card__caption {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-top: 6px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}
</style>
