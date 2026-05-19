<template>
  <div class="divergence-banner" :class="`divergence-banner--${divergence}`">
    <div class="banner-icon">
      <q-icon name="warning_amber" size="1.25rem" />
    </div>
    <div class="banner-body">
      <strong class="banner-headline">{{ headlineText }}</strong>
      <p class="banner-description">{{ descriptionText }}</p>
    </div>
    <div class="banner-actions">
      <GlassButton
        v-if="divergence !== 'sibling_newer'"
        variant="primary"
        size="sm"
        @click="$emit('resync')"
      >
        {{ resyncLabel }}
      </GlassButton>
      <GlassButton
        v-if="divergence === 'sibling_newer'"
        variant="primary"
        size="sm"
        @click="$emit('open-sibling')"
      >
        {{ $t("articles.divergence.openSibling") as string }}
      </GlassButton>
      <GlassButton
        v-if="divergence === 'both_diverged'"
        variant="secondary"
        size="sm"
        @click="$emit('open-sibling')"
      >
        {{ $t("articles.divergence.openSibling") as string }}
      </GlassButton>
      <GlassButton
        variant="ghost"
        size="sm"
        @click="$emit('dismiss')"
      >
        {{ $t("common.dismiss") as string }}
      </GlassButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import GlassButton from "src/components/ui/GlassButton.vue";

export type DivergenceState = "this_newer" | "sibling_newer" | "both_diverged";

export default defineComponent({
  name: "DivergenceBanner",

  components: { GlassButton },

  emits: ["resync", "open-sibling", "dismiss"],

  props: {
    divergence: {
      type: String as PropType<DivergenceState>,
      required: true,
    },
    siblingLocale: {
      type: String as PropType<"de" | "en">,
      required: true,
    },
  },

  computed: {
    siblingLocaleLabel(): string {
      return this.$t(`articles.locale.localeLabel.${this.siblingLocale}`) as string;
    },
    headlineText(): string {
      return this.$t(`articles.divergence.${this.divergence}.headline`, {
        locale: this.siblingLocaleLabel,
      }) as string;
    },
    descriptionText(): string {
      return this.$t(`articles.divergence.${this.divergence}.description`, {
        locale: this.siblingLocaleLabel,
      }) as string;
    },
    resyncLabel(): string {
      return this.$t("articles.divergence.resyncSibling", {
        locale: this.siblingLocaleLabel,
      }) as string;
    },
  },
});
</script>

<style scoped>
.divergence-banner {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border-radius: 10px;
  background: color-mix(in oklch, oklch(72% 0.18 45) 12%, transparent);
  border: 1px solid color-mix(in oklch, oklch(72% 0.18 45) 30%, transparent);
  margin-bottom: 1rem;
}

.divergence-banner--both_diverged {
  background: color-mix(in oklch, oklch(60% 0.19 20) 12%, transparent);
  border-color: color-mix(in oklch, oklch(60% 0.19 20) 30%, transparent);
}

.banner-icon {
  flex-shrink: 0;
  color: oklch(72% 0.18 45);
  margin-top: 0.125rem;
}

.divergence-banner--both_diverged .banner-icon {
  color: oklch(60% 0.19 20);
}

.banner-body {
  flex: 1;
  min-width: 0;
}

.banner-headline {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary, #fff);
  margin-bottom: 0.25rem;
}

.banner-description {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-secondary, rgba(255, 255, 255, 0.7));
  line-height: 1.4;
}

.banner-actions {
  display: flex;
  flex-shrink: 0;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}
</style>
