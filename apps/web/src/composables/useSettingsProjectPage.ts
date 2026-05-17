import { watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet, apiPatch } from "src/lib/api";
import { useSectionForm } from "./useSectionForm";

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
      localPath: project.value?.astroRepo?.localPath ?? "",
      defaultBranch: project.value?.astroRepo?.defaultBranch ?? "main",
    }),
    onSave: (data) => {
      const existing = project.value?.astroRepo;
      if (!existing) return apiPatch(`/projects/${slug}`, {});
      const astroRepo: AstroRepoConfig = {
        ...existing,
        defaultBranch: data.defaultBranch,
      };
      if (data.localPath) astroRepo.localPath = data.localPath;
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

  watch(project, () => {
    basicsForm.resetFromUpstream();
    marketingForm.resetFromUpstream();
    costForm.resetFromUpstream();
    astroForm.resetFromUpstream();
    pagespeedForm.resetFromUpstream();
    translationForm.resetFromUpstream();
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
  };
}
