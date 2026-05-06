<template>
  <StepBase
    service="anthropic"
    :description="$t('installer.steps.anthropic.description') as string"
    :consequence-if-skipped="$t('installer.steps.anthropic.consequenceIfSkipped') as string"
    :status="systemStatusStore.adapters.anthropic"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <q-input
            outlined
        v-model="apiKey"
        :label="$t('installer.steps.anthropic.fields.apiKey') as string"
        type="password"
        :rules="[(v: string) => !!v || ($t('installer.validation.required') as string)]"
        autocomplete="off"
      />
      <p class="text-caption q-mt-sm text-grey-7">{{ $t('installer.steps.anthropic.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';
import StepBase from './StepBase.vue';

export default defineComponent({
  name: 'StepAnthropic',
  components: { StepBase },
  emits: ['configured', 'skipped'],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  data: () => ({ apiKey: '' }),
  computed: {
    fields(): { key: string; value: string }[] {
      return [{ key: 'api_key', value: this.apiKey }];
    },
  },
});
</script>
