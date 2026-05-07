<template>
  <div class="validation-panel">

    <!-- PageSpeed Section -->
    <q-card flat bordered class="q-mb-lg">
      <q-card-section class="q-pb-sm">
        <div class="text-subtitle2">{{ $t('articles.validation.pagespeed.title') }}</div>
      </q-card-section>

      <q-card-section v-if="!latestPagespeed" class="text-grey-6 text-caption q-pt-none">
        {{ $t('articles.validation.pagespeed.notRun') }}
      </q-card-section>

      <template v-else>
        <q-card-section class="q-pt-none">
          <div class="row items-center q-mb-md">
            <q-badge
              :color="outcomeColor(latestPagespeed.outcome)"
              :label="outcomeLabel(latestPagespeed.outcome)"
              class="q-mr-sm"
            />
            <span class="text-caption text-grey-6">
              {{ formatDate(latestPagespeed.startedAt) }}
            </span>
          </div>

          <div v-if="latestPagespeed.scores" class="q-gutter-y-sm">
            <div
              v-for="(score, category) in latestPagespeed.scores"
              :key="category"
              class="score-row"
            >
              <div class="score-row__label text-caption text-grey-8">
                {{ categoryLabel(String(category)) }}
              </div>
              <q-linear-progress
                :value="Number(score) / 100"
                :color="scoreColor(Number(score))"
                size="8px"
                rounded
                class="score-row__bar"
              />
              <div
                class="score-row__value text-caption text-weight-bold text-right"
                :class="`text-${scoreColor(Number(score))}`"
              >
                {{ Math.round(Number(score)) }}
              </div>
            </div>
          </div>

          <div v-if="latestPagespeed.failedCategories && latestPagespeed.failedCategories.length" class="q-mt-md">
            <div class="text-caption text-grey-7 q-mb-xs">
              {{ $t('articles.validation.pagespeed.failedCategories') }}
            </div>
            <q-chip
              v-for="cat in latestPagespeed.failedCategories"
              :key="cat"
              size="sm"
              color="negative"
              text-color="white"
              dense
            >
              {{ categoryLabel(cat) }}
            </q-chip>
          </div>

          <div v-if="latestPagespeed.testedUrl" class="text-caption text-grey-6 q-mt-sm">
            {{ $t('articles.validation.pagespeed.testedUrl') }}:
            <span class="text-primary">{{ latestPagespeed.testedUrl }}</span>
          </div>

          <div v-if="latestPagespeed.errorMessage" class="text-caption text-negative q-mt-sm">
            {{ latestPagespeed.errorMessage }}
          </div>
        </q-card-section>
      </template>
    </q-card>

    <!-- Schema.org Section -->
    <q-card flat bordered>
      <q-card-section class="q-pb-sm">
        <div class="text-subtitle2">{{ $t('articles.validation.schema.title') }}</div>
      </q-card-section>

      <q-card-section v-if="!latestSchema" class="text-grey-6 text-caption q-pt-none">
        {{ $t('articles.validation.schema.notRun') }}
      </q-card-section>

      <template v-else>
        <q-card-section class="q-pt-none">
          <div class="row items-center q-mb-md">
            <q-badge
              :color="latestSchema.status === 'succeeded' ? 'positive' : 'negative'"
              :label="schemaStatusLabel(latestSchema.status)"
              class="q-mr-sm"
            />
            <span class="text-caption text-grey-6">
              {{ formatDate(latestSchema.startedAt) }}
            </span>
          </div>

          <div v-if="latestSchema.detectedTypes" class="q-gutter-xs q-mb-sm">
            <q-chip
              v-for="(detected, type) in latestSchema.detectedTypes"
              :key="type"
              :color="detected ? 'primary' : 'grey-3'"
              :text-color="detected ? 'white' : 'grey-7'"
              size="sm"
              dense
            >
              <q-icon
                :name="detected ? 'check_circle' : 'radio_button_unchecked'"
                size="12px"
                class="q-mr-xs"
              />
              {{ schemaTypeLabel(String(type)) }}
            </q-chip>
          </div>

          <div class="text-caption text-grey-7 q-gutter-y-xs">
            <div v-if="latestSchema.faqQuestionCount && latestSchema.faqQuestionCount > 0">
              {{ $t('articles.validation.schema.faqCount', { count: latestSchema.faqQuestionCount }) }}
            </div>
            <div v-if="latestSchema.howtoStepCount && latestSchema.howtoStepCount > 0">
              {{ $t('articles.validation.schema.howtoCount', { count: latestSchema.howtoStepCount }) }}
            </div>
          </div>

          <div v-if="latestSchema.errorMessage" class="text-caption text-negative q-mt-sm">
            {{ latestSchema.errorMessage }}
          </div>
        </q-card-section>
      </template>
    </q-card>
  </div>
</template>

<script lang="ts">
import type { ArticleDetail } from "src/stores/articles";
import { type PropType, defineComponent } from "vue";

interface PagespeedRun {
  outcome: string | null;
  scores: Record<string, number> | null;
  failedCategories: string[] | null;
  testedUrl: string | null;
  errorMessage: string | null;
  startedAt: string;
}

interface SchemaRun {
  status: string;
  detectedTypes: { breadcrumb: boolean; faq: boolean; howto: boolean } | null;
  faqQuestionCount: number | null;
  howtoStepCount: number | null;
  errorMessage: string | null;
  startedAt: string;
}

const SCORE_GOOD = 90;
const SCORE_OK = 50;

const PAGESPEED_CATEGORY_KEYS: Record<string, string> = {
  performance: "articles.validation.pagespeed.categories.performance",
  accessibility: "articles.validation.pagespeed.categories.accessibility",
  "best-practices": "articles.validation.pagespeed.categories.best-practices",
  seo: "articles.validation.pagespeed.categories.seo",
};

const SCHEMA_TYPE_KEYS: Record<string, string> = {
  breadcrumb: "articles.validation.schema.types.breadcrumb",
  faq: "articles.validation.schema.types.faq",
  howto: "articles.validation.schema.types.howto",
};

const SCHEMA_STATUS_KEYS: Record<string, string> = {
  pending: "articles.validation.schema.status.pending",
  succeeded: "articles.validation.schema.status.succeeded",
  failed: "articles.validation.schema.status.failed",
};

export default defineComponent({
  name: "ArticleValidationPanel",

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  computed: {
    latestPagespeed(): PagespeedRun | null {
      const run = this.detail.recentRuns.pagespeed[0];
      return run ? (run as unknown as PagespeedRun) : null;
    },

    latestSchema(): SchemaRun | null {
      const run = this.detail.recentRuns.schema[0];
      return run ? (run as unknown as SchemaRun) : null;
    },
  },

  methods: {
    outcomeColor(outcome: string | null): string {
      if (outcome === "pass") return "positive";
      if (outcome === "fail") return "negative";
      return "warning";
    },

    outcomeLabel(outcome: string | null): string {
      const key =
        outcome === "pass"
          ? "articles.validation.pagespeed.outcome.pass"
          : outcome === "fail"
            ? "articles.validation.pagespeed.outcome.fail"
            : "articles.validation.pagespeed.outcome.error";
      return this.$t(key) as string;
    },

    scoreColor(score: number): string {
      if (score >= SCORE_GOOD) return "positive";
      if (score >= SCORE_OK) return "warning";
      return "negative";
    },

    categoryLabel(key: string): string {
      const i18nKey = PAGESPEED_CATEGORY_KEYS[key];
      return i18nKey ? (this.$t(i18nKey) as string) : key;
    },

    schemaTypeLabel(key: string): string {
      const i18nKey = SCHEMA_TYPE_KEYS[key];
      return i18nKey ? (this.$t(i18nKey) as string) : key;
    },

    schemaStatusLabel(status: string): string {
      const i18nKey = SCHEMA_STATUS_KEYS[status];
      return i18nKey ? (this.$t(i18nKey) as string) : status;
    },

    formatDate(iso: string): string {
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
    },
  },
});
</script>

<style lang="scss" scoped>
.validation-panel {
  /* no extra padding — parent q-tab-panel provides it */
}

.score-row {
  display: grid;
  grid-template-columns: 130px 1fr 36px;
  align-items: center;
  gap: 10px;
}

.score-row__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.score-row__value {
  min-width: 28px;
}
</style>
