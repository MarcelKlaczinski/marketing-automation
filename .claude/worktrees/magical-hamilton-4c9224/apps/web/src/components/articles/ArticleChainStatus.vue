<template>
  <q-card flat bordered class="chain-status-card">
    <q-card-section class="q-py-sm q-px-md">
      <!-- Header -->
      <div class="row items-center justify-between q-mb-sm">
        <span class="text-body2 text-weight-medium">{{ $t('articles.automation.title') }}</span>
        <div class="row q-gutter-xs">
          <q-btn
            v-if="chain && (chain.status === 'failed' || chain.status === 'paused')"
            flat
            dense
            size="xs"
            color="positive"
            :label="$t('articles.automation.resume') as string"
            :loading="resuming"
            @click="resume"
          />
          <q-btn
            v-if="chain && (chain.status === 'queued' || chain.status === 'running')"
            flat
            dense
            size="xs"
            color="negative"
            :label="$t('articles.automation.cancel') as string"
            :loading="cancelling"
            @click="cancel"
          />
        </div>
      </div>

      <!-- Step list -->
      <div v-if="chain" class="step-list">
        <div
          v-for="step in STEPS"
          :key="step"
          class="row items-center q-mb-xs"
        >
          <!-- State icon -->
          <q-icon
            :name="stepIcon(step)"
            :color="stepColor(step)"
            size="16px"
            class="q-mr-sm"
          >
            <q-spinner v-if="stepState(step) === 'running'" size="16px" :color="stepColor(step)" />
          </q-icon>

          <!-- Label -->
          <span class="text-caption col" :class="stepTextClass(step)">
            {{ $t(`articles.automation.steps.${step}`) as string }}
          </span>

          <!-- State label -->
          <span class="text-caption text-right" :class="`text-${stepColor(step)}`" style="min-width: 70px;">
            {{ stepLabel(step) }}
          </span>
        </div>
      </div>

      <!-- Loading skeleton -->
      <div v-else class="text-caption text-grey-5">
        <q-spinner size="xs" class="q-mr-xs" />
        Lädt…
      </div>

      <!-- Total cost footer -->
      <div v-if="chain && Number(chain.totalCostEur) > 0" class="row justify-end q-mt-xs">
        <span class="text-caption text-grey-6">
          {{ $t('articles.automation.totalCost') }}: €{{ Number(chain.totalCostEur).toFixed(2) }}
        </span>
      </div>

      <!-- Error message -->
      <div v-if="chain?.status === 'failed' && chain.errorMessage" class="q-mt-xs text-caption text-negative">
        {{ chain.errorMessage }}
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { useNotify } from "src/composables/useNotify";
import { HttpError } from "src/lib/http-error";
import { api } from "src/lib/api-client";
import { defineComponent } from "vue";

type ChainStep = "outline" | "draft" | "schema-de" | "localize" | "schema-en" | "astro-transfer";
type ChainStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
type StepState = "done" | "running" | "failed" | "pending";

interface PipelineChain {
  id:            string;
  status:        ChainStatus;
  currentStep:   ChainStep | null;
  failedStep:    ChainStep | null;
  stepRuns:      Partial<Record<ChainStep, string>>;
  totalCostEur:  string;
  errorMessage:  string | null;
}

const STEPS: ChainStep[] = [
  "outline",
  "draft",
  "schema-de",
  "localize",
  "schema-en",
  "astro-transfer",
];

const STEP_INDEX: Record<ChainStep, number> = {
  "outline":        0,
  "draft":          1,
  "schema-de":      2,
  "localize":       3,
  "schema-en":      4,
  "astro-transfer": 5,
};

export default defineComponent({
  name: "ArticleChainStatus",

  props: {
    slug:    { type: String, required: true },
    chainId: { type: String, required: true },
  },

  emits: ["done", "cancelled"],

  setup() {
    return { notify: useNotify(), STEPS };
  },

  data: () => ({
    chain:      null as PipelineChain | null,
    resuming:   false,
    cancelling: false,
    pollTimer:  null as ReturnType<typeof setInterval> | null,
  }),

  async created() {
    await this.fetchChain();
    this.maybeStartPolling();
  },

  beforeUnmount() {
    this.stopPolling();
  },

  methods: {
    async fetchChain(): Promise<void> {
      try {
        const res = await api.get<{ ok: boolean; data: PipelineChain }>(
          `/projects/${this.slug}/pipeline-chains/${this.chainId}`
        );
        this.chain = res.data.data;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    maybeStartPolling(): void {
      if (!this.chain) return;
      if (this.chain.status === "queued" || this.chain.status === "running") {
        this.pollTimer = setInterval(async () => {
          await this.fetchChain();
          if (this.chain && this.chain.status !== "queued" && this.chain.status !== "running") {
            this.stopPolling();
            if (this.chain.status === "completed") this.$emit("done");
          }
        }, 2000);
      }
    },

    stopPolling(): void {
      if (this.pollTimer !== null) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },

    async resume(): Promise<void> {
      this.resuming = true;
      try {
        await api.post(`/projects/${this.slug}/pipeline-chains/${this.chainId}/resume`);
        this.notify.success(this.$t("articles.automation.resumeSuccess") as string);
        await this.fetchChain();
        this.maybeStartPolling();
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.resuming = false;
      }
    },

    async cancel(): Promise<void> {
      this.cancelling = true;
      try {
        await api.post(`/projects/${this.slug}/pipeline-chains/${this.chainId}/cancel`);
        this.notify.success(this.$t("articles.automation.cancelSuccess") as string);
        await this.fetchChain();
        this.$emit("cancelled");
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.cancelling = false;
      }
    },

    stepState(step: ChainStep): StepState {
      if (!this.chain) return "pending";
      const c = this.chain;

      // Completed steps have a runId in stepRuns
      if (c.stepRuns[step]) return "done";
      // Failed step
      if (c.failedStep === step || (c.status === "failed" && c.currentStep === step)) return "failed";
      // Currently running step
      if (c.currentStep === step && (c.status === "running" || c.status === "queued")) return "running";
      // Pending: step index is after the current step
      const currentIdx = c.currentStep ? STEP_INDEX[c.currentStep] : -1;
      if (STEP_INDEX[step] > currentIdx) return "pending";
      // Fallback — treat as done if we've passed it
      return "done";
    },

    stepIcon(step: ChainStep): string {
      const state = this.stepState(step);
      if (state === "done")    return "check_circle";
      if (state === "running") return "radio_button_unchecked";
      if (state === "failed")  return "error";
      return "radio_button_unchecked";
    },

    stepColor(step: ChainStep): string {
      const state = this.stepState(step);
      if (state === "done")    return "positive";
      if (state === "running") return "primary";
      if (state === "failed")  return "negative";
      return "grey-4";
    },

    stepTextClass(step: ChainStep): string {
      const state = this.stepState(step);
      if (state === "pending") return "text-grey-5";
      if (state === "failed")  return "text-negative";
      return "";
    },

    stepLabel(step: ChainStep): string {
      const state = this.stepState(step);
      return this.$t(`articles.automation.states.${state}`) as string;
    },
  },
});
</script>

<style scoped>
.chain-status-card {
  border-left: 3px solid var(--q-primary);
}
</style>
