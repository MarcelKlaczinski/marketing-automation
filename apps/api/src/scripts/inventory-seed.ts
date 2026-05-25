/**
 * Spec 64.20: Marcel-Seed CLI for `content_source_inventory`.
 *
 * Reads a CSV of inventory entries and INSERTs them with `approved_at = NOW()`
 * so the cron worker picks them up on the next 15-minute tick.
 *
 * Mirrors Pattern 121 (Spec 64.10 / 64.15): `--apply` opt-in (dry-run default),
 * `--project=<slug>` mandatory (cross-tenant safety), `--csv=<path>` mandatory.
 *
 * Idempotent: the partial unique index `csi_project_source_identifier_approved_unique`
 * rejects duplicate INSERTs at the DB level. The script catches the conflict
 * and counts it as "skipped" rather than crashing.
 *
 * CSV columns (header row required, comma-separated):
 *   source_identifier   "anthropics/claude-code" or "anthropics/skills:web-design"
 *   object_type         "tool" | "skill"
 *   display_name        Human-facing name
 *   description         Optional. Comma-containing values must be wrapped in "..."
 *   refresh_interval_hours  Optional, default 168 (weekly)
 *   article_slug        Optional. If present, opportunistically resolved to
 *                       an articles row with collection='tools' and that slug.
 *
 * Usage:
 *   bun --filter @marketing-auto/api inventory:seed --project=<slug> --csv=<path> [--apply]
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  and,
  articles,
  createInventoryRow,
  db,
  eq,
  projects,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("inventory-seed");

// ─── CSV parsing ─────────────────────────────────────────────────────────────

interface CsvRow {
  sourceIdentifier: string;
  objectType: "tool" | "skill";
  displayName: string;
  description: string | null;
  refreshIntervalHours: number;
  articleSlug: string | null;
}

const HEADER_KEYS = [
  "source_identifier",
  "object_type",
  "display_name",
  "description",
  "refresh_interval_hours",
  "article_slug",
] as const;

/**
 * Minimal CSV parser. Supports header row, quoted-value (for commas inside
 * values), `#` line comments, and blank-line skipping. No multi-line values,
 * no escaped quotes inside quoted values (use `'` if you need apostrophes).
 */
export function parseCsv(body: string): CsvRow[] {
  const lines = body.split(/\r?\n/);
  let header: string[] | null = null;
  const rows: CsvRow[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const cells = splitCsvLine(line);

    if (!header) {
      header = cells.map((c) => c.trim().toLowerCase());
      const missing = HEADER_KEYS.filter((k) => k !== "description" && k !== "refresh_interval_hours" && k !== "article_slug" && !header!.includes(k));
      if (missing.length > 0) {
        throw new Error(`CSV header missing required columns: ${missing.join(", ")}`);
      }
      continue;
    }

    const get = (k: string): string => {
      const idx = header!.indexOf(k);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };

    const sourceIdentifier = get("source_identifier");
    const objectTypeRaw = get("object_type");
    const displayName = get("display_name");

    if (!sourceIdentifier || !objectTypeRaw || !displayName) {
      log.warn({ line }, "Skipping CSV row — missing required fields");
      continue;
    }
    if (objectTypeRaw !== "tool" && objectTypeRaw !== "skill") {
      log.warn({ line, objectTypeRaw }, "Skipping CSV row — invalid object_type");
      continue;
    }

    const refreshIntervalRaw = get("refresh_interval_hours");
    const refreshIntervalHours = refreshIntervalRaw
      ? Number.parseInt(refreshIntervalRaw, 10)
      : 168;
    if (!Number.isFinite(refreshIntervalHours) || refreshIntervalHours < 1 || refreshIntervalHours > 8760) {
      log.warn({ line, refreshIntervalRaw }, "Skipping CSV row — invalid refresh_interval_hours");
      continue;
    }

    const description = get("description") || null;
    const articleSlug = get("article_slug") || null;

    rows.push({
      sourceIdentifier,
      objectType: objectTypeRaw,
      displayName,
      description,
      refreshIntervalHours,
      articleSlug,
    });
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

// ─── Seed orchestration ─────────────────────────────────────────────────────

export interface SeedOptions {
  projectSlug: string;
  csvPath: string;
  apply: boolean;
  /** DI seam — defaults read from disk; tests inject pre-parsed CSV body. */
  readCsv?: (path: string) => Promise<string>;
}

export interface SeedSummary {
  projectSlug: string;
  csvPath: string;
  parsedRows: number;
  inserted: number;
  skippedDuplicate: number;
  skippedArticleNotFound: number;
  errors: Array<{ sourceIdentifier: string; error: string }>;
  dryRun: boolean;
}

const defaultReadCsv = (path: string) => readFile(path, "utf-8");

export async function seedInventory(opts: SeedOptions): Promise<SeedSummary> {
  const readCsv = opts.readCsv ?? defaultReadCsv;

  const [proj] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, opts.projectSlug))
    .limit(1);
  if (!proj) {
    throw new Error(`Project not found: ${opts.projectSlug}`);
  }

  const csvBody = await readCsv(opts.csvPath);
  const rows = parseCsv(csvBody);

  const summary: SeedSummary = {
    projectSlug: opts.projectSlug,
    csvPath: opts.csvPath,
    parsedRows: rows.length,
    inserted: 0,
    skippedDuplicate: 0,
    skippedArticleNotFound: 0,
    errors: [],
    dryRun: !opts.apply,
  };

  log.info(
    { projectSlug: opts.projectSlug, csvPath: opts.csvPath, parsedRows: rows.length, dryRun: !opts.apply },
    "Parsed CSV — beginning seed",
  );

  if (!opts.apply) {
    log.info({ sample: rows.slice(0, 5) }, "DRY RUN — first 5 rows; pass --apply to INSERT");
    return summary;
  }

  for (const row of rows) {
    let articleId: string | null = null;
    if (row.articleSlug) {
      const matched = await db
        .select({ id: articles.id })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, proj.id),
            eq(articles.collection, "tools"),
            eq(articles.slug, row.articleSlug),
          ),
        )
        .limit(1);
      if (matched[0]) {
        articleId = matched[0].id;
      } else {
        summary.skippedArticleNotFound += 1;
        log.warn(
          { sourceIdentifier: row.sourceIdentifier, articleSlug: row.articleSlug },
          "Article slug not found — inserting without link",
        );
      }
    }

    try {
      await createInventoryRow({
        projectId: proj.id,
        source: "github",
        objectType: row.objectType,
        sourceIdentifier: row.sourceIdentifier,
        displayName: row.displayName,
        description: row.description,
        refreshIntervalHours: row.refreshIntervalHours,
        articleId,
        approvedAt: new Date(),
      });
      summary.inserted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Partial unique index catches re-inserts of the same source_identifier
      // among approved rows. Treat the index violation as "already seeded".
      if (message.includes("csi_project_source_identifier_approved_unique")) {
        summary.skippedDuplicate += 1;
        log.debug(
          { sourceIdentifier: row.sourceIdentifier },
          "Duplicate — already seeded; skipping",
        );
        continue;
      }
      summary.errors.push({ sourceIdentifier: row.sourceIdentifier, error: message });
      log.warn({ sourceIdentifier: row.sourceIdentifier, err: message }, "INSERT failed");
    }
  }

  log.info(
    {
      projectSlug: opts.projectSlug,
      parsedRows: summary.parsedRows,
      inserted: summary.inserted,
      skippedDuplicate: summary.skippedDuplicate,
      skippedArticleNotFound: summary.skippedArticleNotFound,
      errors: summary.errors.length,
    },
    "Seed complete",
  );

  return summary;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export interface CliArgs {
  projectSlug: string;
  csvPath: string;
  apply: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: "string" },
      csv: { type: "string" },
      apply: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (!values.project) {
    throw new Error("--project=<slug> is mandatory (cross-tenant safety)");
  }
  if (!values.csv) {
    throw new Error("--csv=<path> is mandatory");
  }

  return {
    projectSlug: values.project,
    csvPath: values.csv,
    apply: !!values.apply,
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const summary = await seedInventory(args);
  log.info({ summary }, "exit");
  process.exit(summary.errors.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
  });
}
