import { db, projects, contentCategories, eq, or, sql } from "@marketing-auto/db";

const rows = await db
  .select({
    id: projects.id,
    slug: projects.slug,
    domain: projects.domain,
    industry: projects.industry,
    targetNiche: projects.targetNiche,
    targetLocales: projects.targetLocales,
    classifierExamples: projects.classifierExamples,
    astroRepo: projects.astroRepo,
  })
  .from(projects)
  .where(or(sql`${projects.slug} ILIKE '%toolwiki%'`, sql`${projects.domain} ILIKE '%toolwiki%'`));

console.log("Projects matching toolwiki:");
console.log(
  JSON.stringify(
    rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      domain: r.domain,
      industry: r.industry,
      targetNiche: r.targetNiche,
      targetLocales: r.targetLocales,
      hasClassifierExamples: r.classifierExamples !== null,
      classifierExampleSampleKeys: r.classifierExamples ? Object.keys(r.classifierExamples).slice(0, 6) : [],
      astroRepo: r.astroRepo,
    })),
    null,
    2,
  ),
);

if (rows[0]) {
  const cats = await db
    .select({
      scope: contentCategories.scope,
      slug: contentCategories.slug,
    })
    .from(contentCategories)
    .where(eq(contentCategories.projectId, rows[0].id));

  const byScope = cats.reduce(
    (acc, c) => {
      if (!acc[c.scope]) acc[c.scope] = [];
      acc[c.scope].push(c.slug);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  console.log("\nCategories by scope:");
  for (const [scope, slugs] of Object.entries(byScope)) {
    console.log(`  ${scope}: ${slugs.length} → ${slugs.sort().join(", ")}`);
  }
}
process.exit(0);
