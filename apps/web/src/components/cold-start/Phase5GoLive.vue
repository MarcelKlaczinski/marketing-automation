<template>
  <div class="q-pt-md">
    <!-- idle -->
    <div v-if="phase === 'idle'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase5.idleDescription') }}</p>
      <q-btn color="primary" :label="$t('coldStart.phase5.startButton')" :loading="triggering" unelevated @click="onStart" />
    </div>

    <!-- running -->
    <div v-else-if="phase === 'running'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ $t('coldStart.phase5.running') }}
      </q-banner>
    </div>

    <!-- complete: show checklist output -->
    <div v-else-if="phase === 'complete'">
      <q-banner class="bg-positive text-white q-mb-md" rounded>
        <template #avatar><q-icon name="check_circle" /></template>
        {{ $t('coldStart.phase5.complete') }}
      </q-banner>
      <div v-if="checklistMd" class="checklist-output q-mt-md">
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div class="markdown-body" v-html="checklistHtml" />
      </div>
      <q-btn flat color="primary" :label="$t('coldStart.phase5.startButton')" size="sm" class="q-mt-md" @click="onStart" />
    </div>

    <q-banner v-if="errorMsg" class="bg-negative text-white q-mt-md" rounded>
      <template #avatar><q-icon name="error" /></template>
      {{ errorMsg }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { marked } from 'marked';
import { useColdStartStore } from 'src/stores/cold-start';
import { usePipelineRunPolling } from 'src/composables/usePipelineRunPolling';

type Phase = 'idle' | 'running' | 'complete';

export default defineComponent({
  name: 'Phase5GoLive',

  props: {
    slug: { type: String, required: true },
  },

  emits: ['done'],

  setup() {
    const runId = ref<string | null>(null);
    return {
      coldStartStore: useColdStartStore(),
      runId,
      polling: usePipelineRunPolling(runId),
    };
  },

  data: () => ({
    triggering: false,
    checklistMd: '',
    errorMsg: '',
  }),

  computed: {
    currentRun() { return this.polling.run.value; },

    phase(): Phase {
      const r = this.currentRun;
      if (r?.status === 'completed') return 'complete';
      if (r?.status === 'running' || r?.status === 'queued') return 'running';
      return 'idle';
    },

    checklistHtml(): string {
      if (!this.checklistMd) return '';
      const r = marked.parse(this.checklistMd);
      return typeof r === 'string' ? r : '';
    },
  },

  watch: {
    'polling.terminal.value'(isTerminal: boolean) {
      if (!isTerminal) return;
      const r = this.currentRun;
      if (r?.status === 'completed') {
        const out = r.output as { checklistMd?: string } | null;
        this.checklistMd = out?.checklistMd ?? '';
        this.$emit('done');
      } else if (r?.status === 'failed') {
        this.errorMsg = r.error ?? (this.$t('coldStart.phase5.failed') as string);
      }
    },
  },

  methods: {
    async onStart(): Promise<void> {
      this.triggering = true;
      this.errorMsg = '';
      try {
        const { runId } = await this.coldStartStore.triggerGoLive(this.slug);
        this.runId = runId;
      } catch {
        // shown by interceptor
      } finally {
        this.triggering = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.checklist-output {
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 6px;
  padding: 16px;
  font-size: 14px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}
</style>
