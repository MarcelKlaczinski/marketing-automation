import { eq } from "@marketing-auto/db";
import { db, contentPillars, type IntentTaxonomy } from "@marketing-auto/db";
import { loadActiveConfig } from "./load-active-config.ts";

export async function resolveIntentTaxonomy(args: {
  projectId: string;
  pillarId: string | null;
}): Promise<IntentTaxonomy> {
  const config = await loadActiveConfig(args.projectId);

  if (!args.pillarId) {
    return config.intentTaxonomyDefault;
  }

  const [pillar] = await db
    .select({ override: contentPillars.intentTaxonomyOverride })
    .from(contentPillars)
    .where(eq(contentPillars.id, args.pillarId))
    .limit(1);

  return pillar?.override ?? config.intentTaxonomyDefault;
}
