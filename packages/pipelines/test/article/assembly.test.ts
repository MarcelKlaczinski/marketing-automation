import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, clusters, contentPillars, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { AssemblyStep } from "../../src/article/steps/assembly.ts";
import { ArticlePipelineError } from "../../src/article/types.ts";
import type { ArticleOutline } from "../../src/article/types.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const mockCtx = (projectId: string) => makeMockCtx({ projectId });

const SAMPLE_OUTLINE: ArticleOutline = {
  title: "Die besten KI-Schreibtools 2024 im Vergleich",
  slug: "ki-schreibtools-vergleich",
  metaDescription:
    "KI-Schreibtools im Vergleich: Welches Tool passt zu dir? Alle wichtigen Infos kompakt zusammengefasst.",
  introAngle:
    "Wenn du täglich Texte schreibst, kennst du das Problem: der Cursor blinkt, die Ideen fehlen. KI-Schreibtools sollen das ändern — aber welches lohnt sich wirklich? In diesem Artikel zeigen wir dir die besten Optionen.",
  sections: [
    {
      h2: "Was KI-Schreibtools wirklich leisten",
      intent: "Realistische Erwartungen setzen",
      keyPoints: ["Stärken der Tools", "Grenzen der KI"],
      estimatedWords: 300,
      targetKeywords: [],
    },
    {
      h2: "Die 5 beliebtesten Tools im Vergleich",
      intent: "Direkter Produktvergleich",
      keyPoints: [
        "ChatGPT im Vergleich",
        "Claude im Vergleich",
        "Jasper im Vergleich",
        "Rytr im Vergleich",
      ],
      estimatedWords: 600,
      targetKeywords: ["chatgpt schreiben"],
    },
    {
      h2: "Kosten und Preismodelle",
      intent: "Budget-Entscheidung erleichtern",
      keyPoints: ["Free-Tiers", "Monatliche Abos"],
      estimatedWords: 250,
      targetKeywords: [],
    },
    {
      h2: "Empfehlung nach Anwendungsfall",
      intent: "Kaufentscheidung unterstützen",
      keyPoints: ["Für Blogger geeignet", "Für Freelancer sinnvoll", "Für Teams gedacht"],
      estimatedWords: 350,
      targetKeywords: [],
    },
  ],
  heroImagePrompt:
    "Flat illustration of an AI brain connected to a writing pen, clean white background, electric blue accents, modern tech aesthetic",
  heroImageStyle: "illustrated",
  estimatedTotalWords: 1500,
};

describe("AssemblyStep", () => {
  let projectId: string;
  let clusterId: string;
  let articleId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `assembly-test-${Date.now()}`,
        name: "Assembly Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    projectId = p!.id;

    const [pillar] = await db
      .insert(contentPillars)
      .values({
        projectId,
        name: "AI Tools",
        position: 0,
      })
      .returning();

    const [c] = await db
      .insert(clusters)
      .values({
        projectId,
        pillarId: pillar!.id,
        name: "AI Writing",
        pillar: "AI Tools",
        cornerstoneKeywords: ["ki-schreibtools"],
        satelliteKeywords: [],
        status: "approved",
      })
      .returning();
    clusterId = c!.id;

    const [a] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: "ki-schreibtools-vergleich",
        cornerstoneKeyword: "ki-schreibtools",
        outline: SAMPLE_OUTLINE,
        heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
        status: "drafting",
        approvalMode: "manual",
      })
      .returning();
    articleId = a!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("produces a valid schema.org Article JSON-LD object", async () => {
    const step = new AssemblyStep();
    const out = await step.execute({ articleId, projectId }, mockCtx(projectId));

    expect(out.schemaJsonLd["@context"]).toBe("https://schema.org");
    expect(out.schemaJsonLd["@type"]).toBe("Article");
    expect(out.schemaJsonLd["headline"]).toBe(SAMPLE_OUTLINE.title);
    expect(out.schemaJsonLd["description"]).toBe(SAMPLE_OUTLINE.metaDescription);
    expect(out.schemaJsonLd["image"]).toBe("https://cdn.example.com/hero.jpg");
  });

  it("sets datePublished and dateModified as ISO strings", async () => {
    const step = new AssemblyStep();
    const out = await step.execute({ articleId, projectId }, mockCtx(projectId));

    expect(typeof out.schemaJsonLd["datePublished"]).toBe("string");
    expect(() => new Date(out.schemaJsonLd["datePublished"] as string)).not.toThrow();
    expect(typeof out.schemaJsonLd["dateModified"]).toBe("string");
  });

  it("sets author and publisher to the project's Organization", async () => {
    const step = new AssemblyStep();
    const out = await step.execute({ articleId, projectId }, mockCtx(projectId));

    const author = out.schemaJsonLd["author"] as { "@type": string; name: string };
    expect(author["@type"]).toBe("Organization");
    expect(author["name"]).toBe("Assembly Test Project");

    const publisher = out.schemaJsonLd["publisher"] as { "@type": string; name: string };
    expect(publisher["@type"]).toBe("Organization");
    expect(publisher["name"]).toBe("Assembly Test Project");
  });

  it("sets mainEntityOfPage with the outline slug in the URL", async () => {
    const step = new AssemblyStep();
    const out = await step.execute({ articleId, projectId }, mockCtx(projectId));

    const mep = out.schemaJsonLd["mainEntityOfPage"] as { "@type": string; "@id": string };
    expect(mep["@type"]).toBe("WebPage");
    expect(mep["@id"]).toContain(SAMPLE_OUTLINE.slug);
  });

  it("Spec 64.3 — collection-aware canonical URL for non-blog collections (ki-wissen)", async () => {
    const [kiArticle] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: "rag-erklaert",
        collection: "ki-wissen",
        locale: "de",
        cornerstoneKeyword: "rag",
        outline: { ...SAMPLE_OUTLINE, slug: "rag-erklaert" },
        heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
        status: "drafting",
        approvalMode: "manual",
      })
      .returning();

    const step = new AssemblyStep();
    const out = await step.execute({ articleId: kiArticle!.id, projectId }, mockCtx(projectId));

    const mep = out.schemaJsonLd["mainEntityOfPage"] as { "@type": string; "@id": string };
    expect(mep["@id"]).toContain("/de/ki-wissen/rag-erklaert");
    expect(mep["@id"]).not.toContain("/blog/");

    await db.delete(articles).where(eq(articles.id, kiArticle!.id));
  });

  it("Spec 64.3 — sets inLanguage BCP-47 tag based on article.locale", async () => {
    const [enArticle] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: "in-language-en",
        collection: "blog",
        locale: "en",
        cornerstoneKeyword: "in language",
        outline: { ...SAMPLE_OUTLINE, slug: "in-language-en" },
        heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
        status: "drafting",
        approvalMode: "manual",
      })
      .returning();

    const step = new AssemblyStep();
    const out = await step.execute({ articleId: enArticle!.id, projectId }, mockCtx(projectId));

    expect(out.schemaJsonLd["inLanguage"]).toBe("en-US");

    await db.delete(articles).where(eq(articles.id, enArticle!.id));
  });

  it("Spec 64.3 — collection-aware canonical URL for comparisons", async () => {
    const [cmpArticle] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: "claude-vs-gpt",
        collection: "comparisons",
        locale: "en",
        cornerstoneKeyword: "claude vs gpt",
        outline: { ...SAMPLE_OUTLINE, slug: "claude-vs-gpt" },
        heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
        status: "drafting",
        approvalMode: "manual",
      })
      .returning();

    const step = new AssemblyStep();
    const out = await step.execute({ articleId: cmpArticle!.id, projectId }, mockCtx(projectId));

    const mep = out.schemaJsonLd["mainEntityOfPage"] as { "@type": string; "@id": string };
    expect(mep["@id"]).toContain("/en/comparisons/claude-vs-gpt");
    expect(mep["@id"]).not.toContain("/blog/");

    await db.delete(articles).where(eq(articles.id, cmpArticle!.id));
  });

  it("throws ArticlePipelineError when article has no outline", async () => {
    const [noOutline] = await db
      .insert(articles)
      .values({
        projectId,
        clusterId,
        slug: "no-outline-slug",
        cornerstoneKeyword: "no-outline",
        status: "drafting",
        approvalMode: "manual",
      })
      .returning();

    const step = new AssemblyStep();
    await expect(
      step.execute({ articleId: noOutline!.id, projectId }, mockCtx(projectId))
    ).rejects.toThrow(ArticlePipelineError);

    await db.delete(articles).where(eq(articles.id, noOutline!.id));
  });
});
