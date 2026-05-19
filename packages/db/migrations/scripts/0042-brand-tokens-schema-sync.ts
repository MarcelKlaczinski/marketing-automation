/**
 * Migration 0042 — brand_tokens Schema Sync (Spec 60.0)
 *
 * Transforms all existing projects.brand_tokens JSONB values to match the
 * canonical brandTokensSchema from @marketing-auto/shared/brand-tokens:
 *   - Rename  primaryHue → brandHue
 *   - Derive  brandHue from colors.primary oklch string (fallback: 248)
 *   - Derive  accentHue from colors.accent oklch string (fallback: 168)
 *   - Drop    DB-only typography fields never consumed by the renderer
 *
 * Idempotent: running twice produces the same result.
 * Creates a backup table first; restore with:
 *   UPDATE projects p SET brand_tokens = b.brand_tokens
 *   FROM projects_brand_tokens_backup_0042 b WHERE p.id = b.id;
 *
 * Run:
 *   bun --env-file ../../.env migrations/scripts/0042-brand-tokens-schema-sync.ts
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../../src/client.ts";
import { projects } from "../../src/schema/projects.ts";
import { brandTokensSchema } from "@marketing-auto/shared/brand-tokens";

// ─── Fields removed in 60.0 (DB-only, never read by the renderer) ────────────

const DEPRECATED_TYPOGRAPHY_FIELDS = [
  "fontFamilyOptions",
  "eyebrowWeight",
  "captionWeight",
  "headingLetterSpacing",
  "bodyLetterSpacing",
  "headingSize",
  "subheadSize",
  "bodySize",
  "eyebrowSize",
  "headingLineHeight",
  "bodyLineHeight",
] as const;

// ─── Transform logic (exported for unit tests) ────────────────────────────────

export function transformBrandTokens(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const colors: Record<string, unknown> = {
    ...((input.colors as Record<string, unknown>) ?? {}),
  };
  const typography: Record<string, unknown> = {
    ...((input.typography as Record<string, unknown>) ?? {}),
  };
  const voice: Record<string, unknown> = {
    ...((input.voice as Record<string, unknown>) ?? {}),
  };
  const social: Record<string, unknown> = {
    ...((input.social as Record<string, unknown>) ?? {}),
  };

  // Rename primaryHue → brandHue (keep deprecated primaryHue in place for back-compat)
  if (colors.primaryHue !== undefined && colors.brandHue === undefined) {
    colors.brandHue = colors.primaryHue;
  }

  // Derive brandHue from primary oklch string if still absent
  if (colors.brandHue === undefined) {
    colors.brandHue = extractHueFromOklch(colors.primary as string | undefined) ?? 248;
  }

  // Derive accentHue from accent oklch string if absent
  if (colors.accentHue === undefined) {
    colors.accentHue = extractHueFromOklch(colors.accent as string | undefined) ?? 168;
  }

  // Sanitize addressForm: only "du" | "Sie" are valid; default to "du"
  if (voice.addressForm !== undefined && voice.addressForm !== "du" && voice.addressForm !== "Sie") {
    voice.addressForm = "du";
  }

  // Drop DB-only typography fields never consumed by the renderer
  for (const field of DEPRECATED_TYPOGRAPHY_FIELDS) {
    delete typography[field];
  }

  return { colors, typography, voice, social };
}

export function extractHueFromOklch(value: string | undefined): number | null {
  if (!value || typeof value !== "string") return null;
  // Match oklch(L% C H) or oklch(L C H) — capture the hue (third number)
  const match = value.match(/oklch\(\s*[\d.]+%?\s+[\d.]+\s+([\d.]+)/i);
  if (!match?.[1]) return null;
  const hue = parseFloat(match[1]);
  return Number.isFinite(hue) ? hue : null;
}

// ─── Main migration ───────────────────────────────────────────────────────────

export async function run(): Promise<void> {
  // Step 1: backup
  console.log("Creating backup table projects_brand_tokens_backup_0042 ...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects_brand_tokens_backup_0042 AS
    SELECT id, brand_tokens, NOW() AS backed_up_at FROM projects
  `);
  console.log("Backup created.");

  // Step 2: load and transform
  const allProjects = await db
    .select({ id: projects.id, name: projects.name, brandTokens: projects.brandTokens })
    .from(projects);

  console.log(`Migrating ${allProjects.length} project(s) ...`);
  let migrated = 0;

  for (const project of allProjects) {
    const original = (project.brandTokens ?? {}) as Record<string, unknown>;
    const transformed = transformBrandTokens(original);
    // Compare after parsing through the canonical schema so key-order differences
    // (PostgreSQL JSONB normalises key order) don't cause spurious re-writes.
    const originalCanonical = JSON.stringify(brandTokensSchema.parse(original));
    const transformedCanonical = JSON.stringify(brandTokensSchema.parse(transformed));
    const changed = transformedCanonical !== originalCanonical;

    if (changed) {
      await db
        .update(projects)
        // biome-ignore lint/suspicious/noExplicitAny: transformed shape is a partial JSONB blob; brandTokensSchema.parse() applies defaults at read time
        .set({ brandTokens: transformed as any })
        .where(eq(projects.id, project.id));
      console.log(`  ✓ Migrated: ${project.name} (${project.id})`);
      migrated++;
    } else {
      console.log(`  – No change: ${project.name} (${project.id})`);
    }
  }

  console.log(`\nMigrated ${migrated}/${allProjects.length} project(s).`);

  // Step 3: post-migration validation — every row must parse against the new schema
  console.log("\nValidating all projects against brandTokensSchema ...");
  const refreshed = await db
    .select({ id: projects.id, name: projects.name, brandTokens: projects.brandTokens })
    .from(projects);

  let failures = 0;
  for (const project of refreshed) {
    const result = brandTokensSchema.safeParse(project.brandTokens ?? {});
    if (!result.success) {
      console.error(
        `  ✗ Project ${project.name} (${project.id}) FAILS schema validation:`,
        result.error.format(),
      );
      failures++;
    }
  }

  if (failures > 0) {
    throw new Error(
      `Migration left invalid data in ${failures} project(s). ` +
        "Restore from backup: UPDATE projects p SET brand_tokens = b.brand_tokens " +
        "FROM projects_brand_tokens_backup_0042 b WHERE p.id = b.id;",
    );
  }

  console.log(`All ${refreshed.length} project(s) pass schema validation. ✓`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

if (import.meta.main) {
  await run();
  console.log("\nDone.");
  process.exit(0);
}
