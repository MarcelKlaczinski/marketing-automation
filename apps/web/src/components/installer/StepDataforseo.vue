<template>
  <StepBase
    service="dataforseo"
    :description="$t('installer.steps.dataforseo.description') as string"
    :consequence-if-skipped="$t('installer.steps.dataforseo.consequenceIfSkipped') as string"
    :status="systemStatusStore.adapters.dataforseo"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <div class="row q-col-gutter-md">
        <div class="col-12">
          <q-input
            outlined
            v-model="login"
            :label="$t('installer.steps.dataforseo.fields.login') as string"
            autocomplete="username"
          />
        </div>
        <div class="col-12">
          <q-input
            outlined
            v-model="password"
            :label="$t('installer.steps.dataforseo.fields.password') as string"
            type="password"
            autocomplete="new-password"
          />
        </div>
      </div>
      <p class="text-caption q-mt-sm text-grey-7">{{ $t('installer.steps.dataforseo.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';
import StepBase from './StepBase.vue';

export default defineComponent({
  name: 'StepDataforseo',
  components: { StepBase },
  emits: ['configured', 'skipped'],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  data: () => ({
    login: '',
    password: '',
  }),
  computed: {
    fields(): { key: string; value: string }[] {
      return [
        { key: 'login', value: this.login },
        { key: 'password', value: this.password },
      ];
    },
  },
});
</script>
