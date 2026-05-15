#!/usr/bin/env bun
/**
 * Manually trigger trend synthesis for a project.
 * Usage: bun --filter @marketing-auto/api trends:synthesize <slug>
 *
 * Enqueues a synthesize-project job — the trend-synthesizer worker must be running.
 * Monitor results: SELECT topic_title, jsonb_pretty(trend_metadata) FROM topic_briefs
 *                  WHERE source = 'trend_discovery' ORDER BY created_at DESC LIMIT 5;
 */
import { db, projects, eq } from "@marketing-auto/db";
import { getTrendSynthesizerQueue } from "../../workers/trend-synthesizer.ts";

const slug = process.argv[2];

if (!slug) {
  console.error("Usage: bun src/scripts/trends/synthesize.ts <project-slug>");
  process.exit(1);
}

const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
const project = rows[0];

if (!project) {
  console.error(`Project not found: ${slug}`);
  process.exit(1);
}

const queue = getTrendSynthesizerQueue();
await queue.add(
  "synthesize-project",
  { type: "synthesize-project", projectId: project.id },
  { jobId: `synthesize-project-${project.id}-manual-${Date.now()}` },
);

console.log(`Enqueued synthesize-project for ${slug} (${project.id})`);
console.log(`Monitor briefs:     SELECT topic_title, approval_status, jsonb_pretty(trend_metadata) FROM topic_briefs WHERE source = 'trend_discovery' AND project_id = '${project.id}' ORDER BY created_at DESC LIMIT 5;`);
console.log(`Monitor rejections: SELECT topic_title, reason, similarity_score, trend_score FROM rejected_topic_candidates WHERE project_id = '${project.id}' ORDER BY rejected_at DESC LIMIT 10;`);
console.log(`Monitor signals:    SELECT source, COUNT(*) FROM external_signals WHERE project_id = '${project.id}' AND processed_at IS NOT NULL GROUP BY source;`);

process.exit(0);
