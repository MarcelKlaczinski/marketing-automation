import { resolve, join } from "node:path";

const PROJECT_CONTEXTS_ROOT = resolve(import.meta.dir, "../../../../../project-contexts");

export function projectContextDir(slug: string): string {
  return join(PROJECT_CONTEXTS_ROOT, slug);
}

export function coldStartDir(slug: string): string {
  return join(projectContextDir(slug), "cold-start");
}

export function coldStartFile(slug: string, filename: string): string {
  return join(coldStartDir(slug), filename);
}

export const COLD_START_FILES = {
  voiceRefinement:    "01-voice-refinement.md",
  competitorAnalysis: "02-competitor-analysis.md",
  clusterPlan:        "03-cluster-plan.md",
  cornerstoneList:    "04-cornerstone-list.md",
  goLiveChecklist:    "05-go-live-checklist.md",
} as const;
