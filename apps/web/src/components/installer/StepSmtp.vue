<template>
  <StepBase
    service="smtp"
    :description="$t('installer.steps.smtp.description') as string"
    :consequence-if-skipped="$t('installer.steps.smtp.consequenceIfSkipped') as string"
    :status="systemStatusStore.adapters.smtp"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <div class="row q-col-gutter-md">
        <div class="col-12 col-sm-8">
          <q-input
            outlined
            v-model="host"
            :label="$t('installer.steps.smtp.fields.host') as string"
            :rules="[(v: string) => !!v || ($t('installer.validation.required') as string)]"
            autocomplete="off"
          />
        </div>
        <div class="col-12 col-sm-4">
          <q-input
            outlined
            v-model="port"
            :label="$t('installer.steps.smtp.fields.port') as string"
            type="number"
            :rules="[(v: string) => !!v || ($t('installer.validation.required') as string)]"
            autocomplete="off"
          />
        </div>
        <div class="col-12">
          <q-input
            outlined
            v-model="user"
            :label="$t('installer.steps.smtp.fields.user') as string"
            autocomplete="username"
          />
        </div>
        <div class="col-12">
          <q-input
            outlined
            v-model="password"
            :label="$t('installer.steps.smtp.fields.password') as string"
            type="password"
            autocomplete="new-password"
          />
        </div>
        <div class="col-12">
          <q-input
            outlined
            v-model="fromAddress"
            :label="$t('installer.steps.smtp.fields.fromAddress') as string"
            type="email"
            autocomplete="off"
          />
        </div>
      </div>
      <p class="text-caption q-mt-sm text-grey-7">{{ $t('installer.steps.smtp.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { useSystemStatusStore } from "src/stores/system-status";
import { defineComponent } from "vue";
import StepBase from "./StepBase.vue";

export default defineComponent({
  name: "StepSmtp",
  components: { StepBase },
  emits: ["configured", "skipped"],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  data: () => ({
    host: "",
    port: "587",
    user: "",
    password: "",
    fromAddress: "",
  }),
  computed: {
    fields(): { key: string; value: string }[] {
      return [
        { key: "host", value: this.host },
        { key: "port", value: this.port },
        { key: "user", value: this.user },
        { key: "password", value: this.password },
        { key: "from_address", value: this.fromAddress },
      ];
    },
  },
});
</script>
