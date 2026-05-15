#!/usr/bin/env bun
/**
 * Manually trigger signal collection for a project.
 * Usage: bun --filter @marketing-auto/api signals:collect <slug>
 */
import { db, projects } from "@marketing-auto/db";
import { eq } from "@marketing-auto/db";
import { getSignalCollectorQueue } from "../../workers/signal-collector.ts";

const slug = process.argv[2];

if (!slug) {
  console.error("Usage: bun src/scripts/signals/collect.ts <project-slug>");
  process.exit(1);
}

const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
const project = rows[0];
if (!project) {
  console.error(`Project not found: ${slug}`);
  process.exit(1);
}

const queue = getSignalCollectorQueue();
await queue.add("collect-project", { type: "collect-project", projectId: project.id });

console.log(`Enqueued collect-project for ${slug} (${project.id})`);
console.log(`Monitor: SELECT source, COUNT(*) FROM external_signals WHERE project_id = '${project.id}' GROUP BY source;`);

process.exit(0);
