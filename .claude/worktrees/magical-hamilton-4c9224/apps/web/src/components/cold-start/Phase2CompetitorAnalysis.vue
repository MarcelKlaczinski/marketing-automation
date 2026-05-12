<template>
  <div class="q-pt-md">
    <!-- idle -->
    <div v-if="phase === 'idle'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase2.idleDescription') }}</p>
      <q-btn color="primary" :label="$t('coldStart.phase2.startButton')" :loading="triggering" unelevated @click="onStart" />
    </div>

    <!-- running Phase 2.1: identifying competitors -->
    <div v-else-if="phase === 'identifying'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ $t('coldStart.phase2.identifying') }}
      </q-banner>
    </div>

    <!-- confirmation: Phase 2.1 done, waiting for user to approve Phase 2.2 -->
    <div v-else-if="phase === 'confirming'" class="confirmation-card q-pa-md q-mb-md" style="border: 1px solid var(--q-primary); border-radius: 8px;">
      <div class="text-h6 q-mb-sm">{{ $t('coldStart.phase2.confirmation.title') }}</div>
      <div class="text-body2 q-mb-md">
        {{ $t('coldStart.phase2.confirmation.body', {
          count: competitorCount,
          cost: estimatedCost.toFixed(2),
        }) }}
      </div>
      <q-banner v-if="competitorCount > MAX_COMPETITORS" class="bg-warning text-dark q-mb-md" rounded>
        <template #avatar><q-icon name="warning" /></template>
        {{ $t('coldStart.phase2.confirmation.tooManyCompetitors', {
          count: competitorCount,
          max: MAX_COMPETITORS,
        }) }}
      </q-banner>
      <div class="row q-gutter-sm">
        <q-btn outline :label="$t('coldStart.phase2.confirmation.cancel')" @click="onCancelConfirm" />
        <q-btn
          color="primary"
          unelevated
          :label="$t('coldStart.phase2.confirmation.runAnalysis')"
          :disable="competitorCount > MAX_COMPETITORS || competitorCount === 0"
          :loading="triggering"
          @click="onConfirm"
        />
      </div>
    </div>

    <!-- running Phase 2.2: analyzing -->
    <div v-else-if="phase === 'analyzing'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ $t('coldStart.phase2.running') }}
      </q-banner>
    </div>

    <!-- complete -->
    <div v-else-if="phase === 'complete'">
      <q-banner class="bg-positive text-white q-mb-md" rounded>
        <template #avatar><q-icon name="check_circle" /></template>
        {{ $t('coldStart.phase2.complete') }}
      </q-banner>

      <div v-if="hasResults" class="q-mt-md">
        <q-expansion-item
          v-model="expandedCompetitors"
          icon="business"
          :label="$t('coldStart.phase2.competitorsLabel')"
          header-class="text-weight-medium"
        >
          <q-card flat>
            <q-card-section>
              <div class="row q-col-gutter-sm">
                <div
                  v-for="comp in resultCompetitors"
                  :key="comp.domain"
                  class="col-12 col-md-6"
                >
                  <q-card flat bordered>
                    <q-card-section>
                      <div class="text-subtitle1 text-weight-medium">{{ comp.name || comp.domain }}</div>
                      <a :href="`https://${comp.domain}`" target="_blank" rel="noopener noreferrer" class="text-primary">
                        {{ comp.domain }}
                      </a>
                      <p v-if="comp.description" class="text-caption q-mt-sm q-mb-none">{{ comp.description }}</p>
                    </q-card-section>
                  </q-card>
                </div>
              </div>
            </q-card-section>
          </q-card>
        </q-expansion-item>

        <q-separator class="q-my-xs" />

        <q-expansion-item
          icon="ads_click"
          :label="`${$t('coldStart.phase2.gapsLabel')} (${contentGaps.length})`"
          header-class="text-weight-medium"
        >
          <q-card flat>
            <q-card-section>
              <q-list dense>
                <q-item v-for="gap in contentGaps" :key="gap">
                  <q-item-section avatar>
                    <q-icon name="fiber_manual_record" color="positive" size="xs" />
                  </q-item-section>
                  <q-item-section>{{ gap }}</q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </q-expansion-item>

        <q-separator class="q-my-xs" />

        <q-expansion-item
          icon="block"
          :label="`${$t('coldStart.phase2.avoidLabel')} (${topicsToAvoid.length})`"
          header-class="text-weight-medium"
        >
          <q-card flat>
            <q-card-section>
              <q-list dense>
                <q-item v-for="topic in topicsToAvoid" :key="topic">
                  <q-item-section avatar>
                    <q-icon name="block" color="warning" size="xs" />
                  </q-item-section>
                  <q-item-section>{{ topic }}</q-item-section>
                </q-item>
              </q-list>
            </q-card-section>
          </q-card>
        </q-expansion-item>

        <q-separator class="q-my-xs" />

        <q-expansion-item
          icon="article"
          :label="$t('coldStart.phase2.reportLabel')"
          header-class="text-weight-medium"
        >
          <q-card flat>
            <q-card-section>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div class="markdown-body" v-html="reportHtml" />
            </q-card-section>
          </q-card>
        </q-expansion-item>
      </div>

      <div class="q-mt-md">
        <q-btn flat color="primary" :label="$t('coldStart.phase2.regenerate')" size="sm" @click="onStart" />
      </div>
    </div>

    <q-banner v-if="errorMsg" class="bg-negative text-white q-mt-md" rounded>
      <template #avatar><q-icon name="error" /></template>
      {{ errorMsg }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { marked } from "marked";
import { usePipelineRunPolling } from "src/composables/usePipelineRunPolling";
import { api } from "src/lib/api-client";
import { useColdStartStore } from "src/stores/cold-start";
import { useProjectsStore } from "src/stores/projects";
import { defineComponent, ref } from "vue";

const MAX_COMPETITORS = 15;
const COST_PER_COMPETITOR_EUR = 0.2;

type Competitor = { domain: string; why_relevant: string; expected_strengths: string[] };
type Phase = "idle" | "identifying" | "confirming" | "analyzing" | "complete";

interface DisplayCompetitor {
  domain: string;
  name?: string;
  description?: string;
}

interface AnalysisOutput {
  reportMd?: string;
  contentGaps?: string[];
  topicsToAvoid?: string[];
}

interface PaginatedRuns {
  items: Array<{ output: unknown; status: string }>;
}

export default defineComponent({
  name: "Phase2CompetitorAnalysis",

  props: {
    slug: { type: String, required: true },
  },

  emits: ["done"],

  setup() {
    const questionsRunId = ref<string | null>(null);
    const analysisRunId = ref<string | null>(null);
    return {
      coldStartStore: useColdStartStore(),
      projectsStore: useProjectsStore(),
      questionsRunId,
      analysisRunId,
      questionsPolling: usePipelineRunPolling(questionsRunId),
      analysisPolling: usePipelineRunPolling(analysisRunId),
    };
  },

  data: () => ({
    MAX_COMPETITORS,
    triggering: false,
    errorMsg: "",
    pendingCompetitors: [] as Competitor[],
    expandedCompetitors: true,
    resultCompetitors: [] as DisplayCompetitor[],
    contentGaps: [] as string[],
    topicsToAvoid: [] as string[],
    reportMd: "",
  }),

  computed: {
    questionsRun() {
      return this.questionsPolling.run.value;
    },
    analysisRun() {
      return this.analysisPolling.run.value;
    },

    phase(): Phase {
      const aRun = this.analysisRun;
      if (aRun?.status === "completed") return "complete";
      if (aRun?.status === "running" || aRun?.status === "queued") return "analyzing";

      if (this.pendingCompetitors.length > 0) return "confirming";

      const qRun = this.questionsRun;
      if (qRun?.status === "running" || qRun?.status === "queued") return "identifying";

      // On page reload no polling run is active — fall back to store status
      if (this.coldStartStore.statusByProject[this.slug]?.competitors.status === "complete") {
        return "complete";
      }

      return "idle";
    },

    competitorCount(): number {
      return this.pendingCompetitors.length;
    },

    estimatedCost(): number {
      return this.competitorCount * COST_PER_COMPETITOR_EUR;
    },

    hasResults(): boolean {
      return this.resultCompetitors.length > 0 || this.contentGaps.length > 0 || !!this.reportMd;
    },

    reportHtml(): string {
      if (!this.reportMd) return "";
      const r = marked.parse(this.reportMd);
      return typeof r === "string" ? r : "";
    },
  },

  async created(): Promise<void> {
    await this.loadResults();
  },

  watch: {
    "questionsPolling.terminal.value"(isTerminal: boolean) {
      if (!isTerminal) return;
      const qRun = this.questionsRun;
      if (qRun?.status === "completed" && qRun.output) {
        const out = qRun.output as { competitors?: Competitor[] };
        const competitors = out.competitors ?? [];
        if (competitors.length > 0) {
          // Show confirmation card instead of auto-triggering
          this.pendingCompetitors = competitors;
        } else {
          this.errorMsg = this.$t("coldStart.phase2.noCompetitors") as string;
        }
      } else if (qRun?.status === "failed") {
        this.errorMsg = qRun.error ?? (this.$t("coldStart.phase2.failed") as string);
      }
    },

    "analysisPolling.terminal.value"(isTerminal: boolean) {
      if (!isTerminal) return;
      const aRun = this.analysisRun;
      if (aRun?.status === "completed") {
        this.pendingCompetitors = [];
        const out = aRun.output as AnalysisOutput | null;
        if (out) {
          this.contentGaps = out.contentGaps ?? [];
          this.topicsToAvoid = out.topicsToAvoid ?? [];
          this.reportMd = out.reportMd ?? "";
        }
        const qRun = this.questionsRun;
        if (qRun?.output) {
          const qOut = qRun.output as { competitors?: DisplayCompetitor[] };
          this.resultCompetitors = qOut.competitors ?? [];
        }
        this.$emit("done");
      } else if (aRun?.status === "failed") {
        this.errorMsg = aRun.error ?? (this.$t("coldStart.phase2.failed") as string);
      }
    },
  },

  methods: {
    async loadResults(): Promise<void> {
      const projectId =
        this.projectsStore.current?.id ??
        this.projectsStore.list.find((p) => p.slug === this.slug)?.id;
      if (!projectId) return;
      try {
        const [analysisRes, questionsRes] = await Promise.all([
          api.get<{ ok: boolean; data: PaginatedRuns }>(
            `/pipeline-runs/project/${projectId}`,
            { params: { pipelineNamePrefix: "cold-start:competitor-analysis", limit: 1 } }
          ),
          api.get<{ ok: boolean; data: PaginatedRuns }>(
            `/pipeline-runs/project/${projectId}`,
            { params: { pipelineNamePrefix: "cold-start:competitor-questions", limit: 1 } }
          ),
        ]);
        const latestAnalysis = analysisRes.data.data.items?.[0];
        if (latestAnalysis?.status === "completed" && latestAnalysis.output) {
          const out = latestAnalysis.output as AnalysisOutput;
          this.contentGaps = out.contentGaps ?? [];
          this.topicsToAvoid = out.topicsToAvoid ?? [];
          this.reportMd = out.reportMd ?? "";
        }
        const latestQuestions = questionsRes.data.data.items?.[0];
        if (latestQuestions?.status === "completed" && latestQuestions.output) {
          const qOut = latestQuestions.output as { competitors?: DisplayCompetitor[] };
          this.resultCompetitors = qOut.competitors ?? [];
        }
      } catch {
        // silently skip — results are best-effort
      }
    },

    async onStart(): Promise<void> {
      this.triggering = true;
      this.errorMsg = "";
      this.pendingCompetitors = [];
      try {
        const { runId } = await this.coldStartStore.triggerCompetitorQuestions(this.slug);
        this.analysisRunId = null;
        this.analysisPolling.stop();
        this.questionsRunId = runId;
      } catch {
        // shown by interceptor
      } finally {
        this.triggering = false;
      }
    },

    onCancelConfirm(): void {
      this.pendingCompetitors = [];
      this.questionsRunId = null;
    },

    async onConfirm(): Promise<void> {
      this.triggering = true;
      this.errorMsg = "";
      try {
        const { runId } = await this.coldStartStore.triggerCompetitorAnalysis(
          this.slug,
          this.pendingCompetitors
        );
        this.pendingCompetitors = [];
        this.analysisRunId = runId;
      } catch {
        this.errorMsg = this.$t("coldStart.phase2.failed") as string;
      } finally {
        this.triggering = false;
      }
    },
  },
});
</script>
