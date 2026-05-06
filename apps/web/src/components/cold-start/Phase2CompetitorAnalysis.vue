<template>
  <div class="q-pt-md">
    <!-- idle -->
    <div v-if="phase === 'idle'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase2.idleDescription') }}</p>
      <q-btn color="primary" :label="$t('coldStart.phase2.startButton')" :loading="triggering" unelevated @click="onStart" />
    </div>

    <!-- running (either sub-pipeline) -->
    <div v-else-if="phase === 'running'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ subPhase === 'identifying' ? $t('coldStart.phase2.identifying') : $t('coldStart.phase2.running') }}
      </q-banner>
    </div>

    <!-- complete -->
    <div v-else-if="phase === 'complete'">
      <q-banner class="bg-positive text-white q-mb-md" rounded>
        <template #avatar><q-icon name="check_circle" /></template>
        {{ $t('coldStart.phase2.complete') }}
      </q-banner>
      <q-btn flat color="primary" :label="$t('coldStart.phase2.regenerate')" size="sm" @click="onStart" />
    </div>

    <q-banner v-if="errorMsg" class="bg-negative text-white q-mt-md" rounded>
      <template #avatar><q-icon name="error" /></template>
      {{ errorMsg }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useColdStartStore } from 'src/stores/cold-start';
import { usePipelineRunPolling } from 'src/composables/usePipelineRunPolling';

type Phase = 'idle' | 'running' | 'complete';
type SubPhase = 'identifying' | 'analyzing';

export default defineComponent({
  name: 'Phase2CompetitorAnalysis',

  props: {
    slug: { type: String, required: true },
  },

  emits: ['done'],

  setup() {
    const questionsRunId = ref<string | null>(null);
    const analysisRunId = ref<string | null>(null);
    return {
      coldStartStore: useColdStartStore(),
      questionsRunId,
      analysisRunId,
      questionsPolling: usePipelineRunPolling(questionsRunId),
      analysisPolling: usePipelineRunPolling(analysisRunId),
    };
  },

  data: () => ({
    triggering: false,
    subPhase: 'identifying' as SubPhase,
    errorMsg: '',
  }),

  computed: {
    questionsRun() { return this.questionsPolling.run.value; },
    analysisRun() { return this.analysisPolling.run.value; },

    phase(): Phase {
      const aRun = this.analysisRun;
      if (aRun?.status === 'completed') return 'complete';
      if (aRun?.status === 'running' || aRun?.status === 'queued') return 'running';

      const qRun = this.questionsRun;
      if (qRun?.status === 'running' || qRun?.status === 'queued') return 'running';

      return 'idle';
    },
  },

  watch: {
    'questionsPolling.terminal.value'(isTerminal: boolean) {
      if (!isTerminal) return;
      const qRun = this.questionsRun;
      if (qRun?.status === 'completed' && qRun.output) {
        // Auto-trigger analysis with identified competitors
        const out = qRun.output as { competitors?: { domain: string; why_relevant: string; expected_strengths: string[] }[] };
        const competitors = out.competitors ?? [];
        if (competitors.length > 0) {
          this.subPhase = 'analyzing';
          void this.triggerAnalysis(competitors);
        } else {
          this.errorMsg = this.$t('coldStart.phase2.noCompetitors') as string;
        }
      } else if (qRun?.status === 'failed') {
        this.errorMsg = qRun.error ?? (this.$t('coldStart.phase2.failed') as string);
      }
    },

    'analysisPolling.terminal.value'(isTerminal: boolean) {
      if (!isTerminal) return;
      const aRun = this.analysisRun;
      if (aRun?.status === 'completed') {
        this.$emit('done');
      } else if (aRun?.status === 'failed') {
        this.errorMsg = aRun.error ?? (this.$t('coldStart.phase2.failed') as string);
      }
    },
  },

  methods: {
    async onStart(): Promise<void> {
      this.triggering = true;
      this.errorMsg = '';
      this.subPhase = 'identifying';
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

    async triggerAnalysis(competitors: { domain: string; why_relevant: string; expected_strengths: string[] }[]): Promise<void> {
      try {
        const { runId } = await this.coldStartStore.triggerCompetitorAnalysis(this.slug, competitors);
        this.analysisRunId = runId;
      } catch {
        this.errorMsg = this.$t('coldStart.phase2.failed') as string;
      }
    },
  },
});
</script>
