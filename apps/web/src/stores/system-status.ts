import { defineStore } from "pinia";
import { api } from "src/lib/api-client";

export interface AdapterStatus {
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
  missingKeys?: string[];
}

interface SystemStatusState {
  loading: boolean;
  initialized: boolean;
  deploymentMode: "lokal" | "self_hosted";
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

interface StatusApiResponse {
  ok: boolean;
  data: Omit<SystemStatusState, "loading" | "deploymentMode">;
}

const unknownStatus: AdapterStatus = {
  configured: false,
  verified: null,
  lastVerifiedAt: null,
};

export const useSystemStatusStore = defineStore("systemStatus", {
  state: (): SystemStatusState => ({
    loading: false,
    initialized: false,
    deploymentMode: "lokal",
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
      // verified=null means "not checked yet". Treat as ready to avoid redirect loops.
      // Only redirect to installer when Spec-32 has explicitly verified and found them down.
      const postgresReady = state.postgres.configured || state.postgres.verified === null;
      const redisReady = state.redis.configured || state.redis.verified === null;
      return postgresReady && redisReady;
    },
  },

  actions: {
    async fetchStatus(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<StatusApiResponse>("/system/status");
        const payload = res.data.data;
        this.initialized = payload.initialized;
        this.adapters = payload.adapters;
        this.redis = payload.redis;
        this.postgres = payload.postgres;
      } catch {
        // Silent — keep default unknown state on failure
      } finally {
        this.loading = false;
      }
    },

    async fetchDeploymentMode(): Promise<void> {
      try {
        const res = await api.get<{
          ok: boolean;
          data: { deploymentMode: "lokal" | "self_hosted" };
        }>("/system/info");
        this.deploymentMode = res.data.data.deploymentMode;
      } catch {
        // Default to lokal
      }
    },
  },
});
