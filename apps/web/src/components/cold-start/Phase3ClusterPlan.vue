<template>
  <div class="q-pt-md">
    <!-- auto-imported from frontmatter (Spec 49a) -->
    <div v-if="isImportedComplete">
      <q-banner class="bg-positive text-white q-mb-md" rounded>
        <template #avatar><q-icon name="auto_awesome" /></template>
        {{ $t('coldStart.phase3.importedComplete', { count: importedClusterCount }) }}
      </q-banner>

      <q-expansion-item
        icon="add_circle_outline"
        :label="$t('coldStart.phase3.optInLabel')"
        header-class="text-weight-medium"
      >
        <q-card flat>
          <q-card-section>
            <p class="text-body2 q-mb-md">{{ $t('coldStart.phase3.optInDescription') }}</p>

            <q-banner class="bg-blue-1 q-mb-md" rounded>
              <template #avatar>
                <q-icon name="info" color="blue-9" />
              </template>
              <strong>{{ $t('coldStart.phase3.brownfieldMode') }}:</strong>
              {{ $t('coldStart.phase3.brownfieldExplanation', { count: importedClusterCount }) }}
            </q-banner>

            <!-- TODO: Pass existing cluster names to pipeline to avoid duplicate suggestions.
                 Currently the pipeline doesn't know about imported clusters → User must
                 manually filter duplicates after generation. Backend enhancement needed. -->
            <q-btn
              unelevated
              color="primary"
              :label="$t('coldStart.phase3.generateAdditional')"
              :loading="generatingAdditional"
              :disable="generatingAdditional"
              @click="onGenerateAdditional"
            />
          </q-card-section>
        </q-card>
      </q-expansion-item>
    </div>

    <!-- idle (no clusters yet, no import) -->
    <div v-else-if="phase === 'idle'">
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

    <!-- complete via pipeline run -->
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
import { usePipelineRunPolling } from "src/composables/usePipelineRunPolling";
import { useColdStartStore } from "src/stores/cold-start";
import { defineComponent, ref } from "vue";

type Phase = "idle" | "running" | "complete";

export default defineComponent({
  name: "Phase3ClusterPlan",

  props: {
    slug: { type: String, required: true },
  },

  emits: ["done"],

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
    generatingAdditional: false,
    errorMsg: "",
  }),

  computed: {
    currentRun() {
      return this.polling.run.value;
    },

    phase(): Phase {
      const r = this.currentRun;
      if (r?.status === "completed") return "complete";
      if (r?.status === "running" || r?.status === "queued") return "running";
      return "idle";
    },

    // Spec 49a: clusters were auto-imported from frontmatter — no pipeline run needed
    clusterStatus() {
      return this.coldStartStore.statusByProject[this.slug]?.clusters ?? null;
    },

    isImportedComplete(): boolean {
      const cs = this.clusterStatus;
      return cs?.source === "imported" && cs?.status === "complete" && this.phase === "idle";
    },

    importedClusterCount(): number {
      return this.clusterStatus?.count ?? 0;
    },
  },

  watch: {
    "polling.terminal.value"(isTerminal: boolean) {
      if (!isTerminal) return;
      const r = this.currentRun;
      if (r?.status === "completed") {
        this.$emit("done");
      } else if (r?.status === "failed") {
        this.errorMsg = r.error ?? (this.$t("coldStart.phase3.failed") as string);
      }
    },
  },

  methods: {
    async onStart(): Promise<void> {
      this.triggering = true;
      this.errorMsg = "";
      try {
        const { runId } = await this.coldStartStore.triggerClusterPlan(this.slug);
        this.runId = runId;
      } catch {
        // shown by interceptor
      } finally {
        this.triggering = false;
      }
    },

    async onGenerateAdditional(): Promise<void> {
      this.generatingAdditional = true;
      this.errorMsg = "";
      try {
        const { runId } = await this.coldStartStore.triggerClusterPlan(this.slug);
        this.runId = runId;
      } catch {
        // shown by interceptor
      } finally {
        this.generatingAdditional = false;
      }
    },
  },
});
</script>
