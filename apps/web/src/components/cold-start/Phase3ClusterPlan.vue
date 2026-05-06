<template>
  <div class="q-pt-md">
    <!-- idle -->
    <div v-if="phase === 'idle'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase3.idleDescription') }}</p>
      <q-btn color="primary" :label="$t('coldStart.phase3.startButton')" :loading="triggering" unelevated @click="onStart" />
    </div>

    <!-- running -->
    <div v-else-if="phase === 'running'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ $t('coldStart.phase3.running') }}
      </q-banner>
    </div>

    <!-- complete -->
    <div v-else-if="phase === 'complete'">
      <q-banner class="bg-positive text-white q-mb-md" rounded>
        <template #avatar><q-icon name="check_circle" /></template>
        {{ $t('coldStart.phase3.complete') }}
      </q-banner>
      <q-btn flat color="primary" :label="$t('coldStart.phase3.regenerate')" size="sm" @click="onStart" />
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

export default defineComponent({
  name: 'Phase3ClusterPlan',

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
  },

  watch: {
    'polling.terminal.value'(isTerminal: boolean) {
      if (!isTerminal) return;
      const r = this.currentRun;
      if (r?.status === 'completed') {
        this.$emit('done');
      } else if (r?.status === 'failed') {
        this.errorMsg = r.error ?? (this.$t('coldStart.phase3.failed') as string);
      }
    },
  },

  methods: {
    async onStart(): Promise<void> {
      this.triggering = true;
      this.errorMsg = '';
      try {
        const { runId } = await this.coldStartStore.triggerClusterPlan(this.slug);
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
