#!/usr/bin/env bun
import { db, projects } from "@marketing-auto/db";

const slug = process.argv[2];
const name = process.argv[3];
const industry = (process.argv[4] ?? "ai_education") as
  | "ai_education"
  | "automotive_dealer"
  | "renewable_affiliate"
  | "music_school"
  | "other";
const pipelineTemplate = (process.argv[5] ?? "educational") as
  | "educational"
  | "affiliate_review"
  | "local_business"
  | "programmatic_seo";

if (!slug || !name) {
  console.error(
    "Usage: bun src/scripts/add-project.ts <slug> <name> [industry] [pipelineTemplate]"
  );
  console.error(
    "  industry: ai_education | automotive_dealer | renewable_affiliate | music_school | other"
  );
  console.error(
    "  pipelineTemplate: educational | affiliate_review | local_business | programmatic_seo"
  );
  process.exit(1);
}

const [project] = await db
  .insert(projects)
  .values({ slug, name, industry, pipelineTemplate })
  .onConflictDoNothing()
  .returning();

if (project) {
  console.log(`Created project: ${project.slug} (${project.name})`);
  console.log(`  id: ${project.id}`);
  console.log(
    `  Next: create project-contexts/${slug}/marketing-context.md, then run sync-context.`
  );
} else {
  console.log(`Project ${slug} already exists`);
}
process.exit(0);
