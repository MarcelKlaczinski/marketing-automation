<template>
  <q-card flat bordered class="q-pa-sm">
    <div class="row items-center q-gutter-md">
      <div>
        <div class="text-caption text-grey-6">{{ $t('trends.synthesis.lastRun') }}</div>
        <div class="text-body2">{{ lastRunLabel }}</div>
      </div>

      <q-separator vertical inset />

      <div>
        <div class="text-caption text-grey-6">{{ $t('trends.synthesis.poolSize') }}</div>
        <div class="text-body2">
          <span v-if="poolSize === 0">{{ $t('trends.synthesis.noSignals') }}</span>
          <span v-else>{{ $t('trends.synthesis.unprocessedCount', { n: poolSize }, poolSize) }}</span>
        </div>
      </div>

      <q-space />

      <div class="row items-center q-gutter-sm">
        <q-badge v-if="statusLabel" :color="statusBadgeColor" outline>
          {{ statusLabel }}
        </q-badge>
        <q-btn
          :loading="running"
          :disable="running || poolSize === 0"
          color="primary"
          :label="$t('trends.synthesis.runNow')"
          dense
          @click="runSynthesis"
        />
      </div>
    </div>

    <q-banner
      v-if="jobStatus === 'completed'"
      dense
      rounded
      class="bg-green-1 text-green-10 q-mt-sm"
    >
      <template #avatar><q-icon name="check_circle" color="green" /></template>
      {{ $t('trends.synthesis.completedBanner') }}
    </q-banner>

    <q-banner
      v-if="jobStatus === 'failed'"
      dense
      rounded
      class="bg-red-1 text-red-10 q-mt-sm"
    >
      <template #avatar><q-icon name="error" color="red" /></template>
      {{ $t('trends.synthesis.failedBanner') }}
    </q-banner>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";

type JobStatus = "idle" | "running" | "completed" | "failed";

export default defineComponent({
  name: "SynthesisTriggerCard",

  props: {
    projectSlug: { type: String, required: true },
  },

  emits: ["synthesis-complete"],

  data: () => ({
    poolSize: 0,
    jobStatus: "idle" as JobStatus,
    jobId: null as string | null,
    running: false,
    pollTimer: null as ReturnType<typeof setInterval> | null,
  }),

  computed: {
    lastRunLabel(): string {
      if (this.jobStatus === "completed") return this.$t("trends.synthesis.completed") as string;
      if (this.jobStatus === "failed") return this.$t("trends.synthesis.failed") as string;
      return this.$t("trends.synthesis.never") as string;
    },

    statusLabel(): string {
      if (this.jobStatus === "running") return this.$t("trends.synthesis.running") as string;
      if (this.jobStatus === "completed") return this.$t("trends.synthesis.completed") as string;
      if (this.jobStatus === "failed") return this.$t("trends.synthesis.failed") as string;
      return "";
    },

    statusBadgeColor(): string {
      if (this.jobStatus === "running") return "primary";
      if (this.jobStatus === "completed") return "positive";
      if (this.jobStatus === "failed") return "negative";
      return "grey-5";
    },
  },

  created() {
    void this.loadInitialState();
  },

  beforeUnmount() {
    this.stopPolling();
  },

  methods: {
    async loadInitialState(): Promise<void> {
      await Promise.all([this.fetchPoolSize(), this.fetchStatus()]);
      if (this.jobStatus === "running") {
        this.running = true;
        this.startPolling();
      }
    },

    async fetchPoolSize(): Promise<void> {
      try {
        const res = await api.get<{
          ok: boolean;
          data: { items: unknown[]; total: number };
        }>(`/projects/${this.projectSlug}/trends/signal-pool`, {
          params: { limit: 1, offset: 0, processed: "unprocessed" },
        });
        this.poolSize = res.data.data.total;
      } catch {
        this.poolSize = 0;
      }
    },

    async fetchStatus(): Promise<void> {
      try {
        const res = await api.get<{
          ok: boolean;
          data: { status: JobStatus; jobId: string | null };
        }>(`/projects/${this.projectSlug}/trends/synthesis-status`);
        this.jobStatus = res.data.data.status;
        this.jobId = res.data.data.jobId;
      } catch (e) {
        if (e instanceof HttpError) {
          console.error("Failed to fetch synthesis status", e.userMessage);
        }
      }
    },

    async runSynthesis(): Promise<void> {
      if (this.running) return;
      try {
        const res = await api.post<{ ok: boolean; data: { jobId: string; deduped: boolean } }>(
          `/projects/${this.projectSlug}/trends/synthesize`,
        );
        this.jobId = res.data.data.jobId;
        this.jobStatus = "running";
        this.running = true;
        this.startPolling();
      } catch (e) {
        if (e instanceof HttpError) {
          console.error("Failed to trigger synthesis", e.userMessage);
        }
      }
    },

    startPolling(): void {
      if (this.pollTimer) return;
      this.pollTimer = setInterval(() => void this.pollOnce(), 3000);
    },

    stopPolling(): void {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },

    async pollOnce(): Promise<void> {
      await this.fetchStatus();
      if (this.jobStatus === "completed" || this.jobStatus === "failed") {
        this.stopPolling();
        this.running = false;
        if (this.jobStatus === "completed") {
          void this.fetchPoolSize();
          this.$emit("synthesis-complete");
        }
      }
    },
  },
});
</script>
