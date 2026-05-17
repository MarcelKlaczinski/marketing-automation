import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { ActivitySource, PipelineRunSummary, PipelineStatus } from "src/types/ui";

interface ActivityEntry {
  id: string;
  source: string;
  type: string;
  status: string;
  title: string;
  subtitle: string | null;
  errorMessage: string | null;
  articleSlug: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

const VALID_SOURCES = new Set<ActivitySource>([
  "pipeline_runs", "astro_sync_runs", "pagespeed_runs",
  "schema_extension_runs", "link_rebuild_runs",
]);

const VALID_STATUSES = new Set(["queued", "running", "completed", "failed", "cancelled"]);

/**
 * Returns all recent pipeline activity for the current project (running, queued,
 * and completed/failed within the last 24 h). Uses the /active endpoint which
 * returns enriched entries with article title + pipeline subtitle.
 * Refetches every 30 s; SSE events from usePipelineEvents invalidate in real-time.
 */
export function useActivityFeed() {
  const projectStore = useProjectStore();

  return useQuery({
    queryKey: ["pipeline-runs", "active", projectStore.currentSlug],
    queryFn: async () => {
      const result = await apiGet<{ entries: ActivityEntry[] }>(
        `/projects/${projectStore.currentSlug}/pipeline-runs/active`,
      );
      return result.entries.map((e): PipelineRunSummary => ({
        id: e.id,
        source: (VALID_SOURCES.has(e.source as ActivitySource) ? e.source : "pipeline_runs") as ActivitySource,
        type: e.type,
        status: (VALID_STATUSES.has(e.status) ? e.status : "failed") as PipelineStatus,
        title: e.title,
        subtitle: e.subtitle,
        createdAt: e.createdAt,
        startedAt: e.startedAt,
        completedAt: e.finishedAt,
        currentStep: null,
        stepCount: 0,
        completedSteps: 0,
        costEur: null,
        errorMessage: e.errorMessage,
        articleSlug: e.articleSlug,
      }));
    },
    refetchInterval: 30_000,
    enabled: !!projectStore.currentSlug,
  });
}
