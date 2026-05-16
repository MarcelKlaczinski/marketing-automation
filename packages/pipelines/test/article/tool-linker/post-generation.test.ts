import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { db, projects, articles, eq } from "@marketing-auto/db";

// ─── Pure linkification logic (no DB) — uses internal helpers via re-export ──
// We test the full linkifyMarkdown with a mocked DB for the tool-name lookup.
// For pure unit tests (no DB), we test the splitting and edge-case logic directly.

// Inline helpers that mirror the implementation (for pure-logic tests)
function splitByH2(body: string): string[] {
  return body.split(/(?=^## )/m).filter((p) => p.length > 0);
}

describe("splitByH2", () => {
  it("splits on ## headings", () => {
    const md = "intro\n## Section A\ncontent A\n## Section B\ncontent B";
    const parts = splitByH2(md);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("intro\n");
    expect(parts[1]).toStartWith("## Section A");
    expect(parts[2]).toStartWith("## Section B");
  });

  it("does not split on ### headings", () => {
    const md = "## H2\n### H3\ncontent";
    expect(splitByH2(md)).toHaveLength(1);
  });

  it("returns single element for body with no H2", () => {
    const md = "just some text\n# H1\n### H3";
    expect(splitByH2(md)).toHaveLength(1);
  });

  it("handles empty body", () => {
    expect(splitByH2("")).toHaveLength(0);
  });
});

// ─── Full linkifyMarkdown with DB fixture ────────────────────────────────────

const RUN_DB = process.env.RUN_DB_TESTS === "1";

describe.skipIf(!RUN_DB)("linkifyMarkdown (DB fixture)", () => {
  let projectId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `test-linkify-${Date.now()}`,
        name: "test-linkify",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;

    // Seed tools
    const tools = [
      { slug: "chatgpt",       title: "ChatGPT" },
      { slug: "claude",        title: "Claude" },
      { slug: "github-copilot", title: "GitHub Copilot" },
      { slug: "github",        title: "GitHub" },       // shorter — should NOT steal from "GitHub Copilot"
    ];
    for (const t of tools) {
      await db.insert(articles).values({
        projectId,
        slug: t.slug,
        title: t.title,
        collection: "tools",
        locale: "de",
      });
    }
  });

  afterAll(async () => {
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("links first occurrence of tool name", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    const body = "## Tools\n\nChatGPT ist ein KI-Tool. Nutze ChatGPT täglich.";
    const result = await linkifyMarkdown(body, projectId, "de");

    expect(result.linksAdded).toBe(1);
    expect(result.bodyMd).toContain("[ChatGPT](/de/tools/chatgpt)");
    // Second occurrence NOT linked
    expect(result.bodyMd).toContain("Nutze ChatGPT täglich");
    expect(result.bodyMd).not.toContain("Nutze [ChatGPT]");
  });

  it("does NOT link tool name inside code fence", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    const body = "## Code\n\n```\nChatGPT example\n```\n\nAußerhalb von ChatGPT.";
    const result = await linkifyMarkdown(body, projectId, "de");

    // Only the occurrence outside the fence should be linked
    expect(result.bodyMd).toContain("```\nChatGPT example\n```");
    expect(result.bodyMd).toContain("[ChatGPT](/de/tools/chatgpt)");
    expect(result.linksAdded).toBe(1);
  });

  it("does NOT re-link an already-linked tool name", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    const body = "## Tools\n\n[ChatGPT](/de/tools/chatgpt) ist gut. ChatGPT kostet Geld.";
    const result = await linkifyMarkdown(body, projectId, "de");

    // The already-linked one stays, second occurrence is NOT linked
    expect(result.bodyMd.match(/\[ChatGPT\]/g)).toHaveLength(1);
  });

  it("links tool name once per H2 section — different sections get their own link", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    const body =
      "## Section A\n\nChatGPT hilft hier.\n## Section B\n\nAuch ChatGPT ist relevant.";
    const result = await linkifyMarkdown(body, projectId, "de");

    expect(result.linksAdded).toBe(2);
    expect(result.bodyMd.match(/\[ChatGPT\]/g)).toHaveLength(2);
  });

  it("longer tool name (GitHub Copilot) matches before shorter (GitHub)", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    const body = "## Dev Tools\n\nGitHub Copilot ist besser als GitHub allein.";
    const result = await linkifyMarkdown(body, projectId, "de");

    expect(result.bodyMd).toContain("[GitHub Copilot](/de/tools/github-copilot)");
    // "GitHub" alone also gets linked (it's a separate tool with word boundary)
    expect(result.linkedTools).toContain("github-copilot");
  });

  it("case-sensitive matching — lowercase 'chatgpt' does NOT link", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    const body = "## Tools\n\nDas tool chatgpt ist bekannt.";
    const result = await linkifyMarkdown(body, projectId, "de");

    // "chatgpt" (lowercase) should NOT match "ChatGPT" (mixed case)
    expect(result.linksAdded).toBe(0);
    expect(result.bodyMd).not.toContain("[chatgpt]");
  });

  it("word boundary check — partial-word match is skipped", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    // "Claude" appears as a substring of "ClaudeAI" — should NOT match
    const body = "## Tools\n\nClaudeAI ist kein Produkt. Claude selbst schon.";
    const result = await linkifyMarkdown(body, projectId, "de");

    expect(result.bodyMd).toContain("ClaudeAI");
    // Only standalone "Claude" gets linked
    expect(result.bodyMd).toContain("[Claude](/de/tools/claude)");
  });

  it("returns correct linkedTools slugs", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    const body = "## Tools\n\nChatGPT und Claude sind führend.";
    const result = await linkifyMarkdown(body, projectId, "de");

    expect(result.linkedTools).toContain("chatgpt");
    expect(result.linkedTools).toContain("claude");
    expect(result.linksAdded).toBe(2);
  });

  it("returns original body unchanged when no tools match", async () => {
    const { linkifyMarkdown } = await import(
      "../../../src/article/tool-linker/post-generation.ts"
    );
    const body = "## Allgemeines\n\nKein bekanntes Tool wird erwähnt.";
    const result = await linkifyMarkdown(body, projectId, "de");

    expect(result.bodyMd).toBe(body);
    expect(result.linksAdded).toBe(0);
    expect(result.linkedTools).toHaveLength(0);
  });
});

// ─── buildToolsContextFragment (pure, no DB) ──────────────────────────────────

describe("buildToolsContextFragment", () => {
  it("returns empty string for empty tool lists", async () => {
    const { buildToolsContextFragment } = await import(
      "../../../src/article/tool-linker/pre-generation.ts"
    );
    expect(buildToolsContextFragment({ primary: [], secondary: [] })).toBe("");
  });

  it("includes primary tool names with rating and pricing", async () => {
    const { buildToolsContextFragment } = await import(
      "../../../src/article/tool-linker/pre-generation.ts"
    );
    const fragment = buildToolsContextFragment({
      primary: [
        { slug: "chatgpt", name: "ChatGPT", pricing: "freemium", rating: 4.7, shortDescription: "Best LLM", features: [] },
      ],
      secondary: [],
    });
    expect(fragment).toContain("ChatGPT");
    expect(fragment).toContain("freemium");
    expect(fragment).toContain("4.7");
  });

  it("includes secondary tool names", async () => {
    const { buildToolsContextFragment } = await import(
      "../../../src/article/tool-linker/pre-generation.ts"
    );
    const fragment = buildToolsContextFragment({
      primary: [],
      secondary: [
        { slug: "claude", name: "Claude", pricing: "freemium", rating: 4.8, shortDescription: null, features: [] },
      ],
    });
    expect(fragment).toContain("Claude");
    expect(fragment).toContain("Other Top Tools");
  });
});
