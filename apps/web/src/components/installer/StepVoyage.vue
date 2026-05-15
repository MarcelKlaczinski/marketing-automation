<template>
  <StepBase
    service="voyage"
    :description="$t('installer.steps.voyage.description') as string"
    :consequence-if-skipped="$t('installer.steps.voyage.consequenceIfSkipped') as string"
    :status="systemStatusStore.adapters.voyage"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <q-input
        outlined
        v-model="apiKey"
        :label="$t('installer.steps.voyage.fields.apiKey') as string"
        type="password"
        :rules="[(v: string) => !!v || ($t('installer.validation.required') as string)]"
        autocomplete="off"
      />
      <p class="text-caption q-mt-sm text-grey-7">{{ $t('installer.steps.voyage.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { useSystemStatusStore } from "src/stores/system-status";
import { defineComponent } from "vue";
import StepBase from "./StepBase.vue";

export default defineComponent({
  name: "StepVoyage",
  components: { StepBase },
  emits: ["configured", "skipped"],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  data: () => ({ apiKey: "" }),
  computed: {
    fields(): { key: string; value: string }[] {
      return [{ key: "api_key", value: this.apiKey }];
    },
  },
});
</script>
