/**
 * Seed tool icons for a project into project_brand_assets.
 * Reads all articles with collectionType='tool' and tries to map each slug
 * to a lobe-icons PNG. Falls back to 'deterministic-avatar' source.
 *
 * Usage:
 *   bun --env-file ../../.env apps/api/src/scripts/seed-tool-icons.ts <project-slug>
 */

import { eq } from "drizzle-orm";
import { db, articles, projects } from "@marketing-auto/db";
import {
  findLobeIcon,
  getLobeIconRef,
  upsertBrandAsset,
  TOOL_SLUG_TO_LOBE,
} from "../lib/brand-asset-service.ts";

const projectSlug = process.argv[2];
if (!projectSlug) {
  console.error("Usage: seed-tool-icons.ts <project-slug>");
  process.exit(1);
}

const project = await db.query.projects.findFirst({
  where: eq(projects.slug, projectSlug),
  columns: { id: true, slug: true },
});
if (!project) {
  console.error(`Project '${projectSlug}' not found`);
  process.exit(1);
}

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`Seeding tool icons for project '${projectSlug}' (${project.id})...`);

// 0. Seed logo wordmark
await upsertBrandAsset({
  projectId: project.id,
  assetType: "logo",
  assetKey: "main",
  source: "wordmark",
  sourceRef: "toolwiki.ai",
  displayName: "toolwiki.ai Wordmark",
  metadata: {},
});
// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("✓ Logo (wordmark: toolwiki.ai) seeded");

const toolArticles = await db.query.articles.findMany({
  where: eq(articles.projectId, project.id),
  columns: { slug: true, title: true },
});

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`Found ${toolArticles.length} tool articles.`);

let mapped = 0;
let fallback = 0;

for (const article of toolArticles) {
  const toolSlug = article.slug;
  const lobeSlug = TOOL_SLUG_TO_LOBE[toolSlug] ?? toolSlug;
  const filePath = await findLobeIcon(lobeSlug, "dark");

  if (filePath) {
    await upsertBrandAsset({
      projectId: project.id,
      assetType: "tool_icon",
      assetKey: toolSlug,
      source: "lobe-icons",
      sourceRef: getLobeIconRef(lobeSlug),
      displayName: article.title ?? toolSlug,
      metadata: { lobeSlug },
    });
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`  ✓ ${toolSlug} → lobe-icons/${lobeSlug}`);
    mapped++;
  } else {
    // No lobe-icon found — skip comparison/roundup articles silently
    fallback++;
  }
}

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log(`\nDone. Mapped: ${mapped}, Fallback: ${fallback}`);
process.exit(0);
