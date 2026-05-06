<template>
  <StepBase
    service="github_app"
    :description="$t('installer.steps.githubApp.description') as string"
    :consequence-if-skipped="$t('installer.steps.githubApp.consequenceIfSkipped') as string"
    :mode-note="modeNote"
    :status="systemStatusStore.adapters.githubApp"
    :fields="fields"
    @configured="$emit('configured')"
    @skipped="$emit('skipped')"
  >
    <template #default>
      <div class="row q-col-gutter-md">
        <div class="col-12">
          <q-input
            outlined
            v-model="appId"
            :label="$t('installer.steps.githubApp.fields.appId') as string"
            autocomplete="off"
          />
        </div>

        <div v-if="isLokal" class="col-12">
          <q-input
            outlined
            v-model="privateKeyPath"
            :label="$t('installer.steps.githubApp.fields.privateKeyPath') as string"
            autocomplete="off"
            :hint="$t('installer.steps.githubApp.hintPathPlaceholder') as string"
          />
        </div>

        <div v-else class="col-12">
          <q-input
            outlined
            v-model="privateKeyContent"
            :label="$t('installer.steps.githubApp.fields.privateKeyContent') as string"
            type="textarea"
            :rows="8"
            autocomplete="off"
            :hint="$t('installer.steps.githubApp.hintPemPlaceholder') as string"
          />
        </div>
      </div>
      <p class="text-caption q-mt-sm text-grey-7">{{ $t('installer.steps.githubApp.hint') }}</p>
    </template>
  </StepBase>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSystemStatusStore } from 'src/stores/system-status';
import StepBase from './StepBase.vue';

export default defineComponent({
  name: 'StepGithubApp',
  components: { StepBase },
  emits: ['configured', 'skipped'],
  setup() {
    return { systemStatusStore: useSystemStatusStore() };
  },
  data: () => ({
    appId: '',
    privateKeyPath: '',
    privateKeyContent: '',
  }),
  computed: {
    isLokal(): boolean {
      return this.systemStatusStore.deploymentMode === 'lokal';
    },
    modeNote(): string {
      return this.isLokal
        ? (this.$t('installer.steps.githubApp.modeNoteLokal') as string)
        : (this.$t('installer.steps.githubApp.modeNoteSelfHosted') as string);
    },
    fields(): { key: string; value: string }[] {
      const result: { key: string; value: string }[] = [
        { key: 'app_id', value: this.appId },
      ];
      if (this.isLokal) {
        result.push({ key: 'private_key_path', value: this.privateKeyPath });
      } else {
        result.push({ key: 'private_key_content', value: this.privateKeyContent });
      }
      return result;
    },
  },
});
</script>
