<template>
  <PhaseShell
    :current-phase="2"
    :title="$t('coldStart.phases.brand.title') as string"
    :description="$t('coldStart.phases.brand.description') as string"
    :can-advance="isValid"
    :can-skip="!hasBrandData"
    :busy="busy"
    @advance="onAdvance"
    @back="back()"
    @skip="onSkip"
  >
    <!-- Pre-discovery state -->
    <div v-if="!hasBrandData && discoveryStatus !== 'running'" class="discovery-prompt">
      <GlassCard variant="strong" class="discovery-card">
        <h3 class="discovery-card-title">
          {{ $t("coldStart.phases.brand.discovery.title") as string }}
        </h3>
        <p class="discovery-card-desc">
          {{ $t("coldStart.phases.brand.discovery.description") as string }}
        </p>

        <FormField :label="$t('coldStart.phases.brand.fields.domain') as string">
          <FormInput
            v-model="discoveryDomain"
            :placeholder="$t('coldStart.phases.brand.placeholders.domain') as string"
            inputmode="url"
          />
        </FormField>

        <div class="discovery-actions">
          <GlassButton
            variant="primary"
            :disabled="!discoveryDomain"
            :loading="startingDiscovery"
            @click="onStartDiscovery"
          >
            {{ $t("coldStart.phases.brand.discovery.start") as string }}
          </GlassButton>
          <GlassButton variant="ghost" @click="onEnterManually">
            {{ $t("coldStart.phases.brand.discovery.enterManually") as string }}
          </GlassButton>
        </div>
      </GlassCard>
    </div>

    <!-- Discovery running -->
    <div v-else-if="discoveryStatus === 'running'" class="discovery-running">
      <LoadingShimmer variant="card" height="120px" />
      <div class="running-text">
        <h3>{{ $t("coldStart.phases.brand.discovering.title") as string }}</h3>
        <p>{{ $t("coldStart.phases.brand.discovering.description") as string }}</p>
      </div>
    </div>

    <!-- Brand data available or manual entry mode -->
    <template v-else>
      <div class="brand-edit-header">
        <h3>{{ $t("coldStart.phases.brand.review.title") as string }}</h3>
        <p>{{ $t("coldStart.phases.brand.review.description") as string }}</p>
      </div>

      <FormField :label="$t('coldStart.phases.brand.fields.primary') as string">
        <div class="color-input-row">
          <input
            type="color"
            :value="form.colors.primary"
            class="color-picker"
            :aria-label="$t('coldStart.phases.brand.fields.primary') as string"
            @input="form.colors.primary = ($event.target as HTMLInputElement).value"
          />
          <FormInput v-model="form.colors.primary" />
        </div>
      </FormField>

      <FormField :label="$t('coldStart.phases.brand.fields.secondary') as string">
        <div class="color-input-row">
          <input
            type="color"
            :value="form.colors.secondary"
            class="color-picker"
            :aria-label="$t('coldStart.phases.brand.fields.secondary') as string"
            @input="form.colors.secondary = ($event.target as HTMLInputElement).value"
          />
          <FormInput v-model="form.colors.secondary" />
        </div>
      </FormField>

      <FormField :label="$t('coldStart.phases.brand.fields.headingFont') as string">
        <FormSelect v-model="form.headingFont">
          <option v-for="font in fontOptions" :key="font" :value="font">{{ font }}</option>
        </FormSelect>
      </FormField>

      <FormField :label="$t('coldStart.phases.brand.fields.voice') as string">
        <FormTextarea
          v-model="form.voiceDescription"
          :placeholder="$t('coldStart.phases.brand.placeholders.voice') as string"
          :rows="4"
        />
      </FormField>

      <GlassButton variant="ghost" :loading="startingDiscovery" @click="onRediscover">
        {{ $t("coldStart.phases.brand.rediscover") as string }}
      </GlassButton>
    </template>
  </PhaseShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useColdStartDraft } from "src/composables/useColdStartDraft";
import { apiPost } from "src/lib/api";
import PhaseShell from "src/components/cold-start/PhaseShell.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FormTextarea from "src/components/forms/FormTextarea.vue";
import FormSelect from "src/components/forms/FormSelect.vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";

export default defineComponent({
  name: "ColdStartPhase2Brand",

  components: {
    PhaseShell,
    FormField,
    FormInput,
    FormTextarea,
    FormSelect,
    GlassCard,
    GlassButton,
    LoadingShimmer,
  },

  setup() {
    return useColdStartDraft();
  },

  data: () => ({
    manualMode: false,
    startingDiscovery: false,
    busy: false,
    discoveryDomain: "",
    form: {
      colors: { primary: "#7c5cff", secondary: "#dc267f" },
      headingFont: "Inter",
      voiceDescription: "",
    },
  }),

  computed: {
    discoveryStatus(): string {
      return this.state?.brandDiscoveryStatus ?? "idle";
    },
    hasBrandData(): boolean {
      return this.manualMode || !!this.draft?.brandTokens;
    },
    isValid(): boolean {
      // Can advance if brand data present or manual mode with some data
      return this.hasBrandData && !!this.form.colors.primary;
    },
    fontOptions(): string[] {
      return ["Inter", "Geist", "Roboto", "DM Sans", "Lato", "Open Sans", "Poppins", "Raleway"];
    },
  },

  watch: {
    draft: {
      immediate: true,
      handler(newDraft) {
        if (!newDraft) return;
        // Pre-fill discovery domain from phase 1 if available
        if (newDraft.domain && !this.discoveryDomain) {
          this.discoveryDomain = newDraft.domain;
        }
        // Populate form when brand tokens arrive (post-discovery)
        if (newDraft.brandTokens) {
          this.form.colors.primary = newDraft.brandTokens.colors?.primary ?? "#7c5cff";
          this.form.colors.secondary = newDraft.brandTokens.colors?.secondary ?? "#dc267f";
          this.form.headingFont = newDraft.brandTokens.typography?.headingFont ?? "Inter";
          this.form.voiceDescription = newDraft.brandTokens.voice?.description ?? "";
        }
      },
    },
  },

  methods: {
    async onStartDiscovery(): Promise<void> {
      if (!this.discoveryDomain) return;
      this.startingDiscovery = true;
      try {
        await apiPost(`/cold-start/${this.draftId}/brand-discovery`, {
          domain: this.discoveryDomain,
        });
        // State polling (refetchInterval) will pick up running status automatically
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("errors.generic") as string),
        });
      } finally {
        this.startingDiscovery = false;
      }
    },
    onEnterManually(): void {
      this.manualMode = true;
    },
    async onRediscover(): Promise<void> {
      this.manualMode = false;
      await this.onStartDiscovery();
    },
    async onAdvance(): Promise<void> {
      if (!this.isValid) return;
      this.busy = true;
      try {
        await this.updateDraft({
          brandTokens: {
            colors: {
              primary: this.form.colors.primary,
              secondary: this.form.colors.secondary,
            },
            typography: { headingFont: this.form.headingFont },
            voice: { description: this.form.voiceDescription },
          },
        });
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
.discovery-card {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.discovery-card-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.discovery-card-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.6;
}

.discovery-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.discovery-running {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 16px 0;
  text-align: center;
}

.running-text h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.running-text p {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.brand-edit-header {
  text-align: center;
}

.brand-edit-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.brand-edit-header p {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.color-input-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.color-picker {
  width: 40px;
  height: 36px;
  padding: 2px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-glass);
  cursor: pointer;
  flex-shrink: 0;
}

.color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}

.color-picker::-webkit-color-swatch {
  border-radius: 3px;
  border: none;
}
</style>
