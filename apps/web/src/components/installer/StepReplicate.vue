<template>
  <StepBase
    service="replicate"
    :description="$t('installer.steps.replicate.description') as string"
    :consequence-if-skipped="$t('installer.steps.replicate.consequenceIfSkipped') as string"
    :status="systemStatusStore.adapters.replicate"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <q-input
            outlined
        v-model="apiToken"
        :label="$t('installer.steps.replicate.fields.apiToken') as string"
        type="password"
        :rules="[(v: string) => !!v || ($t('installer.validation.required') as string)]"
        autocomplete="off"
      />
      <p class="text-caption q-mt-sm text-grey-7">{{ $t('installer.steps.replicate.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';
import StepBase from './StepBase.vue';

export default defineComponent({
  name: 'StepReplicate',
  components: { StepBase },
  emits: ['configured', 'skipped'],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  data: () => ({ apiToken: '' }),
  computed: {
    fields(): { key: string; value: string }[] {
      return [{ key: 'api_token', value: this.apiToken }];
    },
  },
});
</script>
