<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-lg">
      <div class="text-h5">{{ $t('brand.typography.title') }}</div>
    </div>

    <div v-if="loading" class="flex flex-center q-py-xl">
      <q-spinner size="40px" color="primary" />
    </div>

    <template v-else>
      <div class="row q-gutter-md">
        <!-- Left panel: settings -->
        <div class="col-12 col-md-7">
          <!-- Font Family -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle1 q-mb-sm">{{ $t('brand.typography.fontFamily') }}</div>
              <q-select
                v-model="form.fontFamily"
                :options="fontFamilyOptions"
                outlined
                dense
              />
            </q-card-section>
          </q-card>

          <!-- Weights -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle1 q-mb-md">{{ $t('brand.typography.weights') }}</div>
              <div v-for="w in weightFields" :key="w.key" class="row items-center q-mb-sm">
                <div class="col-3 text-caption text-grey-6">{{ $t(`brand.typography.${w.label}`) }}</div>
                <div class="col">
                  <q-slider :model-value="numericField(w.key)" :min="100" :max="900" :step="100" color="primary" @update:model-value="(v) => setField(w.key, v)" />
                </div>
                <div class="col-2 text-caption text-right">{{ form[w.key] }}</div>
              </div>
            </q-card-section>
          </q-card>

          <!-- Letter Spacing -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle1 q-mb-md">{{ $t('brand.typography.letterSpacing') }}</div>
              <div v-for="ls in letterSpacingFields" :key="ls.key" class="row items-center q-mb-sm">
                <div class="col-3 text-caption text-grey-6">{{ $t(`brand.typography.${ls.label}`) }}</div>
                <div class="col">
                  <q-input
                    :model-value="form[ls.key]"
                    dense
                    outlined
                    @update:model-value="(v) => setField(ls.key, String(v))"
                  />
                </div>
              </div>
            </q-card-section>
          </q-card>

          <!-- Sizes -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle1 q-mb-md">{{ $t('brand.typography.sizes') }}</div>
              <div v-for="s in sizeFields" :key="s.key" class="row items-center q-mb-sm">
                <div class="col-3 text-caption text-grey-6">{{ $t(`brand.typography.${s.label}`) }}</div>
                <div class="col">
                  <q-slider :model-value="numericField(s.key)" :min="10" :max="120" :step="1" color="primary" @update:model-value="(v) => setField(s.key, v)" />
                </div>
                <div class="col-2 text-caption text-right">{{ form[s.key] }}px</div>
              </div>
            </q-card-section>
          </q-card>

          <!-- Line Heights -->
          <q-card flat bordered class="q-mb-md">
            <q-card-section>
              <div class="text-subtitle1 q-mb-md">{{ $t('brand.typography.lineHeight') }}</div>
              <div v-for="lh in lineHeightFields" :key="lh.key" class="row items-center q-mb-sm">
                <div class="col-3 text-caption text-grey-6">{{ $t(`brand.typography.${lh.label}`) }}</div>
                <div class="col">
                  <q-slider :model-value="numericField(lh.key)" :min="0.8" :max="2.5" :step="0.05" color="primary" @update:model-value="(v) => setField(lh.key, v)" />
                </div>
                <div class="col-2 text-caption text-right">{{ numericField(lh.key).toFixed(2) }}</div>
              </div>
            </q-card-section>
          </q-card>
        </div>

        <!-- Right panel: preview -->
        <div class="col-12 col-md-4">
          <q-card flat bordered class="sticky-top">
            <q-card-section>
              <div class="text-subtitle1 q-mb-md">{{ $t('brand.typography.preview') }}</div>
              <div
                class="typography-preview q-pa-md rounded-borders bg-grey-10 text-white"
                :style="previewStyle"
              >
                <div
                  class="preview-eyebrow q-mb-sm"
                  :style="{
                    fontFamily: form.fontFamily,
                    fontWeight: form.eyebrowWeight,
                    fontSize: `${(form.eyebrowSize / 1080) * 100}px`,
                    letterSpacing: form.eyebrowLetterSpacing,
                    textTransform: 'uppercase',
                    opacity: 0.7,
                  }"
                >
                  {{ $t('brand.typography.previewEyebrow') }}
                </div>
                <div
                  class="preview-heading q-mb-xs"
                  :style="{
                    fontFamily: form.fontFamily,
                    fontWeight: form.headingWeight,
                    fontSize: `${(form.headingSize / 1080) * 100}px`,
                    letterSpacing: form.headingLetterSpacing,
                    lineHeight: form.headingLineHeight,
                  }"
                >
                  {{ $t('brand.typography.previewHeading') }}
                </div>
                <div
                  :style="{
                    fontFamily: form.fontFamily,
                    fontWeight: form.bodyWeight,
                    fontSize: `${(form.bodySize / 1080) * 100}px`,
                    letterSpacing: form.bodyLetterSpacing,
                    lineHeight: form.bodyLineHeight,
                    opacity: 0.8,
                  }"
                >
                  {{ $t('brand.typography.previewBody') }}
                </div>
              </div>
            </q-card-section>
          </q-card>
        </div>
      </div>

      <div class="row q-gutter-sm q-mt-md">
        <q-btn color="primary" :label="$t('brand.typography.save')" :loading="saving" @click="save" unelevated />
        <q-btn flat :label="$t('brand.typography.discard')" @click="discard" />
        <q-btn flat color="negative" :label="$t('brand.typography.reset')" @click="resetTypography" />
      </div>
    </template>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";

interface TypographyForm {
  fontFamily: string;
  headingWeight: number;
  bodyWeight: number;
  eyebrowWeight: number;
  captionWeight: number;
  eyebrowLetterSpacing: string;
  headingLetterSpacing: string;
  bodyLetterSpacing: string;
  headingSize: number;
  subheadSize: number;
  bodySize: number;
  eyebrowSize: number;
  headingLineHeight: number;
  bodyLineHeight: number;
}

const DEFAULT_FORM: TypographyForm = {
  fontFamily: "Inter Variable",
  headingWeight: 800,
  bodyWeight: 400,
  eyebrowWeight: 700,
  captionWeight: 600,
  eyebrowLetterSpacing: "0.08em",
  headingLetterSpacing: "-0.02em",
  bodyLetterSpacing: "0em",
  headingSize: 64,
  subheadSize: 32,
  bodySize: 24,
  eyebrowSize: 18,
  headingLineHeight: 1.1,
  bodyLineHeight: 1.5,
};

const FONT_OPTIONS = ["Inter Variable", "Space Grotesk", "Plus Jakarta Sans", "Manrope", "Outfit"];

export default defineComponent({
  name: "TypographySettingsPage",

  props: {
    slug: {
      type: String,
      required: true,
    },
  },

  data: () => ({
    loading: false,
    saving: false,
    form: { ...DEFAULT_FORM } as TypographyForm,
    originalForm: { ...DEFAULT_FORM } as TypographyForm,
    fontFamilyOptions: FONT_OPTIONS,
    weightFields: [
      { key: "headingWeight" as keyof TypographyForm, label: "weightHeading" },
      { key: "bodyWeight" as keyof TypographyForm, label: "weightBody" },
      { key: "eyebrowWeight" as keyof TypographyForm, label: "weightEyebrow" },
      { key: "captionWeight" as keyof TypographyForm, label: "weightCaption" },
    ],
    letterSpacingFields: [
      { key: "headingLetterSpacing" as keyof TypographyForm, label: "letterSpacingHeading" },
      { key: "bodyLetterSpacing" as keyof TypographyForm, label: "letterSpacingBody" },
      { key: "eyebrowLetterSpacing" as keyof TypographyForm, label: "letterSpacingEyebrow" },
    ],
    sizeFields: [
      { key: "headingSize" as keyof TypographyForm, label: "sizeHeading" },
      { key: "subheadSize" as keyof TypographyForm, label: "sizeSubhead" },
      { key: "bodySize" as keyof TypographyForm, label: "sizeBody" },
      { key: "eyebrowSize" as keyof TypographyForm, label: "sizeEyebrow" },
    ],
    lineHeightFields: [
      { key: "headingLineHeight" as keyof TypographyForm, label: "lineHeightHeading" },
      { key: "bodyLineHeight" as keyof TypographyForm, label: "lineHeightBody" },
    ],
  }),

  computed: {
    previewStyle() {
      return {
        fontFamily: this.form.fontFamily,
        minHeight: "160px",
      };
    },
  },

  mounted() {
    void this.loadTokens();
  },

  methods: {
    async loadTokens() {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { tokens: { typography?: Partial<TypographyForm> } } }>(
          `/projects/${this.slug}/brand-tokens`
        );
        const t = res.data.data.tokens.typography ?? {};
        this.form = { ...DEFAULT_FORM, ...t } as TypographyForm;
        this.originalForm = { ...this.form };
      } finally {
        this.loading = false;
      }
    },

    numericField(key: keyof TypographyForm): number {
      const v = this.form[key];
      return typeof v === "number" ? v : 0;
    },

    setField(key: keyof TypographyForm, value: number | string | null) {
      if (value == null) return;
      // biome-ignore lint/suspicious/noExplicitAny: dynamic key assignment on typed form
      (this.form as any)[key] = value;
    },

    async save() {
      this.saving = true;
      try {
        await api.patch(`/projects/${this.slug}/brand-tokens`, {
          tokens: { typography: { ...this.form } },
        });
        this.originalForm = { ...this.form };
        this.$q.notify({ type: "positive", message: this.$t("common.saved") as string });
      } finally {
        this.saving = false;
      }
    },

    discard() {
      this.form = { ...this.originalForm };
    },

    async resetTypography() {
      await api.post(`/projects/${this.slug}/brand-tokens/reset`, {
        sections: ["typography"],
      });
      await this.loadTokens();
    },
  },
});
</script>

<style scoped>
.sticky-top {
  position: sticky;
  top: 16px;
}

.typography-preview {
  overflow: hidden;
}
</style>
