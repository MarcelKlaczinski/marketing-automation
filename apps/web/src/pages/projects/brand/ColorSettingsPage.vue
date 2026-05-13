<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-lg">
      <div class="text-h5">{{ $t('brand.colors.title') }}</div>
    </div>

    <div v-if="loading" class="flex flex-center q-py-xl">
      <q-spinner size="40px" color="primary" />
    </div>

    <template v-else>
      <div class="row q-gutter-md q-mb-xl">
        <q-card
          v-for="key in colorKeys"
          :key="key"
          flat
          bordered
          style="min-width: 280px; flex: 1"
        >
          <q-card-section>
            <div class="text-subtitle1 q-mb-md">{{ $t(`brand.colors.tokens.${key}`) }}</div>
            <OklchSlider
              :label="$t(`brand.colors.tokens.${key}`) as string"
              :model-value="localColors[key] || '#888888'"
              @update:model-value="(v: string) => onColorChange(key, v)"
            />
            <ContrastChecker
              v-if="key === 'primary' || key === 'accent'"
              class="q-mt-sm"
              :color-a="localColors[key] || '#888888'"
              :color-b="localColors['surface'] || '#ffffff'"
            />
          </q-card-section>
        </q-card>
      </div>

      <div class="row q-gutter-sm">
        <q-btn
          color="primary"
          :label="$t('brand.colors.save')"
          :loading="saving"
          @click="save"
          unelevated
        />
        <q-btn
          flat
          :label="$t('brand.colors.discard')"
          @click="discard"
        />
        <q-btn
          flat
          color="negative"
          :label="$t('brand.colors.resetSection')"
          @click="resetColors"
        />
      </div>
    </template>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";
import OklchSlider from "src/components/brand/OklchSlider.vue";
import ContrastChecker from "src/components/brand/ContrastChecker.vue";

// Normalize any CSS oklch() or other culori-parsed color to hex so OklchSlider
// always receives a stable hex input regardless of how the value was stored.
async function toHexSafe(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  if (value.startsWith("#")) return value;
  try {
    const { formatHex, converter } = await import("culori");
    const toRgb = converter("rgb");
    const rgb = toRgb(value);
    if (!rgb) return value;
    return formatHex(rgb) ?? value;
  } catch {
    return value;
  }
}

const COLOR_KEYS = ["primary", "accent", "surface", "surfaceDark", "ink", "inkMuted", "wikiCream"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

interface BrandTokens {
  colors?: Partial<Record<ColorKey, string>>;
}

export default defineComponent({
  name: "ColorSettingsPage",

  components: { OklchSlider, ContrastChecker },

  props: {
    slug: {
      type: String,
      required: true,
    },
  },

  data: () => ({
    loading: false,
    saving: false,
    tokens: {} as BrandTokens,
    localColors: {} as Partial<Record<ColorKey, string>>,
    colorKeys: COLOR_KEYS as ReadonlyArray<ColorKey>,
  }),

  mounted() {
    void this.loadTokens();
  },

  methods: {
    async loadTokens() {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { tokens: BrandTokens } }>(
          `/projects/${this.slug}/brand-tokens`
        );
        this.tokens = res.data.data.tokens;
        // Normalize stored values (may be CSS oklch strings) to hex for OklchSlider
        const raw = this.tokens.colors ?? {};
        const normalized: Partial<Record<ColorKey, string>> = {};
        for (const key of COLOR_KEYS) {
          const hex = await toHexSafe(raw[key]);
          if (hex) normalized[key] = hex;
        }
        this.localColors = normalized;
      } finally {
        this.loading = false;
      }
    },

    onColorChange(key: ColorKey, value: string) {
      this.localColors = { ...this.localColors, [key]: value };
    },

    async save() {
      this.saving = true;
      try {
        await api.patch(`/projects/${this.slug}/brand-tokens`, {
          tokens: { colors: this.localColors },
        });
        this.$q.notify({ type: "positive", message: this.$t("common.saved") as string });
      } finally {
        this.saving = false;
      }
    },

    discard() {
      this.localColors = { ...this.tokens.colors };
    },

    async resetColors() {
      await api.post(`/projects/${this.slug}/brand-tokens/reset`, {
        sections: ["colors"],
      });
      await this.loadTokens();
    },
  },
});
</script>
