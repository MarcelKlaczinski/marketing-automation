import { type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet, apiPatch, apiPost } from "src/lib/api";
import { useSectionForm } from "./useSectionForm";

export interface CronJobStatus {
  isActive: boolean;
  cronPattern: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  nextRunAt: string | null;
}

export interface CronStatusData {
  trendsSynthesizer: CronJobStatus;
  refreshDetector: CronJobStatus;
  qualityAnalysis: CronJobStatus;
}

interface DiscoveryProject {
  trendsCronEnabled: boolean;
  refreshCronEnabled: boolean;
  qualityAnalysisCronEnabled: boolean;
  autoApproveGaps: boolean;
  refreshStalenessThresholdDays: number;
}

export function useDiscoverySettings(slug: string, project: Ref<DiscoveryProject | undefined>) {
  const { data: cronStatus, refetch: refetchCronStatus } = useQuery({
    queryKey: ["cron-status", slug],
    queryFn: () => apiGet<CronStatusData>(`/projects/${slug}/cron-status`),
    refetchInterval: 60_000,
  });

  const discoveryForm = useSectionForm({
    initialData: () => ({
      trendsCronEnabled: project.value?.trendsCronEnabled ?? false,
      refreshCronEnabled: project.value?.refreshCronEnabled ?? false,
      qualityAnalysisCronEnabled: project.value?.qualityAnalysisCronEnabled ?? false,
      autoApproveGaps: project.value?.autoApproveGaps ?? false,
      refreshStalenessThresholdDays: String(project.value?.refreshStalenessThresholdDays ?? 90),
    }),
    onSave: (data) =>
      apiPatch(`/projects/${slug}`, {
        trendsCronEnabled: data.trendsCronEnabled,
        refreshCronEnabled: data.refreshCronEnabled,
        qualityAnalysisCronEnabled: data.qualityAnalysisCronEnabled,
        autoApproveGaps: data.autoApproveGaps,
        refreshStalenessThresholdDays: parseInt(data.refreshStalenessThresholdDays, 10),
      }),
    invalidateKeys: [
      ["project-settings", slug],
      ["cron-status", slug],
    ],
  });

  const triggerCron = async (jobType: "trends_synthesizer" | "refresh_detector" | "quality_analysis") => {
    await apiPost(`/projects/${slug}/cron-status/run`, { jobType });
    void refetchCronStatus();
  };

  return { discoveryForm, cronStatus, triggerCron };
}
