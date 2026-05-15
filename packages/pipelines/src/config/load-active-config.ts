import { and, eq } from "@marketing-auto/db";
import { db, projectConfigurations, type ProjectConfiguration } from "@marketing-auto/db";
import { TopicScopeSchema, MasterPromptsSchema } from "@marketing-auto/db";

// In-process cache: projectId → active config + cached-at timestamp.
// 60s TTL — short enough for SQL edits to take effect in dev, long enough to amortize across batch jobs.
const cache = new Map<string, { config: ProjectConfiguration; cachedAt: number }>();
const TTL_MS = 60_000;

export async function loadActiveConfig(projectId: string): Promise<ProjectConfiguration> {
  const cached = cache.get(projectId);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    return cached.config;
  }

  const [raw] = await db
    .select()
    .from(projectConfigurations)
    .where(
      and(
        eq(projectConfigurations.projectId, projectId),
        eq(projectConfigurations.status, "active"),
      ),
    )
    .limit(1);

  if (!raw) {
    throw new Error(
      `No active project_configuration for project ${projectId}. ` +
        `System invariant violation — every project must have an active config.`,
    );
  }

  // Parse JSONB fields through their schemas so Zod .default() values are applied
  // to rows stored before new fields were added (e.g. 54.2 → 54.5 schema migration).
  const config: ProjectConfiguration = {
    ...raw,
    topicScope: TopicScopeSchema.parse(raw.topicScope),
    masterPrompts: MasterPromptsSchema.parse(raw.masterPrompts ?? {}),
  };

  cache.set(projectId, { config, cachedAt: Date.now() });
  return config;
}

export function clearConfigCache(projectId?: string): void {
  if (projectId) cache.delete(projectId);
  else cache.clear();
}
