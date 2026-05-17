<template>
  <PhaseShell
    :current-phase="4"
    :title="$t('coldStart.phases.astro.title') as string"
    :description="$t('coldStart.phases.astro.description') as string"
    :can-skip="true"
    :busy="busy"
    @advance="onAdvance"
    @back="back()"
    @skip="onSkip"
  >
    <GlassCard variant="default" class="astro-info">
      <h3 class="astro-info-title">{{ $t("coldStart.phases.astro.info.title") as string }}</h3>
      <p>{{ $t("coldStart.phases.astro.info.description") as string }}</p>
      <p class="astro-skip-note">{{ $t("coldStart.phases.astro.info.skipNote") as string }}</p>
    </GlassCard>

    <FormField
      :label="$t('coldStart.phases.astro.fields.repoPath') as string"
      :helper="$t('coldStart.phases.astro.fields.repoPathHelper') as string"
    >
      <FormInput
        v-model="form.repoPath"
        placeholder="/Users/me/my-astro-blog"
      />
    </FormField>

    <FormField :label="$t('coldStart.phases.astro.fields.deployTarget') as string">
      <FormSelect v-model="form.deployTarget">
        <option
          v-for="opt in deployTargetOptions"
          :key="opt.value"
          :value="opt.value"
        >{{ $t(opt.labelKey) as string }}</option>
        <option value="other">{{ $t("common.other") as string }}</option>
      </FormSelect>
    </FormField>

    <FormField :label="$t('coldStart.phases.astro.fields.contentPath') as string">
      <FormInput
        v-model="form.contentPath"
        placeholder="src/content"
      />
    </FormField>
  </PhaseShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useColdStartDraft } from "src/composables/useColdStartDraft";
import { apiPost } from "src/lib/api";
import PhaseShell from "src/components/cold-start/PhaseShell.vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FormSelect from "src/components/forms/FormSelect.vue";

export default defineComponent({
  name: "ColdStartPhase4Astro",

  components: { PhaseShell, GlassCard, FormField, FormInput, FormSelect },

  setup() {
    return useColdStartDraft();
  },

  data: () => ({
    busy: false,
    form: {
      repoPath: "",
      deployTarget: "vercel",
      contentPath: "src/content",
    },
  }),

  computed: {
    deployTargetOptions(): Array<{ value: string; labelKey: string }> {
      return [
        { value: "vercel", labelKey: "coldStart.phases.astro.deployTargets.vercel" },
        { value: "netlify", labelKey: "coldStart.phases.astro.deployTargets.netlify" },
        {
          value: "cloudflare-pages",
          labelKey: "coldStart.phases.astro.deployTargets.cloudflarePages",
        },
        {
          value: "self-hosted",
          labelKey: "coldStart.phases.astro.deployTargets.selfHosted",
        },
      ];
    },
  },

  watch: {
    draft: {
      immediate: true,
      handler(newDraft) {
        if (!newDraft) return;
        this.form.repoPath = newDraft.astroRepoPath ?? "";
        this.form.deployTarget = newDraft.deployTarget ?? "vercel";
        this.form.contentPath = newDraft.astroContentPath ?? "src/content";
      },
    },
  },

  methods: {
    async onAdvance(): Promise<void> {
      this.busy = true;
      try {
        if (this.form.repoPath) {
          await apiPost(`/cold-start/${this.draftId}/connect-astro`, {
            repoPath: this.form.repoPath,
            deployTarget: this.form.deployTarget,
            contentPath: this.form.contentPath,
          });
        }
        await this.advance();
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("errors.generic") as string),
        });
      } finally {
        this.busy = false;
      }
    },
    async onSkip(): Promise<void> {
      this.busy = true;
      try {
        await this.advance();
      } finally {
        this.busy = false;
      }
    },
  },
});
</script>

<style scoped>
.astro-info {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.astro-info-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.astro-info p {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
}

.astro-skip-note {
  font-size: 12px !important;
  color: var(--text-tertiary) !important;
  font-style: italic;
}
</style>
