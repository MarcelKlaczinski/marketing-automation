<template>
  <StepBase
    service="r2"
    :description="$t('installer.steps.r2.description') as string"
    :consequence-if-skipped="$t('installer.steps.r2.consequenceIfSkipped') as string"
    :status="systemStatusStore.adapters.r2"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <div class="row q-col-gutter-md">
        <div class="col-12">
          <q-input
            outlined
            v-model="accountId"
            :label="$t('installer.steps.r2.fields.accountId') as string"
            autocomplete="off"
          />
        </div>
        <div class="col-12">
          <q-input
            outlined
            v-model="accessKeyId"
            :label="$t('installer.steps.r2.fields.accessKeyId') as string"
            autocomplete="off"
          />
        </div>
        <div class="col-12">
          <q-input
            outlined
            v-model="secretAccessKey"
            :label="$t('installer.steps.r2.fields.secretAccessKey') as string"
            type="password"
            autocomplete="off"
          />
        </div>
        <div class="col-12 col-sm-6">
          <q-input
            outlined
            v-model="bucket"
            :label="$t('installer.steps.r2.fields.bucket') as string"
            autocomplete="off"
          />
        </div>
        <div class="col-12 col-sm-6">
          <q-input
            outlined
            v-model="publicBaseUrl"
            :label="$t('installer.steps.r2.fields.publicBaseUrl') as string"
            autocomplete="off"
          />
        </div>
      </div>
      <p class="text-caption q-mt-sm text-grey-7">{{ $t('installer.steps.r2.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { useSystemStatusStore } from "src/stores/system-status";
import { defineComponent } from "vue";
import StepBase from "./StepBase.vue";

export default defineComponent({
  name: "StepR2",
  components: { StepBase },
  emits: ["configured", "skipped"],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  data: () => ({
    accountId: "",
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
    publicBaseUrl: "",
  }),
  computed: {
    fields(): { key: string; value: string }[] {
      return [
        { key: "account_id", value: this.accountId },
        { key: "access_key_id", value: this.accessKeyId },
        { key: "secret_access_key", value: this.secretAccessKey },
        { key: "bucket", value: this.bucket },
        { key: "public_base_url", value: this.publicBaseUrl },
      ];
    },
  },
});
</script>
