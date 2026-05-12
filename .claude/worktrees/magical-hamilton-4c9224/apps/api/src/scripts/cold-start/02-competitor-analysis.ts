#!/usr/bin/env bun
import { db, projects } from "@marketing-auto/db";
import { runPipeline } from "@marketing-auto/pipelines";
import {
  CompetitorAnalysisPipeline,
  CompetitorQuestionsPipeline,
} from "@marketing-auto/pipelines/cold-start";
import {
  COLD_START_FILES,
  DataBlockParseError,
  coldStartFile,
  parseDataBlock,
  readMarkdownIfExists,
  renderDataBlock,
  writeMarkdownAtomic,
} from "@marketing-auto/pipelines/cold-start/shared";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";

const log = createLogger("cold-start:competitor");

const slug = process.argv[2];
const mode = process.argv[3] ?? "questions";
const force = process.argv.includes("--force");

if (!slug) {
  console.error(
    "Usage: bun src/scripts/cold-start/02-competitor-analysis.ts <slug> [questions|analyze] [--force]"
  );
  process.exit(1);
}

const [project] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);

if (!project) {
  console.error(`Project not found: ${slug}. Create it via 'add-project' first.`);
  process.exit(1);
}

const outputPath = coldStartFile(slug, COLD_START_FILES.competitorAnalysis);

// ─── Mode: questions ──────────────────────────────────────────────────────────

if (mode === "questions") {
  const existing = await readMarkdownIfExists(outputPath);
  if (existing && !force) {
    console.error(
      `${outputPath} already exists. Use --force to overwrite (your edits will be lost).`
    );
    process.exit(1);
  }

  log.info({ slug }, "Identifying competitors");

  const result = await runPipeline(
    new CompetitorQuestionsPipeline(),
    { projectSlug: slug },
    { projectId: project.id }
  );

  if (!result.ok) {
    console.error(`Pipeline failed: ${result.error}`);
    process.exit(1);
  }

  const md = renderQuestionsMarkdown(
    slug,
    result.output.competitors,
    result.output.review_questions
  );
  await writeMarkdownAtomic(outputPath, md);

  console.log(
    `Written ${result.output.competitors.length} suggested competitors to:\n   ${outputPath}\n`
  );
  console.log(`Next:`);
  console.log(
    `  1. Edit the file — correct domains, add/remove competitors, answer the review questions`
  );
  console.log(
    `  2. Run analyze: bun --filter @marketing-auto/api cold-start:competitor-analysis ${slug} analyze`
  );
  process.exit(0);
}

// ─── Mode: analyze ────────────────────────────────────────────────────────────

if (mode === "analyze") {
  const questionsFile = await readMarkdownIfExists(outputPath);
  if (!questionsFile) {
    console.error(`${outputPath} not found. Run questions phase first.`);
    process.exit(1);
  }

  // Parse the competitor list Marcel confirmed/edited
  const CompetitorSchema = z.object({
    domain: z.string(),
    why_relevant: z.string(),
    expected_strengths: z.array(z.string()),
  });

  let competitors: z.infer<typeof CompetitorSchema>[];
  try {
    competitors = parseDataBlock(
      questionsFile,
      "competitors",
      z.array(CompetitorSchema).min(1).max(5)
    );
  } catch (e) {
    if (e instanceof DataBlockParseError) {
      console.error(`Could not parse competitor list from ${outputPath}:\n  ${e.message}`);
      console.error(`Make sure the <!-- DATA:competitors BEGIN/END --> block is intact.`);
    } else {
      console.error(e);
    }
    process.exit(1);
  }

  console.log(`Running competitor analysis for ${competitors.length} competitors:`);
  for (const c of competitors) {
    console.log(`  - ${c.domain}`);
  }
  console.log();

  log.info({ slug, competitorCount: competitors.length }, "Running competitor analysis");

  const result = await runPipeline(
    new CompetitorAnalysisPipeline(),
    { projectSlug: slug, competitors },
    { projectId: project.id }
  );

  if (!result.ok) {
    console.error(`Pipeline failed: ${result.error}`);
    process.exit(1);
  }

  // Write full report, keeping the competitor DATA block intact at the top,
  // plus the new content-gaps and topics-to-avoid DATA blocks at the bottom.
  const fullMd = [
    result.output.reportMd,
    "",
    "---",
    "",
    "## Confirmed Competitors",
    "",
    renderDataBlock("competitors", competitors),
    "",
    renderDataBlock("content-gaps", result.output.contentGaps),
    "",
    renderDataBlock("topics-to-avoid", result.output.topicsToAvoid),
  ].join("\n");

  await writeMarkdownAtomic(outputPath, fullMd);

  console.log(`Competitor analysis written to:\n   ${outputPath}\n`);
  console.log(`Content gaps found: ${result.output.contentGaps.length}`);
  console.log(`Topics to avoid: ${result.output.topicsToAvoid.length}`);
  console.log(`\nNext:`);
  console.log(`  1. Review ${outputPath}`);
  console.log(
    `  2. Then run phase 3: bun --filter @marketing-auto/api cold-start:cluster-plan ${slug}`
  );
  process.exit(0);
}

console.error(`Unknown mode: ${mode}. Expected "questions" or "analyze".`);
process.exit(1);

// ─── Renderer ────────────────────────────────────────────────────────────────

function renderQuestionsMarkdown(
  projectSlug: string,
  competitors: Array<{
    domain: string;
    why_relevant: string;
    expected_strengths: string[];
  }>,
  reviewQuestions: Array<{
    id: string;
    question: string;
    why_it_matters: string;
  }>
): string {
  const sections: string[] = [
    `# Competitor Analysis: ${projectSlug}`,
    "",
    "AI has suggested the competitors below based on your marketing context.",
    "",
    "**Your tasks before running the analyze phase:**",
    "1. Review each competitor in the DATA block — correct domains, add missing ones, or remove irrelevant ones",
    "2. Keep the total between 1 and 5 competitors",
    "3. Answer the review questions at the bottom",
    "4. Run analyze: `bun --filter @marketing-auto/api cold-start:competitor-analysis " +
      projectSlug +
      " analyze`",
    "",
    "> **Important:** Only edit the YAML inside the DATA block. The `<!-- DATA:competitors BEGIN/END -->` markers must stay intact.",
    "",
    "---",
    "",
    renderDataBlock("competitors", competitors),
    "",
    "---",
    "",
    "## Review Questions",
    "",
    "Answer these before running the analyze phase. They inform whether the list above is complete.",
    "",
  ];

  for (const q of reviewQuestions) {
    sections.push(`### ${q.id}: ${q.question}`);
    sections.push("");
    sections.push(`*Why it matters: ${q.why_it_matters}*`);
    sections.push("");
    sections.push(`**Your answer:**`);
    sections.push("");
    sections.push("");
  }

  sections.push("## Additional Notes");
  sections.push("");
  sections.push("(add any observations, priority notes, or context here)");
  sections.push("");

  return sections.join("\n");
}
