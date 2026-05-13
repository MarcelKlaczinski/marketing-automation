<template>
  <q-dialog v-model="show" persistent>
    <q-card style="min-width: 480px; max-width: 560px">
      <q-card-section>
        <div class="text-h6">{{ $t('articles.discoveryGate.title') }}</div>
        <p class="text-body2 q-mt-sm">
          {{ $t('articles.discoveryGate.subtitle', { count: stats.inserted + stats.updated }) }}
        </p>

        <q-list dense class="q-mt-sm">
          <q-item>
            <q-item-section>{{ $t('articles.discoveryGate.new') }}</q-item-section>
            <q-item-section side>
              <q-badge color="primary">{{ stats.inserted }}</q-badge>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section>{{ $t('articles.discoveryGate.updated') }}</q-item-section>
            <q-item-section side>
              <q-badge color="secondary">{{ stats.updated }}</q-badge>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section>{{ $t('articles.discoveryGate.unchanged') }}</q-item-section>
            <q-item-section side>
              <q-badge color="grey">{{ stats.unchanged }}</q-badge>
            </q-item-section>
          </q-item>
        </q-list>

        <p class="text-caption q-mt-md text-grey-7">
          {{ $t('articles.discoveryGate.costEstimate', { cost: costEstimate }) }}
        </p>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :label="$t('articles.discoveryGate.skipBtn') as string" v-close-popup @click="onSkip" />
        <q-btn
          flat
          :label="$t('articles.discoveryGate.deterministicBtn') as string"
          :loading="triggering"
          @click="onTrigger('deterministic_only')"
        />
        <q-btn
          unelevated
          color="primary"
          :label="$t('articles.discoveryGate.fullBtn') as string"
          :loading="triggering"
          @click="onTrigger('full')"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { api } from 'src/lib/api-client';
import { Notify } from 'quasar';

export default defineComponent({
  name: 'DiscoveryGateModal',

  props: {
    modelValue: { type: Boolean, required: true },
    projectSlug: { type: String, required: true },
    importRunId: { type: String, required: true },
    stats: {
      type: Object as () => { inserted: number; updated: number; unchanged: number },
      required: true,
    },
  },

  emits: ['update:modelValue', 'triggered', 'skipped'],

  data: () => ({
    show: false,
    triggering: false,
  }),

  computed: {
    costEstimate(): string {
      return ((this.stats.inserted + this.stats.updated) * 0.005).toFixed(2);
    },
  },

  watch: {
    modelValue(v: boolean) { this.show = v; },
    show(v: boolean) { this.$emit('update:modelValue', v); },
  },

  methods: {
    async onTrigger(mode: 'full' | 'deterministic_only'): Promise<void> {
      this.triggering = true;
      try {
        await api.post(
          `/projects/${this.projectSlug}/astro-import/${this.importRunId}/trigger-discovery`,
          { mode },
        );
        Notify.create({
          type: 'positive',
          message: this.$t('articles.discoveryGate.triggered') as string,
          timeout: 3000,
        });
        this.$emit('triggered', { mode });
        this.show = false;
      } finally {
        this.triggering = false;
      }
    },

    onSkip(): void {
      this.$emit('skipped');
    },
  },
});
</script>
