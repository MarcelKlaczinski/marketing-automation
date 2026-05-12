// scripts/diagnose-upsert-cluster-key.ts
//
// Diagnose-Test: simuliert was beim Re-Import passiert, prüft jeden Step
// für die suno DE Article.

import { articles, db, projects } from "@marketing-auto/db";
import { eq, and } from "drizzle-orm";
import { readFileSync } from "fs";
import { parseMdxContent } from "../../../../packages/adapters/astro-sync/src/import/parse-frontmatter.ts";

const ASTRO = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu";
const SLUG = "suno";
const LOCALE = "de";
const COLLECTION = "tools";
const PATH = `${ASTRO}/src/content/tools/de/suno.mdx`;
const RELATIVE_PATH = "src/content/tools/de/suno.mdx";

const [project] = await db
  .select({ id: projects.id })
  .from(projects)
  .where(eq(projects.slug, "toolwiki"))
  .limit(1);

if (!project) throw new Error("toolwiki project not found");

console.log("=== STEP 1: DB current state ===");
const [before] = await db
  .select()
  .from(articles)
  .where(
    and(
      eq(articles.projectId, project.id),
      eq(articles.collection, COLLECTION),
      eq(articles.slug, SLUG),
      eq(articles.locale, LOCALE)
    )
  )
  .limit(1);

console.log("clusterKey:", before?.clusterKey);
console.log("clusterRole:", before?.clusterRole);
console.log("gitSha:", before?.gitSha);
console.log("updatedAt:", before?.updatedAt);

console.log("\n=== STEP 2: Parser output ===");
const content = readFileSync(PATH, "utf-8");
const result = parseMdxContent(RELATIVE_PATH, content);
console.log("typed.clusterKey:", result.typed.clusterKey);
console.log("typed.clusterRole:", result.typed.clusterRole);
console.log("typed.intentType:", result.typed.intentType);

console.log("\n=== STEP 3: Simulate UpsertArticles (direct update) ===");
const updated = await db
  .update(articles)
  .set({
    clusterKey: result.typed.clusterKey ?? null,
    clusterRole: (result.typed.clusterRole as "hub" | "spoke" | null) ?? null,
    intentType: result.typed.intentType ?? null,
    updatedAt: new Date(),
  })
  .where(
    and(
      eq(articles.projectId, project.id),
      eq(articles.collection, COLLECTION),
      eq(articles.slug, SLUG),
      eq(articles.locale, LOCALE)
    )
  )
  .returning({
    id: articles.id,
    clusterKey: articles.clusterKey,
    clusterRole: articles.clusterRole,
  });

console.log("Updated row:", updated[0]);

console.log("\n=== STEP 4: Verify DB after direct update ===");
const [after] = await db
  .select({
    clusterKey: articles.clusterKey,
    clusterRole: articles.clusterRole,
  })
  .from(articles)
  .where(
    and(
      eq(articles.projectId, project.id),
      eq(articles.collection, COLLECTION),
      eq(articles.slug, SLUG),
      eq(articles.locale, LOCALE)
    )
  )
  .limit(1);

console.log("After direct update — clusterKey:", after?.clusterKey);
console.log("Direct update SUCCESS:", after?.clusterKey === result.typed.clusterKey);

// Revert change so Section B can do it cleanly:
const revertSet: { clusterKey: string | null; updatedAt?: Date } = {
  clusterKey: before?.clusterKey ?? null,
};
if (before?.updatedAt) revertSet.updatedAt = before.updatedAt;

await db
  .update(articles)
  .set(revertSet)
  .where(
    and(
      eq(articles.projectId, project.id),
      eq(articles.collection, COLLECTION),
      eq(articles.slug, SLUG),
      eq(articles.locale, LOCALE)
    )
  );

console.log("\nReverted change. Section B will do final fix.");
