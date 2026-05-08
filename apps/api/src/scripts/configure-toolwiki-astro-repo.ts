#!/usr/bin/env bun
/**
 * One-shot script: set astroRepo config for the toolwiki project.
 * Run once after Spec 44+45 is merged and the project exists.
 */
import { db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

const owner = process.env.GITHUB_OWNER;
const installationId = process.env.GITHUB_INSTALLATION_ID
  ? Number(process.env.GITHUB_INSTALLATION_ID)
  : null;

if (!owner || !installationId || Number.isNaN(installationId)) {
  console.error("Usage: GITHUB_OWNER=<owner> GITHUB_INSTALLATION_ID=<id> bun src/scripts/configure-toolwiki-astro-repo.ts");
  console.error("");
  console.error("  GITHUB_OWNER:           github username or org that owns the toolwiki repo");
  console.error("  GITHUB_INSTALLATION_ID: numeric installation id from GitHub App settings");
  process.exit(1);
}

const astroRepo = {
  owner,
  name: "toolwiki",
  installationId,
  defaultBranch: "master",
  contentRoot: "src/content",
  assetsRoot: "src/assets",
};

const [updated] = await db
  .update(projects)
  .set({ astroRepo, updatedAt: new Date() })
  .where(eq(projects.slug, "toolwiki"))
  .returning({ id: projects.id, slug: projects.slug, astroRepo: projects.astroRepo });

if (!updated) {
  console.error("ERROR: project with slug 'toolwiki' not found.");
  console.error("       Run add-project.ts first.");
  process.exit(1);
}

console.log("Updated project:", updated.slug, "(id:", updated.id + ")");
console.log("astroRepo:", JSON.stringify(updated.astroRepo, null, 2));
process.exit(0);
