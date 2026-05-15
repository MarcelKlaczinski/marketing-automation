<template>
  <StepBase
    service="producthunt"
    :description="$t('installer.steps.producthunt.description') as string"
    :consequence-if-skipped="$t('installer.steps.producthunt.consequenceIfSkipped') as string"
    :status="systemStatusStore.adapters.producthunt"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <q-input
        outlined
        v-model="apiKey"
        :label="$t('installer.steps.producthunt.fields.apiKey') as string"
        type="password"
        :rules="[(v: string) => !!v || ($t('installer.validation.required') as string)]"
        autocomplete="off"
      />
      <q-input
        outlined
        v-model="apiSecret"
        :label="$t('installer.steps.producthunt.fields.apiSecret') as string"
        type="password"
        class="q-mt-sm"
        :rules="[(v: string) => !!v || ($t('installer.validation.required') as string)]"
        autocomplete="off"
      />
      <p class="text-caption q-mt-sm text-grey-7">{{ $t('installer.steps.producthunt.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { useSystemStatusStore } from "src/stores/system-status";
import { defineComponent } from "vue";
import StepBase from "./StepBase.vue";

export default defineComponent({
  name: "StepProducthunt",
  components: { StepBase },
  emits: ["configured", "skipped"],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  data: () => ({ apiKey: "", apiSecret: "" }),
  computed: {
    fields(): { key: string; value: string }[] {
      return [
        { key: "api_key",    value: this.apiKey },
        { key: "api_secret", value: this.apiSecret },
      ];
    },
  },
});
</script>
