import { watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet, apiPatch } from "src/lib/api";
import { useSectionForm } from "./useSectionForm";
import { useDiscoverySettings } from "./useDiscoverySettings";

interface AstroRepoConfig {
  owner: string;
  name: string;
  installationId: number;
  defaultBranch: string;
  contentRoot: string;
  assetsRoot: string;
  localPath?: string;
  collectionPaths?: Record<string, string>;
  previewPath?: string;
}

interface CostLimits {
  daily?: Record<string, number>;
  monthly?: Record<string, number>;
  alertAtPercent?: number;
  killAtPercent?: number;
}

interface PagespeedThresholds {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

interface ProjectSettingsData {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  industry: string;
  marketingContextMd: string;
  astroRepo: AstroRepoConfig | null;
  pagespeedThresholds: PagespeedThresholds | null;
  costLimits: CostLimits;
  translationAutoTrigger: boolean;
  socialAutoRenderLocales: string;
  socialAutoTemplates: string[];
  trendsCronEnabled: boolean;
  refreshCronEnabled: boolean;
  qualityAnalysisCronEnabled: boolean;
  autoApproveGaps: boolean;
  refreshStalenessThresholdDays: number;
  // Spec 61.4: batch API fields
  llmMode: "sync" | "batch";
  batchApiEnabled: boolean;
  // Spec 65.V1.5b: project-level default for recurring-content auto-approve
  recurringAutoApproveDefault: boolean;
  // Spec 65.16: project-level default for Family-B image-style preset
  // ("dark-neon-grid" | "light-editorial" | "blue-tech-gradient")
  socialImageStylePreset: "dark-neon-grid" | "light-editorial" | "blue-tech-gradient";
}

export function useSettingsProjectPage(slug: string) {
  const { data: project, isLoading } = useQuery({
    queryKey: ["project-settings", slug],
    queryFn: () => apiGet<ProjectSettingsData>(`/projects/${slug}`),
  });

  const basicsForm = useSectionForm({
    initialData: () => ({
      name: project.value?.name ?? "",
      domain: project.value?.domain ?? "",
      industry: project.value?.industry ?? "other",
    }),
    onSave: (data) =>
      apiPatch(`/projects/${slug}`, {
        name: data.name,
        domain: data.domain || null,
        industry: data.industry as
          | "ai_education"
          | "automotive_dealer"
          | "renewable_affiliate"
          | "music_school"
          | "other",
      }),
    invalidateKeys: [["project-settings", slug]],
  });

  const marketingForm = useSectionForm({
    initialData: () => ({
      marketingContextMd: project.value?.marketingContextMd ?? "",
    }),
    onSave: (data) =>
      apiPatch(`/projects/${slug}`, { marketingContextMd: data.marketingContextMd }),
    invalidateKeys: [["project-settings", slug]],
  });

  const costForm = useSectionForm({
    initialData: () => ({
      monthlyBudgetEur: String(project.value?.costLimits?.monthly?.anthropic ?? 100),
      alertThresholdPercent: String(project.value?.costLimits?.alertAtPercent ?? 80),
    }),
    onSave: (data) => {
      const existing = project.value?.costLimits ?? {};
      return apiPatch(`/projects/${slug}`, {
        costLimits: {
          ...existing,
          monthly: { ...(existing.monthly ?? {}), anthropic: parseFloat(data.monthlyBudgetEur) },
          alertAtPercent: parseInt(data.alertThresholdPercent, 10),
        },
      });
    },
    invalidateKeys: [["project-settings", slug]],
  });

  const astroForm = useSectionForm({
    initialData: () => ({
      owner: project.value?.astroRepo?.owner ?? "",
      name: project.value?.astroRepo?.name ?? "",
      installationId: String(project.value?.astroRepo?.installationId ?? ""),
      defaultBranch: project.value?.astroRepo?.defaultBranch ?? "main",
      contentRoot: project.value?.astroRepo?.contentRoot ?? "src/content",
      assetsRoot: project.value?.astroRepo?.assetsRoot ?? "src/assets",
      localPath: project.value?.astroRepo?.localPath ?? "",
    }),
    onSave: (data) => {
      const owner = data.owner.trim();
      const name = data.name.trim();
      const installationId = parseInt(data.installationId, 10);

      // Empty triple = disconnect (null) — server-side schema is .nullable()
      if (!owner && !name && !data.installationId) {
        return apiPatch(`/projects/${slug}`, { astroRepo: null });
      }

      // Required-field validation lives in the Vue component (SettingsProjectPage `onAstroSave`)
      // where `$t()` and `$q.notify` are accessible. Trust upstream gate here.
      const existing = project.value?.astroRepo;
      const astroRepo: AstroRepoConfig = {
        // Preserve unmodeled fields (collectionPaths, previewPath) when present
        ...(existing ?? {}),
        owner,
        name,
        installationId,
        defaultBranch: data.defaultBranch || "main",
        contentRoot: data.contentRoot || "src/content",
        assetsRoot: data.assetsRoot || "src/assets",
      };
      if (data.localPath) astroRepo.localPath = data.localPath;
      else delete astroRepo.localPath;
      return apiPatch(`/projects/${slug}`, { astroRepo });
    },
    invalidateKeys: [["project-settings", slug]],
  });

  const pagespeedForm = useSectionForm({
    initialData: () => ({
      minPerformance: String(project.value?.pagespeedThresholds?.performance ?? 80),
      minSeo: String(project.value?.pagespeedThresholds?.seo ?? 80),
    }),
    onSave: (data) => {
      const existing = project.value?.pagespeedThresholds ?? {
        performance: 80,
        accessibility: 80,
        bestPractices: 80,
        seo: 80,
      };
      return apiPatch(`/projects/${slug}`, {
        pagespeedThresholds: {
          ...existing,
          performance: parseInt(data.minPerformance, 10),
          seo: parseInt(data.minSeo, 10),
        },
      });
    },
    invalidateKeys: [["project-settings", slug]],
  });

  const translationForm = useSectionForm({
    initialData: () => ({
      translationAutoTrigger: project.value?.translationAutoTrigger ?? true,
    }),
    onSave: (data) =>
      apiPatch(`/projects/${slug}`, { translationAutoTrigger: data.translationAutoTrigger }),
    invalidateKeys: [["project-settings", slug]],
  });

  const socialForm = useSectionForm({
    initialData: () => ({
      socialAutoRenderLocales: project.value?.socialAutoRenderLocales ?? "one",
      socialAutoTemplates: project.value?.socialAutoTemplates ?? ([] as string[]),
    }),
    onSave: (data) =>
      apiPatch(`/projects/${slug}`, {
        socialAutoRenderLocales: data.socialAutoRenderLocales as "one" | "all",
        socialAutoTemplates: data.socialAutoTemplates as string[],
      }),
    invalidateKeys: [["project-settings", slug]],
  });

  const { discoveryForm, cronStatus, triggerCron } = useDiscoverySettings(slug, project);

  // Spec 61.4: LLM mode form — only persisted when batch API feature flag is on
  const llmModeForm = useSectionForm({
    initialData: () => ({
      llmMode: (project.value?.llmMode ?? "sync") as "sync" | "batch",
    }),
    onSave: (data) => apiPatch(`/projects/${slug}`, { llmMode: data.llmMode }),
    invalidateKeys: [["project-settings", slug]],
  });

  // Spec 65.V1.5b — Recurring-content auto-approve project default + monthly
  // budgets (dry_run + recurring_content_total). The two budgets share a
  // single sub-form so Marcel can edit both monthly limits in one save.
  const recurringDefaultsForm = useSectionForm({
    initialData: () => ({
      recurringAutoApproveDefault: project.value?.recurringAutoApproveDefault ?? false,
      // Spec 65.16 — project-level default preset
      socialImageStylePreset:
        project.value?.socialImageStylePreset ?? ("dark-neon-grid" as const),
    }),
    onSave: (data) =>
      apiPatch(`/projects/${slug}`, {
        recurringAutoApproveDefault: data.recurringAutoApproveDefault,
        socialImageStylePreset: data.socialImageStylePreset,
      }),
    invalidateKeys: [["project-settings", slug]],
  });

  watch(project, () => {
    basicsForm.resetFromUpstream();
    marketingForm.resetFromUpstream();
    costForm.resetFromUpstream();
    astroForm.resetFromUpstream();
    pagespeedForm.resetFromUpstream();
    translationForm.resetFromUpstream();
    socialForm.resetFromUpstream();
    discoveryForm.resetFromUpstream();
    llmModeForm.resetFromUpstream();
    recurringDefaultsForm.resetFromUpstream();
  });

  return {
    project,
    isLoading,
    basicsForm,
    marketingForm,
    costForm,
    astroForm,
    pagespeedForm,
    translationForm,
    socialForm,
    discoveryForm,
    cronStatus,
    triggerCron,
    llmModeForm,
    recurringDefaultsForm,
  };
}
