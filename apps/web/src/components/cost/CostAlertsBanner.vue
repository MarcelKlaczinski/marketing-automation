<template>
  <q-banner class="bg-warning text-dark q-mb-md">
    <template #avatar>
      <q-icon name="warning" size="28px" />
    </template>
    <div class="text-subtitle1 text-weight-bold q-mb-sm">
      {{ $t('cost.alerts.title', { count: alerts.length }) }}
    </div>
    <q-list dense>
      <q-item v-for="alert in alerts" :key="alert.id" class="q-px-none">
        <q-item-section>
          <q-item-label>
            <strong>{{ alert.projectName ?? '—' }}</strong> · {{ alert.service }}
          </q-item-label>
          <q-item-label caption>
            {{ alert.thresholdType }}: € {{ formatEur(alert.spentEur) }} / € {{ formatEur(alert.limitEur) }}
            ({{ alert.percent }}%)
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn
            flat
            dense
            size="sm"
            :label="$t('common.acknowledge') as string"
            @click="$emit('acknowledge', alert.id)"
          />
        </q-item-section>
      </q-item>
    </q-list>
  </q-banner>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { CostAlert } from 'src/stores/cost';

export default defineComponent({
  name: 'CostAlertsBanner',

  props: {
    alerts: { type: Array as PropType<CostAlert[]>, required: true },
  },

  emits: ['acknowledge'],

  methods: {
    formatEur(value: string): string {
      return parseFloat(value).toFixed(2);
    },
  },
});
</script>
