import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

export interface AdapterStatus {
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
}

interface SystemStatusState {
  loading: boolean;
  adapters: {
    anthropic: AdapterStatus;
    replicate: AdapterStatus;
    r2: AdapterStatus;
    dataforseo: AdapterStatus;
    smtp: AdapterStatus;
    githubApp: AdapterStatus;
  };
  redis: AdapterStatus;
  postgres: AdapterStatus;
}

const unknownStatus: AdapterStatus = {
  configured: false,
  verified: null,
  lastVerifiedAt: null,
};

export const useSystemStatusStore = defineStore('systemStatus', {
  state: (): SystemStatusState => ({
    loading: false,
    adapters: {
      anthropic: { ...unknownStatus },
      replicate: { ...unknownStatus },
      r2: { ...unknownStatus },
      dataforseo: { ...unknownStatus },
      smtp: { ...unknownStatus },
      githubApp: { ...unknownStatus },
    },
    redis: { ...unknownStatus },
    postgres: { ...unknownStatus },
  }),

  getters: {
    allConfigured: (state): boolean => {
      const all = [
        state.adapters.anthropic,
        state.adapters.replicate,
        state.adapters.r2,
        state.adapters.dataforseo,
        state.adapters.smtp,
        state.adapters.githubApp,
        state.redis,
        state.postgres,
      ];
      return all.every((a) => a.configured);
    },

    requiredCoreReady: (state): boolean => {
      return state.postgres.configured && state.redis.configured;
    },
  },

  actions: {
    async fetchStatus(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<SystemStatusState>('/system/status');
        const data = res.data;
        this.adapters = data.adapters;
        this.redis = data.redis;
        this.postgres = data.postgres;
      } catch {
        // Silent — endpoint may not exist yet (Spec 32 builds it)
      } finally {
        this.loading = false;
      }
    },
  },
});
