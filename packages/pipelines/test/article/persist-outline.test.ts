import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects, clusters, articles, contentPillars } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { PersistOutlineStep } from "../../src/article/steps/persist-outline.ts";
import type { ArticleOutline } from "../../src/article/types.ts";
import type { StepContext } from "../../src/engine/step.ts";

const OUTLINE: ArticleOutline = {
  title: "KI-Schreibtools im Vergleich: Was wirklich hilft",
  slug: "ki-schreibtools-vergleich",
  metaDescription: "Welches KI-Schreibtool lohnt sich wirklich? Wir vergleichen die bekanntesten Tools nach Leistung, Preis und Anwendungsfall.",
  introAngle: "KI-Schreibtools versprechen viel — aber was taugen sie im Alltag? Wir haben die wichtigsten Tools getestet und zeigen dir, welches für welchen Zweck taugt.",
  sections: [
    {
      h2: "Was KI-Schreibtools leisten",
      intent: "Realistische Erwartungen setzen",
      keyPoints: ["Stärken im Alltag", "Grenzen kennen und akzeptieren"],
      estimatedWords: 300,
      targetKeywords: [],
    },
    {
      h2: "Die 5 beliebtesten Tools im Test",
      intent: "Produktvergleich",
      keyPoints: ["ChatGPT im Detail", "Claude im Detail", "Jasper im Detail", "Rytr im Detail"],
      estimatedWords: 600,
      targetKeywords: ["chatgpt schreiben"],
    },
    {
      h2: "Kosten und Preismodelle",
      intent: "Budget-Entscheidung",
      keyPoints: ["Free-Tiers nutzen", "Abo-Kosten vergleichen"],
      estimatedWords: 250,
      targetKeywords: [],
    },
    {
      h2: "Empfehlung nach Anwendungsfall",
      intent: "Kaufentscheidung",
      keyPoints: ["Für Blogger geeignet", "Für Freelancer sinnvoll", "Für Teams gedacht"],
      estimatedWords: 350,
      targetKeywords: [],
    },
  ],
  heroImagePrompt: "Flat illustration of an AI brain with a glowing pen, soft blue palette, minimalist tech aesthetic",
  heroImageStyle: "illustrated",
  estimatedTotalWords: 1500,
};

describe("PersistOutlineStep", () => {
  let projectId: string;
  let clusterId: string;
  let articleId: string;
  const pipelineRunId = crypto.randomUUID();

  const ctx = (): StepContext => ({
    projectId,
    pipelineRunId,
    stepRunId: crypto.randomUUID(),
    pipelineName: "article:outline",
    log: createLogger("test"),
    reportProgress: async () => {},
    getStepOutput: () => undefined,
  });

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug: `persist-outline-test-${Date.now()}`,
      name: "Persist Outline Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();
    projectId = p!.id;

    const [pillar] = await db.insert(contentPillars).values({
      projectId,
      name: "AI Tools",
      position: 0,
    }).returning();

    const [c] = await db.insert(clusters).values({
      projectId,
      pillarId: pillar!.id,
      name: "AI Writing",
      pillar: "AI Tools",
      cornerstoneKeywords: ["ki-schreibtools"],
      satelliteKeywords: [],
      status: "approved",
    }).returning();
    clusterId = c!.id;
  });

  beforeEach(async () => {
    const [a] = await db.insert(articles).values({
      projectId,
      clusterId,
      slug: "ki-schreibtools",
      cornerstoneKeyword: "ki-schreibtools",
      status: "generating",
      approvalMode: "manual",
    }).returning();
    articleId = a!.id;
  });

  afterEach(async () => {
    // PersistOutlineStep updates the slug to OUTLINE.slug — clean up so the next beforeEach
    // insert doesn't conflict on the articles_project_slug_unique constraint.
    await db.delete(articles).where(eq(articles.id, articleId));
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("sets status to outline_review and persists all outline fields", async () => {
    const step = new PersistOutlineStep();
    await step.execute({ articleId, projectId, outline: OUTLINE, approvalMode: "manual" }, ctx());

    const [saved] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
    expect(saved!.status).toBe("outline_review");
    expect(saved!.title).toBe(OUTLINE.title);
    expect(saved!.slug).toBe(OUTLINE.slug);
    expect(saved!.metaDescription).toBe(OUTLINE.metaDescription);
    expect(saved!.outlinePipelineRunId).toBe(pipelineRunId);
    // non-null assertion: outline was just written by the step above
    const savedOutline = saved!.outline!;
    expect(savedOutline.sections).toHaveLength(4);
    expect(savedOutline.heroImageStyle).toBe("illustrated");
  });

  it("returns nextAction = wait_for_review for manual mode", async () => {
    const step = new PersistOutlineStep();
    const out = await step.execute(
      { articleId, projectId, outline: OUTLINE, approvalMode: "manual" },
      ctx(),
    );

    expect(out.articleId).toBe(articleId);
    expect(out.nextAction).toBe("wait_for_review");
  });

  it("returns nextAction = auto_continue for auto mode", async () => {
    const step = new PersistOutlineStep();
    const out = await step.execute(
      { articleId, projectId, outline: OUTLINE, approvalMode: "auto" },
      ctx(),
    );

    expect(out.nextAction).toBe("auto_continue");
    // Status is still outline_review — the auto-continue is handled by pipeline afterComplete
    const [saved] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
    expect(saved!.status).toBe("outline_review");
  });
});
