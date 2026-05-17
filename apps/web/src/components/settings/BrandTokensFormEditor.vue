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

    <!-- Social -->
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
  </div>
</template>

<script lang="ts">
import { defineComponent, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import FormSection from "src/components/forms/FormSection.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FormSelect from "src/components/forms/FormSelect.vue";
import FormTextarea from "src/components/forms/FormTextarea.vue";
import { useSectionForm } from "src/composables/useSectionForm";
import { apiGet, apiPatch } from "src/lib/api";

interface BrandTokensResponse {
  colors?: {
    primary?: string;
    accent?: string;
    surface?: string;
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
    const route = useRoute();
    const slug = route.params.slug as string;

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

    watch(tokens, () => {
      colorsForm.resetFromUpstream();
      typographyForm.resetFromUpstream();
      voiceForm.resetFromUpstream();
      socialForm.resetFromUpstream();
    });

    return { colorsForm, typographyForm, voiceForm, socialForm };
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
</style>
