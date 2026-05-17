<template>
  <div class="brand-tokens-form-editor">
    <!-- Colors -->
    <FormSection
      :title="$t('settings.brandTokens.colors.title')"
      :dirty="colorsForm.dirty.value"
      :saving="colorsForm.saving.value"
      :last-saved-at="colorsForm.lastSavedAt.value ?? ''"
      @save="colorsForm.save()"
      @cancel="colorsForm.cancel()"
    >
      <FormField :label="$t('settings.brandTokens.colors.primary')">
        <div class="color-input-row">
          <input
            type="color"
            v-model="colorsForm.formData.value.primary"
            class="color-picker"
          />
          <FormInput
            v-model="colorsForm.formData.value.primary"
            placeholder="#7c5cff"
            autocomplete="off"
          />
          <div
            class="color-preview"
            :style="{ background: colorsForm.formData.value.primary || 'transparent' }"
          />
        </div>
      </FormField>

      <FormField :label="$t('settings.brandTokens.colors.accent')">
        <div class="color-input-row">
          <input
            type="color"
            v-model="colorsForm.formData.value.accent"
            class="color-picker"
          />
          <FormInput
            v-model="colorsForm.formData.value.accent"
            placeholder="#ff6b6b"
            autocomplete="off"
          />
          <div
            class="color-preview"
            :style="{ background: colorsForm.formData.value.accent || 'transparent' }"
          />
        </div>
      </FormField>

      <FormField :label="$t('settings.brandTokens.colors.surface')">
        <div class="color-input-row">
          <input
            type="color"
            v-model="colorsForm.formData.value.surface"
            class="color-picker"
          />
          <FormInput
            v-model="colorsForm.formData.value.surface"
            placeholder="#ffffff"
            autocomplete="off"
          />
          <div
            class="color-preview"
            :style="{ background: colorsForm.formData.value.surface || 'transparent' }"
          />
        </div>
      </FormField>
    </FormSection>

    <!-- Typography -->
    <FormSection
      :title="$t('settings.brandTokens.typography.title')"
      :dirty="typographyForm.dirty.value"
      :saving="typographyForm.saving.value"
      :last-saved-at="typographyForm.lastSavedAt.value ?? ''"
      @save="typographyForm.save()"
      @cancel="typographyForm.cancel()"
    >
      <FormField :label="$t('settings.brandTokens.typography.headingFont')">
        <FormSelect v-model="typographyForm.formData.value.fontFamily">
          <option value="Inter">Inter</option>
          <option value="DM Sans">DM Sans</option>
          <option value="Geist">Geist</option>
          <option value="Manrope">Manrope</option>
          <option value="">{{ $t("settings.brandTokens.typography.customFont") }}</option>
        </FormSelect>
      </FormField>

      <FormField
        v-if="typographyForm.formData.value.fontFamily === ''"
        :label="$t('settings.brandTokens.typography.headingFontCustom')"
      >
        <FormInput
          v-model="typographyForm.formData.value.fontFamilyCustom"
          placeholder="e.g. Neue Haas Grotesk"
          autocomplete="off"
        />
      </FormField>
    </FormSection>

    <!-- Voice -->
    <FormSection
      :title="$t('settings.brandTokens.voice.title')"
      :dirty="voiceForm.dirty.value"
      :saving="voiceForm.saving.value"
      :last-saved-at="voiceForm.lastSavedAt.value ?? ''"
      @save="voiceForm.save()"
      @cancel="voiceForm.cancel()"
    >
      <FormField :label="$t('settings.brandTokens.voice.addressForm')">
        <FormSelect v-model="voiceForm.formData.value.addressForm">
          <option value="du">{{ $t("settings.brandTokens.voice.addressDu") }}</option>
          <option value="Sie">{{ $t("settings.brandTokens.voice.addressSie") }}</option>
        </FormSelect>
      </FormField>

      <FormField
        :label="$t('settings.brandTokens.voice.forbiddenWords')"
        :helper="$t('settings.brandTokens.voice.forbiddenWordsHelper')"
      >
        <FormTextarea
          v-model="voiceForm.formData.value.forbiddenWords"
          :rows="3"
        />
      </FormField>

      <FormField
        :label="$t('settings.brandTokens.voice.signaturePhrases')"
        :helper="$t('settings.brandTokens.voice.signaturePhrasesHelper')"
      >
        <FormTextarea
          v-model="voiceForm.formData.value.signaturePhrases"
          :rows="3"
        />
      </FormField>
    </FormSection>

    <!-- Social identity -->
    <FormSection
      :title="$t('settings.brandTokens.social.title')"
      :dirty="socialForm.dirty.value"
      :saving="socialForm.saving.value"
      :last-saved-at="socialForm.lastSavedAt.value ?? ''"
      @save="socialForm.save()"
      @cancel="socialForm.cancel()"
    >
      <FormField :label="$t('settings.brandTokens.social.instagramHandle')">
        <FormInput
          v-model="socialForm.formData.value.instagramHandle"
          placeholder="@yourhandle"
          autocomplete="off"
        />
      </FormField>

      <FormField :label="$t('settings.brandTokens.social.websiteUrl')">
        <FormInput
          v-model="socialForm.formData.value.websiteUrl"
          placeholder="https://example.com"
          inputmode="url"
          autocomplete="off"
        />
      </FormField>
    </FormSection>

    <!-- Social media colors -->
    <FormSection
      :title="$t('settings.brandTokens.socialColors.title')"
      :description="$t('settings.brandTokens.socialColors.description')"
      :dirty="socialColorsForm.dirty.value"
      :saving="socialColorsForm.saving.value"
      :last-saved-at="socialColorsForm.lastSavedAt.value ?? ''"
      @save="socialColorsForm.save()"
      @cancel="socialColorsForm.cancel()"
    >
      <FormField
        :label="$t('settings.brandTokens.socialColors.eyebrowColor')"
        :helper="$t('settings.brandTokens.socialColors.eyebrowColorHelper')"
      >
        <div class="color-input-row">
          <input type="color" v-model="socialColorsForm.formData.value.eyebrowColor" class="color-picker" />
          <FormInput v-model="socialColorsForm.formData.value.eyebrowColor" placeholder="#85f0c8" autocomplete="off" />
          <div class="color-preview" :style="{ background: socialColorsForm.formData.value.eyebrowColor || 'transparent' }" />
        </div>
      </FormField>

      <FormField
        :label="$t('settings.brandTokens.socialColors.surfaceSecondary')"
        :helper="$t('settings.brandTokens.socialColors.surfaceSecondaryHelper')"
      >
        <div class="color-input-row">
          <input type="color" v-model="socialColorsForm.formData.value.surfaceSecondary" class="color-picker" />
          <FormInput v-model="socialColorsForm.formData.value.surfaceSecondary" placeholder="#1e2635" autocomplete="off" />
          <div class="color-preview" :style="{ background: socialColorsForm.formData.value.surfaceSecondary || 'transparent' }" />
        </div>
      </FormField>

      <div class="pricing-colors-group">
        <div class="pricing-colors-label">{{ $t("settings.brandTokens.socialColors.pricingColors") as string }}</div>

        <FormField :label="$t('settings.brandTokens.socialColors.pricingFree')">
          <div class="color-input-row">
            <input type="color" v-model="socialColorsForm.formData.value.pricingFree" class="color-picker" />
            <FormInput v-model="socialColorsForm.formData.value.pricingFree" placeholder="#22c55e" autocomplete="off" />
            <div class="color-preview" :style="{ background: socialColorsForm.formData.value.pricingFree || 'transparent' }" />
          </div>
        </FormField>

        <FormField :label="$t('settings.brandTokens.socialColors.pricingFreemium')">
          <div class="color-input-row">
            <input type="color" v-model="socialColorsForm.formData.value.pricingFreemium" class="color-picker" />
            <FormInput v-model="socialColorsForm.formData.value.pricingFreemium" placeholder="#3b82f6" autocomplete="off" />
            <div class="color-preview" :style="{ background: socialColorsForm.formData.value.pricingFreemium || 'transparent' }" />
          </div>
        </FormField>

        <FormField :label="$t('settings.brandTokens.socialColors.pricingPaid')">
          <div class="color-input-row">
            <input type="color" v-model="socialColorsForm.formData.value.pricingPaid" class="color-picker" />
            <FormInput v-model="socialColorsForm.formData.value.pricingPaid" placeholder="#f59e0b" autocomplete="off" />
            <div class="color-preview" :style="{ background: socialColorsForm.formData.value.pricingPaid || 'transparent' }" />
          </div>
        </FormField>
      </div>
    </FormSection>
  </div>
</template>

<script lang="ts">
import { defineComponent, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import FormSection from "src/components/forms/FormSection.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FormSelect from "src/components/forms/FormSelect.vue";
import FormTextarea from "src/components/forms/FormTextarea.vue";
import { useSectionForm } from "src/composables/useSectionForm";
import { useProjectStore } from "src/stores/project";
import { apiGet, apiPatch } from "src/lib/api";

interface BrandTokensResponse {
  colors?: {
    primary?: string;
    accent?: string;
    surface?: string;
    surfaceSecondary?: string;
    eyebrowColor?: string;
    pricingFree?: string;
    pricingFreemium?: string;
    pricingPaid?: string;
  };
  typography?: {
    fontFamily?: string;
  };
  voice?: {
    addressForm?: string;
    forbiddenWords?: string[];
    signaturePhrases?: string[];
  };
  social?: {
    instagramHandle?: string;
    websiteUrl?: string;
  };
}

const KNOWN_FONTS = ["Inter", "DM Sans", "Geist", "Manrope"];

export default defineComponent({
  name: "BrandTokensFormEditor",

  components: { FormSection, FormField, FormInput, FormSelect, FormTextarea },

  setup() {
    const projectStore = useProjectStore();
    const slug = projectStore.currentSlug ?? "";

    const { data: tokens } = useQuery({
      queryKey: ["brand-tokens", slug],
      queryFn: () =>
        apiGet<{ tokens: BrandTokensResponse; defaults: BrandTokensResponse }>(
          `/projects/${slug}/brand-tokens`,
        ).then((d) => d.tokens),
    });

    const colorsForm = useSectionForm({
      initialData: () => ({
        primary: tokens.value?.colors?.primary ?? "",
        accent: tokens.value?.colors?.accent ?? "",
        surface: tokens.value?.colors?.surface ?? "",
      }),
      onSave: (data) =>
        apiPatch(`/projects/${slug}/brand-tokens`, {
          tokens: { colors: { primary: data.primary || undefined, accent: data.accent || undefined, surface: data.surface || undefined } },
        }),
      invalidateKeys: [["brand-tokens", slug]],
    });

    const typographyForm = useSectionForm({
      initialData: () => {
        const ff = tokens.value?.typography?.fontFamily ?? "";
        return {
          fontFamily: KNOWN_FONTS.includes(ff) ? ff : "",
          fontFamilyCustom: KNOWN_FONTS.includes(ff) ? "" : ff,
        };
      },
      onSave: (data) => {
        const resolved = data.fontFamily || data.fontFamilyCustom || undefined;
        return apiPatch(`/projects/${slug}/brand-tokens`, {
          tokens: { typography: { fontFamily: resolved } },
        });
      },
      invalidateKeys: [["brand-tokens", slug]],
    });

    const voiceForm = useSectionForm({
      initialData: () => ({
        addressForm: tokens.value?.voice?.addressForm ?? "du",
        forbiddenWords: (tokens.value?.voice?.forbiddenWords ?? []).join(", "),
        signaturePhrases: (tokens.value?.voice?.signaturePhrases ?? []).join("\n"),
      }),
      onSave: (data) =>
        apiPatch(`/projects/${slug}/brand-tokens`, {
          tokens: {
            voice: {
              addressForm: data.addressForm || undefined,
              forbiddenWords: data.forbiddenWords ? data.forbiddenWords.split(",").map((w) => w.trim()).filter(Boolean) : undefined,
              signaturePhrases: data.signaturePhrases ? data.signaturePhrases.split("\n").map((s) => s.trim()).filter(Boolean) : undefined,
            },
          },
        }),
      invalidateKeys: [["brand-tokens", slug]],
    });

    const socialForm = useSectionForm({
      initialData: () => ({
        instagramHandle: tokens.value?.social?.instagramHandle ?? "",
        websiteUrl: tokens.value?.social?.websiteUrl ?? "",
      }),
      onSave: (data) =>
        apiPatch(`/projects/${slug}/brand-tokens`, {
          tokens: { social: { instagramHandle: data.instagramHandle || undefined, websiteUrl: data.websiteUrl || undefined } },
        }),
      invalidateKeys: [["brand-tokens", slug]],
    });

    const socialColorsForm = useSectionForm({
      initialData: () => ({
        eyebrowColor: tokens.value?.colors?.eyebrowColor ?? "",
        surfaceSecondary: tokens.value?.colors?.surfaceSecondary ?? "",
        pricingFree: tokens.value?.colors?.pricingFree ?? "",
        pricingFreemium: tokens.value?.colors?.pricingFreemium ?? "",
        pricingPaid: tokens.value?.colors?.pricingPaid ?? "",
      }),
      onSave: (data) =>
        apiPatch(`/projects/${slug}/brand-tokens?force=true`, {
          tokens: {
            colors: {
              ...(data.eyebrowColor ? { eyebrowColor: data.eyebrowColor } : {}),
              ...(data.surfaceSecondary ? { surfaceSecondary: data.surfaceSecondary } : {}),
              ...(data.pricingFree ? { pricingFree: data.pricingFree } : {}),
              ...(data.pricingFreemium ? { pricingFreemium: data.pricingFreemium } : {}),
              ...(data.pricingPaid ? { pricingPaid: data.pricingPaid } : {}),
            },
          },
        }),
      invalidateKeys: [["brand-tokens", slug]],
    });

    watch(tokens, () => {
      colorsForm.resetFromUpstream();
      typographyForm.resetFromUpstream();
      voiceForm.resetFromUpstream();
      socialForm.resetFromUpstream();
      socialColorsForm.resetFromUpstream();
    });

    return { colorsForm, typographyForm, voiceForm, socialForm, socialColorsForm };
  },
});
</script>

<style scoped>
.brand-tokens-form-editor {
  display: flex;
  flex-direction: column;
}

.color-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-picker {
  width: 40px;
  height: 36px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
  padding: 2px;
  flex-shrink: 0;
}

.color-preview {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  flex-shrink: 0;
}

.pricing-colors-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 6px);
  background: var(--surface-secondary, rgba(255, 255, 255, 0.02));
}

.pricing-colors-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
}
</style>
