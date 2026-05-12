<template>
  <div class="q-pt-md">
    <!-- idle -->
    <div v-if="phase === 'idle'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase1.idleDescription') }}</p>
      <q-btn
        color="primary"
        :label="$t('coldStart.phase1.generateQuestions')"
        :loading="triggering"
        unelevated
        @click="onGenerateQuestions"
      />
    </div>

    <!-- questions generating -->
    <div v-else-if="phase === 'questions-running'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ $t('coldStart.phase1.questionsRunning') }}
      </q-banner>
    </div>

    <!-- answer questions -->
    <div v-else-if="phase === 'questions-ready'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase1.answerHint') }}</p>
      <div class="q-gutter-md">
        <div v-for="(q, idx) in questions" :key="idx" class="question-card">
          <div class="question-card__label">{{ idx + 1 }}. {{ q.question }}</div>
          <q-input
            v-model="answers[idx]"
            type="textarea"
            outlined
            dense
            autogrow
            :placeholder="$t('coldStart.phase1.answerPlaceholder') as string"
          />
        </div>
      </div>
      <div class="row q-mt-lg items-center">
        <q-btn
          flat
          color="grey-7"
          :label="$t('coldStart.phase1.generateQuestions')"
          size="sm"
          @click="onGenerateQuestions"
        />
        <q-space />
        <q-btn
          color="primary"
          :label="$t('coldStart.phase1.synthesizeButton')"
          :loading="triggering"
          :disable="!allAnswered"
          unelevated
          @click="onSynthesize"
        />
      </div>
    </div>

    <!-- synthesizing -->
    <div v-else-if="phase === 'synthesize-running'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ $t('coldStart.phase1.synthesizeRunning') }}
      </q-banner>
    </div>

    <!-- complete -->
    <div v-else-if="phase === 'complete'">
      <q-banner class="bg-positive text-white q-mb-md" rounded>
        <template #avatar><q-icon name="check_circle" /></template>
        {{ $t('coldStart.phase1.complete') }}
      </q-banner>
      <q-btn
        flat
        color="primary"
        :label="$t('coldStart.phase1.regenerate')"
        size="sm"
        @click="onGenerateQuestions"
      />
    </div>

    <q-banner v-if="errorMsg" class="bg-negative text-white q-mt-md" rounded>
      <template #avatar><q-icon name="error" /></template>
      {{ errorMsg }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { usePipelineRunPolling } from "src/composables/usePipelineRunPolling";
import { useColdStartStore } from "src/stores/cold-start";
import { defineComponent, ref } from "vue";

type Phase = "idle" | "questions-running" | "questions-ready" | "synthesize-running" | "complete";

export default defineComponent({
  name: "Phase1VoiceRefinement",

  props: {
    slug: { type: String, required: true },
  },

  emits: ["done"],

  setup() {
    const questionsRunId = ref<string | null>(null);
    const synthesizeRunId = ref<string | null>(null);
    return {
      coldStartStore: useColdStartStore(),
      questionsRunId,
      synthesizeRunId,
      questionsPolling: usePipelineRunPolling(questionsRunId),
      synthesizePolling: usePipelineRunPolling(synthesizeRunId),
    };
  },

  data: () => ({
    triggering: false,
    questions: [] as { question: string }[],
    answers: [] as string[],
    errorMsg: "",
  }),

  computed: {
    questionsRun() {
      return this.questionsPolling.run.value;
    },
    synthesizeRun() {
      return this.synthesizePolling.run.value;
    },

    phase(): Phase {
      const sRun = this.synthesizeRun;
      if (sRun?.status === "running" || sRun?.status === "queued") return "synthesize-running";
      if (sRun?.status === "completed") return "complete";

      const qRun = this.questionsRun;
      if (qRun?.status === "running" || qRun?.status === "queued") return "questions-running";
      if (qRun?.status === "completed" && this.questions.length > 0) return "questions-ready";

      return "idle";
    },

    allAnswered(): boolean {
      return this.questions.length > 0 && this.answers.every((a) => a?.trim().length > 0);
    },
  },

  watch: {
    "questionsPolling.terminal.value"(isTerminal: boolean) {
      if (!isTerminal) return;
      const qRun = this.questionsRun;
      if (qRun?.status === "completed" && qRun.output) {
        const out = qRun.output as { questions?: { question: string }[] };
        this.questions = out.questions ?? [];
        this.answers = this.questions.map(() => "");
      } else if (qRun?.status === "failed") {
        this.errorMsg = qRun.error ?? (this.$t("coldStart.phase1.questionsFailed") as string);
      }
    },

    "synthesizePolling.terminal.value"(isTerminal: boolean) {
      if (!isTerminal) return;
      const sRun = this.synthesizeRun;
      if (sRun?.status === "completed") {
        this.$emit("done");
      } else if (sRun?.status === "failed") {
        this.errorMsg = sRun.error ?? (this.$t("coldStart.phase1.synthesizeFailed") as string);
      }
    },
  },

  methods: {
    async onGenerateQuestions(): Promise<void> {
      this.triggering = true;
      this.errorMsg = "";
      try {
        const { runId } = await this.coldStartStore.triggerVoiceQuestions(this.slug);
        this.synthesizeRunId = null;
        this.synthesizePolling.stop();
        this.questionsRunId = runId;
      } catch {
        // http error already shown by api interceptor
      } finally {
        this.triggering = false;
      }
    },

    async onSynthesize(): Promise<void> {
      this.triggering = true;
      this.errorMsg = "";
      try {
        const answersWithIdx = this.answers.map((answer, questionIndex) => ({
          questionIndex,
          answer,
        }));
        const { runId } = await this.coldStartStore.triggerVoiceSynthesize(
          this.slug,
          answersWithIdx
        );
        this.synthesizeRunId = runId;
      } catch {
        // http error already shown by api interceptor
      } finally {
        this.triggering = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.question-card {
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 6px;
  padding: 16px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.question-card__label {
  font-weight: 500;
  font-size: 14px;
  margin-bottom: 8px;
}
</style>
