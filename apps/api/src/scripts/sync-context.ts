#!/usr/bin/env bun
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { z } from "zod";
import matter from "gray-matter";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("sync-context");

const frontmatterSchema = z.object({
  slug: z.string().min(1),
  language: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  region: z.string().length(2),
  pronounStyle: z.enum(["du", "Sie"]).optional(),
  anglicismPolicy: z.enum(["avoid", "pragmatic", "embrace"]).optional(),
  humorLevel: z.enum(["dry", "pragmatic", "pointed"]).optional(),
  schemaVersion: z.literal(1),
});

// import.meta.dir = apps/api/src/scripts/
const projectContextsRoot = resolve(import.meta.dir, "../../../../project-contexts");

async function syncOne(slug: string): Promise<void> {
  const path = join(projectContextsRoot, slug, "marketing-context.md");
  const raw = await readFile(path, "utf-8");
  const parsed = matter(raw);

  const fm = frontmatterSchema.safeParse(parsed.data);
  if (!fm.success) {
    log.error({ slug, errors: fm.error.flatten() }, "Frontmatter validation failed");
    throw new Error(`Invalid frontmatter for ${slug}`);
  }

  const md = parsed.content.trim();

  const rows = await db
    .select({ id: projects.id, brandIdentity: projects.brandIdentity, targetAudience: projects.targetAudience })
    .from(projects)
    .where(eq(projects.slug, fm.data.slug))
    .limit(1);

  const existing = rows[0];
  if (!existing) {
    log.error({ slug: fm.data.slug }, "Project not found in DB — run add-project first.");
    throw new Error(`Project not found: ${fm.data.slug}`);
  }

  // "Sie" → "sie" to match BrandIdentity's lowercase union; "du" passes through unchanged
  const normalizedPronounStyle: "du" | "sie" | undefined =
    fm.data.pronounStyle === "Sie" ? "sie" : fm.data.pronounStyle;

  const newBrandIdentity = {
    ...existing.brandIdentity,
    ...(normalizedPronounStyle !== undefined && { pronounStyle: normalizedPronounStyle }),
    ...(fm.data.anglicismPolicy !== undefined && { anglicismPolicy: fm.data.anglicismPolicy }),
    ...(fm.data.humorLevel !== undefined && { humorLevel: fm.data.humorLevel }),
  };

  const newTargetAudience = {
    ...existing.targetAudience,
    language: fm.data.language,
    region: fm.data.region,
  };

  await db
    .update(projects)
    .set({
      marketingContextMd: md,
      marketingContextUpdatedAt: new Date(),
      brandIdentity: newBrandIdentity,
      targetAudience: newTargetAudience,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, existing.id));

  log.info({ slug: fm.data.slug, mdSizeBytes: md.length }, "Project context synced");
}

async function syncAll(): Promise<void> {
  const dirs = await readdir(projectContextsRoot, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    try {
      await syncOne(d.name);
    } catch (e) {
      log.error({ slug: d.name, err: e }, "Failed to sync");
    }
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: bun src/scripts/sync-context.ts <slug|--all>");
  process.exit(1);
}

if (arg === "--all") {
  await syncAll();
} else {
  await syncOne(arg);
}
process.exit(0);
