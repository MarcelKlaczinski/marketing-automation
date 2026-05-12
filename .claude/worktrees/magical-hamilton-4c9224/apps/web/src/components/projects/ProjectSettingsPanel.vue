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
        <q-input
          v-model="astroRepo.localPath"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.localPath')"
          :hint="$t('projects.settings.astroRepo.localPathHint')"
          placeholder="/Users/you/projects/my-astro-site"
          class="col-12"
        />
        <!-- Collection URL paths -->
        <div class="col-12">
          <div class="text-caption text-weight-medium q-mb-xs">
            {{ $t('projects.settings.astroRepo.collectionPathsTitle') }}
          </div>
          <div class="text-caption text-grey q-mb-sm">
            {{ $t('projects.settings.astroRepo.collectionPathsHint') }}
          </div>
          <div
            v-for="(row, idx) in collectionPathRows"
            :key="idx"
            class="row q-col-gutter-sm q-mb-sm items-center"
          >
            <q-input
              v-model="row.collection"
              outlined
              dense
              :placeholder="$t('projects.settings.astroRepo.collectionPathsCollection')"
              class="col-5"
            />
            <q-input
              v-model="row.pathTemplate"
              outlined
              dense
              placeholder="/{locale}/{collection}/{slug}"
              class="col"
            />
            <q-btn
              flat
              round
              dense
              icon="close"
              color="grey"
              class="col-auto"
              @click="removeCollectionPathRow(idx)"
            />
          </div>
          <div v-if="collectionPathRows.length === 0" class="text-caption text-grey q-mb-sm">
            {{ $t('projects.settings.astroRepo.collectionPathsEmpty') }}
          </div>
          <q-btn
            flat
            dense
            color="primary"
            icon="add"
            :label="$t('projects.settings.astroRepo.collectionPathsAdd')"
            @click="addCollectionPathRow"
          />
        </div>
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

    <!-- Cost Limits -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.costLimits.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.costLimits.description') }}</p>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <div class="text-subtitle2 q-mb-sm">{{ $t('projects.settings.costLimits.daily') }}</div>
          <q-input
            v-model="costLimitsForm.daily.anthropic"
            outlined
            dense
            type="number"
            :min="0"
            step="0.01"
            :label="$t('projects.settings.costLimits.anthropic')"
            :suffix="$t('projects.settings.costLimits.suffixDay')"
            :placeholder="$t('projects.settings.costLimits.noLimit')"
            class="q-mb-sm"
          />
          <q-input
            v-model="costLimitsForm.daily.replicate"
            outlined
            dense
            type="number"
            :min="0"
            step="0.01"
            :label="$t('projects.settings.costLimits.replicate')"
            :suffix="$t('projects.settings.costLimits.suffixDay')"
            :placeholder="$t('projects.settings.costLimits.noLimit')"
            class="q-mb-sm"
          />
          <q-input
            v-model="costLimitsForm.daily.dataforseo"
            outlined
            dense
            type="number"
            :min="0"
            step="0.01"
            :label="$t('projects.settings.costLimits.dataforseo')"
            :suffix="$t('projects.settings.costLimits.suffixDay')"
            :placeholder="$t('projects.settings.costLimits.noLimit')"
          />
        </div>

        <div class="col-12 col-md-6">
          <div class="text-subtitle2 q-mb-sm">{{ $t('projects.settings.costLimits.monthly') }}</div>
          <q-input
            v-model="costLimitsForm.monthly.anthropic"
            outlined
            dense
            type="number"
            :min="0"
            step="0.01"
            :label="$t('projects.settings.costLimits.anthropic')"
            :suffix="$t('projects.settings.costLimits.suffixMonth')"
            :placeholder="$t('projects.settings.costLimits.noLimit')"
            class="q-mb-sm"
          />
          <q-input
            v-model="costLimitsForm.monthly.replicate"
            outlined
            dense
            type="number"
            :min="0"
            step="0.01"
            :label="$t('projects.settings.costLimits.replicate')"
            :suffix="$t('projects.settings.costLimits.suffixMonth')"
            :placeholder="$t('projects.settings.costLimits.noLimit')"
            class="q-mb-sm"
          />
          <q-input
            v-model="costLimitsForm.monthly.dataforseo"
            outlined
            dense
            type="number"
            :min="0"
            step="0.01"
            :label="$t('projects.settings.costLimits.dataforseo')"
            :suffix="$t('projects.settings.costLimits.suffixMonth')"
            :placeholder="$t('projects.settings.costLimits.noLimit')"
          />
        </div>
      </div>

      <div class="row q-mt-sm q-gutter-sm">
        <q-btn
          flat
          dense
          color="warning"
          :label="$t('projects.settings.costLimits.disable')"
          @click="onDisableLimits"
        />
        <q-btn
          flat
          dense
          :label="$t('projects.settings.costLimits.reset')"
          @click="onResetLimits"
        />
      </div>
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

interface CostLimitsForm {
  daily: { anthropic: string; replicate: string; dataforseo: string };
  monthly: { anthropic: string; replicate: string; dataforseo: string };
}

const DEFAULT_COST_LIMITS_FORM: CostLimitsForm = {
  daily: { anthropic: "20", replicate: "5", dataforseo: "10" },
  monthly: { anthropic: "200", replicate: "50", dataforseo: "100" },
};

const EMPTY_COST_LIMITS_FORM: CostLimitsForm = {
  daily: { anthropic: "", replicate: "", dataforseo: "" },
  monthly: { anthropic: "", replicate: "", dataforseo: "" },
};

function parseCostLimit(s: string): number | undefined {
  if (s === "") return undefined;
  const n = parseFloat(s);
  return isNaN(n) || n < 0 ? undefined : n;
}

function buildCostRecord(src: {
  anthropic: string;
  replicate: string;
  dataforseo: string;
}): Record<string, number> {
  const r: Record<string, number> = {};
  const a = parseCostLimit(src.anthropic);
  if (a !== undefined) r.anthropic = a;
  const rep = parseCostLimit(src.replicate);
  if (rep !== undefined) r.replicate = rep;
  const d = parseCostLimit(src.dataforseo);
  if (d !== undefined) r.dataforseo = d;
  return r;
}

const DEFAULT_ASTRO_REPO: AstroRepoConfig = {
  owner: "",
  name: "",
  installationId: 0,
  defaultBranch: "main",
  contentRoot: "src/content",
  assetsRoot: "src/assets",
  localPath: "",
};

interface CollectionPathRow {
  collection: string;
  pathTemplate: string;
}

function collectionPathsToRows(paths: Record<string, string> | undefined): CollectionPathRow[] {
  if (!paths || Object.keys(paths).length === 0) return [];
  return Object.entries(paths).map(([collection, pathTemplate]) => ({ collection, pathTemplate }));
}

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
      collectionPathRows: collectionPathsToRows(this.project.astroRepo?.collectionPaths) as CollectionPathRow[],
      domain: this.project.domain ?? "",
      pagespeedThresholds: {
        ...DEFAULT_PAGESPEED,
        ...(this.project.pagespeedThresholds ?? {}),
      } as PagespeedThresholds,
      linkRebuildBudgetMonthly: this.project.linkRebuildBudgetMonthly ?? "30.00",
      costLimitsForm: {
        daily: {
          anthropic: (this.project.costLimits?.daily?.["anthropic"] ?? "").toString(),
          replicate: (this.project.costLimits?.daily?.["replicate"] ?? "").toString(),
          dataforseo: (this.project.costLimits?.daily?.["dataforseo"] ?? "").toString(),
        },
        monthly: {
          anthropic: (this.project.costLimits?.monthly?.["anthropic"] ?? "").toString(),
          replicate: (this.project.costLimits?.monthly?.["replicate"] ?? "").toString(),
          dataforseo: (this.project.costLimits?.monthly?.["dataforseo"] ?? "").toString(),
        },
      } as CostLimitsForm,
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
        collectionPathRows: this.collectionPathRows,
        domain: this.domain,
        pagespeedThresholds: this.pagespeedThresholds,
        linkRebuildBudgetMonthly: this.linkRebuildBudgetMonthly,
        costLimitsForm: this.costLimitsForm,
      });
    },

    addCollectionPathRow(): void {
      this.collectionPathRows.push({ collection: "", pathTemplate: "" });
    },

    removeCollectionPathRow(idx: number): void {
      this.collectionPathRows.splice(idx, 1);
    },

    async onSave(): Promise<void> {
      this.saving = true;
      try {
        const repoComplete =
          !!this.astroRepo.owner && !!this.astroRepo.name && this.astroRepo.installationId > 0;

        // exactOptionalPropertyTypes: build conditionally to avoid { localPath: undefined }
        let astroRepoPayload: AstroRepoConfig | null = null;
        if (repoComplete) {
          const base: AstroRepoConfig = {
            owner: this.astroRepo.owner,
            name: this.astroRepo.name,
            installationId: this.astroRepo.installationId,
            defaultBranch: this.astroRepo.defaultBranch,
            contentRoot: this.astroRepo.contentRoot,
            assetsRoot: this.astroRepo.assetsRoot,
          };
          if (this.astroRepo.localPath?.trim()) base.localPath = this.astroRepo.localPath.trim();
          // Build collectionPaths from rows, skipping empty entries
          const collectionPaths: Record<string, string> = {};
          for (const row of this.collectionPathRows) {
            if (row.collection.trim() && row.pathTemplate.trim()) {
              collectionPaths[row.collection.trim()] = row.pathTemplate.trim();
            }
          }
          if (Object.keys(collectionPaths).length > 0) base.collectionPaths = collectionPaths;
          astroRepoPayload = base;
        }

        await this.projectsStore.update(this.project.slug, {
          astroRepo: astroRepoPayload,
          domain: this.domain || null,
          pagespeedThresholds: this.pagespeedThresholds,
          linkRebuildBudgetMonthly: this.linkRebuildBudgetMonthly,
          costLimits: {
            daily: buildCostRecord(this.costLimitsForm.daily),
            monthly: buildCostRecord(this.costLimitsForm.monthly),
          },
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

    onResetLimits(): void {
      this.costLimitsForm = JSON.parse(JSON.stringify(DEFAULT_COST_LIMITS_FORM)) as CostLimitsForm;
    },

    onDisableLimits(): void {
      this.costLimitsForm = JSON.parse(JSON.stringify(EMPTY_COST_LIMITS_FORM)) as CostLimitsForm;
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
