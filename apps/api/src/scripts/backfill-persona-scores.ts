/**
 * Spec 65.3 — backfill `tool_persona_scores` rows for every tool-article in
 * a project. Mirrors the Spec 65.2 `backfill-tool-brand-assets.ts` shape
 * (dry-run default, --apply opt-in, --force, project-scoped per Memory D23).
 *
 * Each candidate tool gets ONE Haiku call scoring all 10 personas (Option α
 * batch from spec §3.1). ~€0.01/call → ~€1.10 for the 108-tool Toolwiki
 * backfill.
 *
 * Default mode is dry-run (count + per-tool preview). Pass `--apply` to
 * actually run the LLM calls.
 *
 * Usage:
 *   bun --filter @marketing-auto/api backfill-persona-scores --project=<slug> [--apply]
 *
 * Flags:
 *   --project <slug>   MANDATORY (Memory D23). Backfill is project-scoped.
 *   --apply            Actually call Haiku + write scores. Without this flag
 *                      the script only counts candidates.
 *   --force            Re-score tools that already have fresh scores.
 *   --batch-size <n>   Tools processed per batch. Default: 5 (parallel-3
 *                      inside scoreToolForPersonas).
 *   --limit <n>        Optional hard cap on total tools processed.
 */
import { parseArgs } from "node:util";
import {
  and,
  articles,
  db,
  eq,
  gte,
  inArray,
  projects,
  toolPersonaScores,
} from "@marketing-auto/db";
import {
  DEFAULT_PERSONAS,
  type DefaultPersona,
  createLogger,
} from "@marketing-auto/shared";
import {
  type ScoreToolForPersonasInput,
  type ScoreToolResult,
  scoreToolForPersonas,
} from "../lib/persona-scoring/score-tool-for-personas.ts";

const log = createLogger("backfill-persona-scores");

/** Marcel-Decision §3.4 — 6-month TTL. */
const FRESH_WINDOW_DAYS = 180;
/** Default: process 5 tools per batch (small to keep dry-run responsive). */
const DEFAULT_BATCH_SIZE = 5;

function resolvePrimaryLocale(projectTargetLocales: string[] | null): string {
  const first = projectTargetLocales?.[0];
  if (!first) return "de";
  return first.split("-")[0] ?? "de";
}

interface ToolCandidate {
  id: string;
  slug: string | null;
  name: string | null;
}

/** DI seam (Pattern 121): callers can inject a fake `scoreToolFn` in tests. */
export interface BackfillPersonaScoresPorts {
  scoreToolFn?: (input: ScoreToolForPersonasInput) => Promise<ScoreToolResult>;
}

export interface BackfillPersonaScoresOptions extends BackfillPersonaScoresPorts {
  projectSlug: string;
  apply: boolean;
  /**
   * Re-score tools that already have fresh scores. Default: only re-score
   * tools with at least one missing OR stale persona-score row.
   */
  force?: boolean;
  batchSize?: number;
  limit?: number;
}

export interface BackfillPersonaScoresSummary {
  projectSlug: string;
  candidatesBeforeRun: number;
  totalProcessed: number;
  bySource: { llm: number; skipped: number; failed: number };
  scoresWritten: number;
  errors: Array<{ toolId: string; error: string }>;
  dryRun: boolean;
}

/**
 * Tools eligible for scoring: every `articles WHERE collection='tools'`
 * in the project's primary locale. We always use the primary locale to
 * avoid double-scoring DE+EN sibling tool-articles — persona scoring is
 * project-scoped via the composite PK and only one locale's row carries it.
 */
async function listEligibleTools(projectId: string, locale: string): Promise<ToolCandidate[]> {
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      name: articles.title,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.locale, locale)
      )
    )
    .orderBy(articles.title);
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
}

/**
 * Filter `tools` to those missing at least one fresh score across the
 * `personas` set. Used by the default (non-force) branch.
 */
async function filterToIncomplete(input: {
  projectId: string;
  tools: ToolCandidate[];
  personas: readonly string[];
  cutoff: Date;
}): Promise<ToolCandidate[]> {
  if (input.tools.length === 0) return [];
  const personaList = input.personas as DefaultPersona[];
  const freshRows = await db
    .select({
      toolId: toolPersonaScores.toolId,
      persona: toolPersonaScores.persona,
    })
    .from(toolPersonaScores)
    .where(
      and(
        eq(toolPersonaScores.projectId, input.projectId),
        inArray(
          toolPersonaScores.toolId,
          input.tools.map((t) => t.id)
        ),
        inArray(toolPersonaScores.persona, personaList),
        gte(toolPersonaScores.scoredAt, input.cutoff)
      )
    );

  // Per-tool count of fresh persona rows.
  const freshCount = new Map<string, number>();
  for (const r of freshRows) {
    freshCount.set(r.toolId, (freshCount.get(r.toolId) ?? 0) + 1);
  }

  return input.tools.filter((t) => (freshCount.get(t.id) ?? 0) < input.personas.length);
}

export async function backfillPersonaScores(
  opts: BackfillPersonaScoresOptions
): Promise<BackfillPersonaScoresSummary> {
  const scoreToolFn = opts.scoreToolFn ?? scoreToolForPersonas;

  const projectRows = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      targetLocales: projects.targetLocales,
    })
    .from(projects)
    .where(eq(projects.slug, opts.projectSlug))
    .limit(1);
  const project = projectRows[0];
  if (!project) {
    throw new Error(`project not found: ${opts.projectSlug}`);
  }

  const primaryLocale = resolvePrimaryLocale(project.targetLocales);
  const cutoff = new Date(Date.now() - FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const personas = DEFAULT_PERSONAS;

  const allTools = await listEligibleTools(project.id, primaryLocale);
  const candidates = opts.force
    ? allTools
    : await filterToIncomplete({
        projectId: project.id,
        tools: allTools,
        personas,
        cutoff,
      });

  const limited =
    opts.limit !== undefined && opts.limit > 0 ? candidates.slice(0, opts.limit) : candidates;

  log.info(
    {
      projectSlug: opts.projectSlug,
      primaryLocale,
      totalTools: allTools.length,
      candidatesBeforeRun: candidates.length,
      willProcess: limited.length,
      apply: opts.apply,
      force: opts.force ?? false,
    },
    "backfill starting"
  );

  const summary: BackfillPersonaScoresSummary = {
    projectSlug: opts.projectSlug,
    candidatesBeforeRun: candidates.length,
    totalProcessed: 0,
    bySource: { llm: 0, skipped: 0, failed: 0 },
    scoresWritten: 0,
    errors: [],
    dryRun: !opts.apply,
  };

  if (!opts.apply) {
    log.info(summary, "dry-run complete (no LLM calls fired)");
    return summary;
  }

  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  for (let i = 0; i < limited.length; i += batchSize) {
    const batch = limited.slice(i, i + batchSize);
    log.debug(
      { batchStart: i, batchSize: batch.length, totalRemaining: limited.length - i },
      "processing batch"
    );

    const results = await Promise.all(
      batch.map((tool) =>
        scoreToolFn({
          projectId: project.id,
          toolId: tool.id,
        })
      )
    );

    for (const result of results) {
      summary.totalProcessed++;
      summary.bySource[result.source]++;
      summary.scoresWritten += result.written.length;
      if (result.source === "failed" && result.error) {
        summary.errors.push({ toolId: result.toolId, error: result.error });
      }
    }
  }

  log.info(summary, "backfill complete");
  return summary;
}

export function parseCliArgs(argv: string[]): BackfillPersonaScoresOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      apply: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "batch-size": { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: false,
  });

  if (!values.project) {
    throw new Error("--project=<slug> is required (Memory D23)");
  }

  const out: BackfillPersonaScoresOptions = {
    projectSlug: values.project,
    apply: !!values.apply,
  };
  if (values.force) out.force = true;
  if (values["batch-size"]) out.batchSize = Number.parseInt(values["batch-size"], 10);
  if (values.limit) out.limit = Number.parseInt(values.limit, 10);
  return out;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const summary = await backfillPersonaScores(args);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.errors.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
  });
}
