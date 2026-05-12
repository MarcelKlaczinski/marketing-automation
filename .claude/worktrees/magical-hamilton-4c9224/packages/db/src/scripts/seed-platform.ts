#!/usr/bin/env bun
/**
 * One-time seed: creates the synthetic "platform" project that owns
 * cost_logs from non-tenant operations (auth emails, system alerts).
 *
 * Idempotent — safe to run multiple times.
 */
import { eq } from "drizzle-orm";
import { db, projects } from "../index.ts";

const PLATFORM_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

const [existing] = await db
  .select({ id: projects.id })
  .from(projects)
  .where(eq(projects.id, PLATFORM_PROJECT_ID))
  .limit(1);

if (existing) {
  console.log("ℹ️  Platform project already exists");
  process.exit(0);
}

await db.insert(projects).values({
  id: PLATFORM_PROJECT_ID,
  slug: "_platform",
  name: "Platform (synthetic — not a real tenant)",
  industry: "other",
  pipelineTemplate: "educational",
  costLimits: { daily: { smtp: 0 }, monthly: { smtp: 0 } },
});

console.log(`✅ Platform project created (id: ${PLATFORM_PROJECT_ID})`);
process.exit(0);
