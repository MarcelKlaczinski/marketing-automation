#!/usr/bin/env bun
import { copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { runPipeline } from "@marketing-auto/pipelines";
import {
  VoiceRefinementQuestionsPipeline,
  VoiceSynthesisPipeline,
} from "@marketing-auto/pipelines/cold-start";
import {
  coldStartFile,
  COLD_START_FILES,
  readMarkdownIfExists,
  writeMarkdownAtomic,
} from "@marketing-auto/pipelines/cold-start/shared";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cold-start:voice");

const slug = process.argv[2];
const mode = process.argv[3] ?? "questions";
const force = process.argv.includes("--force");

if (!slug) {
  console.error("Usage: bun src/scripts/cold-start/01-voice-refinement.ts <slug> [questions|synthesize] [--force]");
  process.exit(1);
}

const [project] = await db
  .select()
  .from(projects)
  .where(eq(projects.slug, slug))
  .limit(1);

if (!project) {
  console.error(`Project not found: ${slug}. Create it via 'add-project' first.`);
  process.exit(1);
}

if (!project.marketingContextMd) {
  console.error(`Project ${slug} has no marketingContextMd. Run sync-context first.`);
  process.exit(1);
}

const contextMd: string = project.marketingContextMd;

if (mode === "questions") {
  const outputPath = coldStartFile(slug, COLD_START_FILES.voiceRefinement);
  const existing = await readMarkdownIfExists(outputPath);

  if (existing && !force) {
    console.error(`${outputPath} already exists. Use --force to overwrite (your answers will be lost).`);
    process.exit(1);
  }

  log.info({ slug }, "Generating voice refinement questions");

  const result = await runPipeline(
    new VoiceRefinementQuestionsPipeline(),
    { projectSlug: slug, existingContextMd: contextMd },
    { projectId: project.id },
  );

  if (!result.ok) {
    console.error(`Pipeline failed: ${result.error}`);
    process.exit(1);
  }

  const md = renderQuestionsMarkdown(slug, result.output.questions);
  await writeMarkdownAtomic(outputPath, md);

  console.log(`Written ${result.output.questions.length} questions to:\n   ${outputPath}\n`);
  console.log(`Next:`);
  console.log(`  1. Edit the file — answer each question under its heading`);
  console.log(`  2. Run synthesis: bun --filter @marketing-auto/api cold-start:voice-refinement ${slug} synthesize`);
  console.log(`  3. Review the updated marketing-context.md, then run sync-context`);
  process.exit(0);
}

if (mode === "synthesize") {
  const questionsPath = coldStartFile(slug, COLD_START_FILES.voiceRefinement);
  const answered = await readMarkdownIfExists(questionsPath);

  if (!answered) {
    console.error(`${questionsPath} not found. Run questions phase first.`);
    process.exit(1);
  }

  log.info({ slug }, "Synthesizing updated marketing-context.md");

  const result = await runPipeline(
    new VoiceSynthesisPipeline(),
    {
      projectSlug: slug,
      existingContextMd: contextMd,
      answeredQuestionsMd: answered,
    },
    { projectId: project.id },
  );

  if (!result.ok) {
    console.error(`Pipeline failed: ${result.error}`);
    process.exit(1);
  }

  const contextPath = join(dirname(questionsPath), "..", "marketing-context.md");
  const backupPath = `${contextPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(contextPath, backupPath);
  await writeMarkdownAtomic(contextPath, result.output.updatedMarketingContextMd);

  console.log(`Updated marketing-context.md`);
  console.log(`Backup at: ${backupPath}`);
  console.log(`\nChanges:`);
  for (const change of result.output.changesSummary) {
    console.log(`  - ${change}`);
  }
  console.log(`\nNext:`);
  console.log(`  1. Review the updated marketing-context.md`);
  console.log(`  2. Run: bun --filter @marketing-auto/api sync-context ${slug}`);
  console.log(`  3. Then start phase 2: cold-start:competitor-analysis`);
  process.exit(0);
}

console.error(`Unknown mode: ${mode}. Expected "questions" or "synthesize".`);
process.exit(1);

// ─── Renderer ────────────────────────────────────────────────────────────────

function renderQuestionsMarkdown(
  projectSlug: string,
  questions: Array<{
    id: string;
    category: string;
    question: string;
    why_it_matters: string;
    suggested_starter: string;
  }>,
): string {
  const grouped = new Map<string, typeof questions>();
  for (const q of questions) {
    const arr = grouped.get(q.category) ?? [];
    arr.push(q);
    grouped.set(q.category, arr);
  }

  const sections: string[] = [
    `# Voice Refinement: ${projectSlug}`,
    "",
    "Answer each question under its heading. The synthesis phase will integrate your answers",
    "into the updated marketing-context.md.",
    "",
    "**Tips:**",
    "- Be specific. Vague answers produce vague brand voice.",
    "- Disagree with the suggested starter freely — it's just a prompt, not a constraint.",
    "- If a question is irrelevant, write 'skip' below it.",
    "- You can add your own questions in a `## Additional` section at the bottom.",
    "",
    "---",
    "",
  ];

  for (const [category, qs] of grouped) {
    sections.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    sections.push("");
    for (const q of qs) {
      sections.push(`### ${q.id}: ${q.question}`);
      sections.push("");
      sections.push(`*Why it matters: ${q.why_it_matters}*`);
      sections.push("");
      sections.push(`*Suggested starter: ${q.suggested_starter}*`);
      sections.push("");
      sections.push(`**Your answer:**`);
      sections.push("");
      sections.push("");
    }
  }

  sections.push("## Additional");
  sections.push("");
  sections.push("(add your own observations, edge cases, or questions here)");
  sections.push("");

  return sections.join("\n");
}
