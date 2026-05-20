import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { SelfReviewStep } from "../../src/article/steps/self-review.ts";
import type { StepContext } from "../../src/engine/step.ts";

const LIVE = process.env.RUN_LIVE_ARTICLE_PIPELINE === "1";

const mockCtx = (projectId: string): StepContext => ({
  projectId,
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  llmMode: "sync",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

const SAMPLE_ARTICLE_MD = `
## Was KI-Schreibtools wirklich leisten

KI-Schreibtools wie ChatGPT oder Claude können Texte in Sekunden generieren.
Das klingt verlockend — doch ohne menschliche Überarbeitung entstehen oft generische Texte,
die keine echten Mehrwert bieten.

**Stärken:** Brainstorming, Entwürfe, Umformulierungen.
**Grenzen:** Keine echten Fakten, keine eigene Stimme, kein Kontext.

## Die 5 beliebtesten Tools im Vergleich

1. **ChatGPT** (OpenAI) — Vielseitig, gut für Allzwecktexte.
2. **Claude** (Anthropic) — Stärker bei längeren Texten und Analyse.
3. **Jasper** — Marketing-fokussiert, Templates-lastig.
4. **Rytr** — Günstig, gut für kurze Snippets.
5. **Copy.ai** — Schnell für Social-Media-Texte.

Für Blogger lohnt sich Claude oder ChatGPT. Jasper ist besser für Growth-Teams.

## Kosten und Preismodelle

Die meisten Tools bieten Free-Tiers an — jedoch mit starken Einschränkungen.
ChatGPT Plus kostet 20 USD/Monat. Claude Pro liegt ebenfalls bei 20 USD.
Jasper beginnt bei 49 USD und richtet sich an Teams.

## Empfehlung nach Anwendungsfall

- **Blogger:** Claude oder ChatGPT — Flexibilität vor Preis.
- **Freelancer:** Rytr für Budget, Claude für Qualität.
- **Teams:** Jasper wegen Collaboration-Features.

Wähle das Tool, das zu deinem Workflow passt — nicht das mit den meisten Features.
`.trim();

describe.skipIf(!LIVE)("SelfReviewStep (live — requires ANTHROPIC_API_KEY)", () => {
  let projectId: string;
  let projectSlug: string;

  beforeAll(async () => {
    projectSlug = `self-review-test-${Date.now()}`;
    const [p] = await db
      .insert(projects)
      .values({
        slug: projectSlug,
        name: "Self Review Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        marketingContextMd:
          "# KI-Wissensraum\nVoice: friendly expert. Audience: German-speaking AI enthusiasts.",
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns a valid review with score, issues, shouldBlock, and summary", async () => {
    const step = new SelfReviewStep();
    const out = await step.execute(
      {
        bodyMd: SAMPLE_ARTICLE_MD,
        wordCount: SAMPLE_ARTICLE_MD.trim().split(/\s+/).length,
        cornerstoneKeyword: "ki-schreibtools",
        projectSlug,
      },
      mockCtx(projectId)
    );

    expect(typeof out.score).toBe("number");
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(out.issues)).toBe(true);
    expect(typeof out.shouldBlock).toBe("boolean");
    expect(typeof out.summary).toBe("string");
    expect(out.summary.length).toBeGreaterThan(0);
  });

  it("shouldBlock is true when score < 70", async () => {
    // This is a spec contract — verify the LLM output conforms
    const step = new SelfReviewStep();
    const out = await step.execute(
      {
        bodyMd: SAMPLE_ARTICLE_MD,
        wordCount: SAMPLE_ARTICLE_MD.trim().split(/\s+/).length,
        cornerstoneKeyword: "ki-schreibtools",
        projectSlug,
      },
      mockCtx(projectId)
    );

    if (out.score < 70) {
      expect(out.shouldBlock).toBe(true);
    }
  });
});
