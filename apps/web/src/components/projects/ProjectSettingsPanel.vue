<template>
  <div>
    <p class="text-body2 q-mb-lg">{{ $t('projects.settings.intro') }}</p>

    <!-- Astro Repo -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.astroRepo.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.astroRepo.description') }}</p>

      <div class="row q-col-gutter-md">
        <q-input
          v-model="astroRepo.owner"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.owner')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model="astroRepo.name"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.name')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model.number="astroRepo.installationId"
          outlined
          dense
          type="number"
          :label="$t('projects.settings.astroRepo.installationId')"
          :hint="$t('projects.settings.astroRepo.installationIdHint')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model="astroRepo.defaultBranch"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.defaultBranch')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model="astroRepo.contentRoot"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.contentRoot')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model="astroRepo.assetsRoot"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.assetsRoot')"
          class="col-12 col-md-6"
        />
      </div>
    </div>

    <!-- Publish Domain -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.publishDomain.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.publishDomain.description') }}</p>
      <q-input
        v-model="domain"
        outlined
        dense
        :label="$t('projects.settings.publishDomain.field')"
        :placeholder="$t('projects.settings.publishDomain.placeholder')"
      />
    </div>

    <!-- PageSpeed Thresholds -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.pagespeed.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.pagespeed.description') }}</p>

      <div class="row q-col-gutter-md">
        <div
          v-for="metric in pagespeedMetrics"
          :key="metric"
          class="col-12 col-sm-6 col-md-3"
        >
          <q-input
            v-model.number="pagespeedThresholds[metric]"
            outlined
            dense
            type="number"
            :min="0"
            :max="100"
            :label="$t(`projects.settings.pagespeed.${metric}`)"
            :suffix="$t('projects.settings.pagespeed.scoreSuffix')"
          />
        </div>
      </div>
    </div>

    <!-- Link Rebuild Budget -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.linkRebuild.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.linkRebuild.description') }}</p>
      <q-input
        v-model="linkRebuildBudgetMonthly"
        outlined
        dense
        :label="$t('projects.settings.linkRebuild.field')"
        :suffix="$t('projects.settings.linkRebuild.suffix')"
        :rules="[(v: string) => /^\d+(\.\d{1,2})?$/.test(v) || ($t('projects.settings.linkRebuild.invalid') as string)]"
      />
    </div>

    <div class="row q-mt-lg">
      <q-space />
      <q-btn
        color="primary"
        :label="$t('common.save')"
        :loading="saving"
        :disable="!hasChanges"
        @click="onSave"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { useNotify } from "src/composables/useNotify";
import { HttpError } from "src/lib/http-error";
import { useProjectsStore } from "src/stores/projects";
import type { AstroRepoConfig, PagespeedThresholds, Project } from "src/stores/projects";
import { type PropType, defineComponent } from "vue";

const DEFAULT_ASTRO_REPO: AstroRepoConfig = {
  owner: "",
  name: "",
  installationId: 0,
  defaultBranch: "main",
  contentRoot: "src/content",
  assetsRoot: "src/assets",
};

const DEFAULT_PAGESPEED: PagespeedThresholds = {
  performance: 85,
  accessibility: 90,
  bestPractices: 90,
  seo: 95,
};

type PagespeedMetric = keyof PagespeedThresholds;
const PAGESPEED_METRICS: PagespeedMetric[] = [
  "performance",
  "accessibility",
  "bestPractices",
  "seo",
];

export default defineComponent({
  name: "ProjectSettingsPanel",

  props: {
    project: { type: Object as PropType<Project>, required: true },
  },

  emits: ["updated"],

  setup() {
    return {
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data() {
    return {
      saving: false,
      pagespeedMetrics: PAGESPEED_METRICS,
      astroRepo: { ...DEFAULT_ASTRO_REPO, ...(this.project.astroRepo ?? {}) } as AstroRepoConfig,
      domain: this.project.domain ?? "",
      pagespeedThresholds: {
        ...DEFAULT_PAGESPEED,
        ...(this.project.pagespeedThresholds ?? {}),
      } as PagespeedThresholds,
      linkRebuildBudgetMonthly: this.project.linkRebuildBudgetMonthly ?? "30.00",
      _initialSnapshot: "",
    };
  },

  created() {
    this._initialSnapshot = this.snapshot();
  },

  computed: {
    hasChanges(): boolean {
      return this.snapshot() !== this._initialSnapshot;
    },
  },

  methods: {
    snapshot(): string {
      return JSON.stringify({
        astroRepo: this.astroRepo,
        domain: this.domain,
        pagespeedThresholds: this.pagespeedThresholds,
        linkRebuildBudgetMonthly: this.linkRebuildBudgetMonthly,
      });
    },

    async onSave(): Promise<void> {
      this.saving = true;
      try {
        const repoComplete =
          !!this.astroRepo.owner && !!this.astroRepo.name && this.astroRepo.installationId > 0;

        await this.projectsStore.update(this.project.slug, {
          astroRepo: repoComplete ? this.astroRepo : null,
          domain: this.domain || null,
          pagespeedThresholds: this.pagespeedThresholds,
          linkRebuildBudgetMonthly: this.linkRebuildBudgetMonthly,
        });

        this._initialSnapshot = this.snapshot();
        this.notify.success(this.$t("projects.settings.saveSuccess"));
        this.$emit("updated");
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.settings-section {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

  &:last-of-type {
    border-bottom: none;
  }

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
}

.settings-section__title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}
</style>
