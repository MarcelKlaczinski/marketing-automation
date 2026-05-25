// Spec 64.20 — smoke tests for the inventory-seed CLI.
// Tests use real DB + DI seam for CSV input (no file system).

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  contentSourceInventory,
  db,
  eq,
  projects,
} from "@marketing-auto/db";
import { parseCliArgs, parseCsv, seedInventory } from "../../src/scripts/inventory-seed.ts";

let projectId: string;
let projectSlug: string;
let toolArticleId: string;

beforeAll(async () => {
  const ts = Date.now();
  projectSlug = `inv-seed-${ts}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug: projectSlug,
      name: "Inv Seed Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;

  const [art] = await db
    .insert(articles)
    .values({
      projectId,
      source: "imported",
      collection: "tools",
      locale: "de",
      slug: "claude-code",
      title: "Claude Code",
      status: "proposed",
    })
    .returning({ id: articles.id });
  toolArticleId = art!.id;
});

afterEach(async () => {
  await db.delete(contentSourceInventory).where(eq(contentSourceInventory.projectId, projectId));
});

afterAll(async () => {
  await db.delete(contentSourceInventory).where(eq(contentSourceInventory.projectId, projectId));
  await db.delete(articles).where(eq(articles.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

const CSV_BASE = `source_identifier,object_type,display_name,description,refresh_interval_hours,article_slug
anthropics/claude-code,tool,Claude Code,Anthropic's official CLI,168,claude-code
ollama/ollama,tool,Ollama,Run LLMs locally,168,
anthropics/skills:web-design,skill,Web Design Skill,,720,
`;

describe("parseCsv", () => {
  it("parses a 3-row CSV with header", () => {
    const rows = parseCsv(CSV_BASE);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.sourceIdentifier).toBe("anthropics/claude-code");
    expect(rows[0]?.objectType).toBe("tool");
    expect(rows[0]?.articleSlug).toBe("claude-code");
    expect(rows[2]?.objectType).toBe("skill");
    expect(rows[2]?.refreshIntervalHours).toBe(720);
  });

  it("skips comment + blank lines", () => {
    const csv = `# comment\nsource_identifier,object_type,display_name\n\n# another\nanthropics/claude-code,tool,Claude Code\n`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it("handles quoted values with commas", () => {
    const csv = `source_identifier,object_type,display_name,description,refresh_interval_hours,article_slug\nfoo/bar,tool,Foo Bar,"a, b, c, with commas",168,\n`;
    const rows = parseCsv(csv);
    expect(rows[0]?.description).toBe("a, b, c, with commas");
  });

  it("rejects CSV missing required columns", () => {
    const csv = `source_identifier,display_name\nfoo/bar,Foo Bar\n`;
    expect(() => parseCsv(csv)).toThrow(/object_type/);
  });

  it("skips rows with invalid object_type", () => {
    const csv = `source_identifier,object_type,display_name\nfoo/bar,gadget,Foo Bar\n`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(0);
  });
});

describe("parseCliArgs", () => {
  it("requires --project", () => {
    expect(() => parseCliArgs(["--csv=./x.csv"])).toThrow(/project/);
  });

  it("requires --csv", () => {
    expect(() => parseCliArgs(["--project=foo"])).toThrow(/csv/);
  });

  it("parses both + apply flag", () => {
    const args = parseCliArgs(["--project=toolwiki", "--csv=./x.csv", "--apply"]);
    expect(args.projectSlug).toBe("toolwiki");
    expect(args.csvPath).toBe("./x.csv");
    expect(args.apply).toBe(true);
  });

  it("apply defaults to false (dry-run)", () => {
    const args = parseCliArgs(["--project=toolwiki", "--csv=./x.csv"]);
    expect(args.apply).toBe(false);
  });
});

describe("seedInventory", () => {
  it("dry-run inserts nothing", async () => {
    const summary = await seedInventory({
      projectSlug,
      csvPath: "ignored.csv",
      apply: false,
      readCsv: async () => CSV_BASE,
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.parsedRows).toBe(3);
    expect(summary.inserted).toBe(0);

    const rows = await db
      .select()
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it("--apply inserts rows + links article_slug to tools-collection article", async () => {
    const summary = await seedInventory({
      projectSlug,
      csvPath: "ignored.csv",
      apply: true,
      readCsv: async () => CSV_BASE,
    });
    expect(summary.dryRun).toBe(false);
    expect(summary.inserted).toBe(3);
    expect(summary.skippedDuplicate).toBe(0);

    const rows = await db
      .select()
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.projectId, projectId));
    expect(rows).toHaveLength(3);

    // Article-link match
    const claudeRow = rows.find((r) => r.sourceIdentifier === "anthropics/claude-code");
    expect(claudeRow?.articleId).toBe(toolArticleId);
    expect(claudeRow?.approvedAt).not.toBeNull();

    // No-match leaves articleId null
    const ollamaRow = rows.find((r) => r.sourceIdentifier === "ollama/ollama");
    expect(ollamaRow?.articleId).toBeNull();
  });

  it("idempotent — re-running --apply skips duplicates", async () => {
    await seedInventory({
      projectSlug,
      csvPath: "ignored.csv",
      apply: true,
      readCsv: async () => CSV_BASE,
    });
    const second = await seedInventory({
      projectSlug,
      csvPath: "ignored.csv",
      apply: true,
      readCsv: async () => CSV_BASE,
    });
    expect(second.inserted).toBe(0);
    expect(second.skippedDuplicate).toBe(3);
  });

  it("counts article_slug not-found rows but still inserts", async () => {
    const csv = `source_identifier,object_type,display_name,description,refresh_interval_hours,article_slug
ghost/repo,tool,Ghost Repo,,,non-existent-slug
`;
    const summary = await seedInventory({
      projectSlug,
      csvPath: "ignored.csv",
      apply: true,
      readCsv: async () => csv,
    });
    expect(summary.inserted).toBe(1);
    expect(summary.skippedArticleNotFound).toBe(1);

    const [row] = await db
      .select()
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.projectId, projectId));
    expect(row?.articleId).toBeNull();
  });

  it("rejects unknown project slug", async () => {
    await expect(
      seedInventory({
        projectSlug: "does-not-exist",
        csvPath: "ignored.csv",
        apply: true,
        readCsv: async () => CSV_BASE,
      }),
    ).rejects.toThrow(/Project not found/);
  });
});
