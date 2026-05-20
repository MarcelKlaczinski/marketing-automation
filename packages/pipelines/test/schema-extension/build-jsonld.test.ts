import { describe, expect, it } from "bun:test";
import { createLogger } from "@marketing-auto/shared";
import type { StepContext } from "../../src/engine/step.ts";
import { BuildJsonLdStep } from "../../src/schema-extension/steps/build-jsonld.ts";

const mockCtx = (): StepContext => ({
  projectId: crypto.randomUUID(),
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  llmMode: "sync",
  runMode: "production",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});

const BASE_ARTICLE = {
  title: "KI-Tools im Vergleich",
  slug: "ki-tools-vergleich",
  locale: "de" as string | null,
  metaDescription: "Die besten KI-Tools für Content Creator.",
  schemaJsonLd: [
    { "@context": "https://schema.org", "@type": "Article", headline: "KI-Tools im Vergleich" },
  ],
  heroImagePublicUrl: "https://cdn.example.com/hero.jpg",
  heroImageR2Key: null as string | null,
};

const BASE_PROJECT = {
  slug: "ki-wissensraum",
  name: "KI-Wissensraum",
  domain: "ki-wissensraum.de",
};

const FAQ_DETECTION = {
  hasFaq: true,
  hasHowTo: false,
  faqQuestions: [
    { question: "Was ist ChatGPT?", answer: "ChatGPT ist ein KI-Chatbot von OpenAI." },
    {
      question: "Ist ChatGPT kostenlos?",
      answer: "Es gibt eine kostenlose Version und ChatGPT Plus.",
    },
    {
      question: "Wie nutze ich ChatGPT?",
      answer: "Einfach auf chat.openai.com gehen und loslegen.",
    },
  ],
  howToSteps: [],
  howToName: null,
  howToTotalTime: null,
};

const HOWTO_DETECTION = {
  hasFaq: false,
  hasHowTo: true,
  faqQuestions: [],
  howToSteps: [
    { name: "Account erstellen", text: "Gehe auf die Website und klicke auf Registrieren." },
    {
      name: "API-Key generieren",
      text: "Navigiere zu Einstellungen und erstelle einen neuen Schlüssel.",
    },
    {
      name: "Erste Anfrage senden",
      text: "Nutze den Key im Authorization-Header deiner HTTP-Anfrage.",
    },
  ],
  howToName: "Claude API einrichten",
  howToTotalTime: "PT15M",
};

const NO_DETECTION = {
  hasFaq: false,
  hasHowTo: false,
  faqQuestions: [],
  howToSteps: [],
  howToName: null,
  howToTotalTime: null,
};

describe("BuildJsonLdStep", () => {
  const step = new BuildJsonLdStep();

  // ───── BreadcrumbList ─────────────────────────────────────────────────────

  it("always emits BreadcrumbList even when no FAQ or HowTo detected", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: NO_DETECTION,
      },
      mockCtx()
    );

    expect(out.addedTypes).toContain("BreadcrumbList");
    const bc = out.schemaJsonLd.find((s) => s["@type"] === "BreadcrumbList");
    expect(bc).toBeDefined();
    expect(bc!["@context"]).toBe("https://schema.org");
  });

  it("BreadcrumbList without cluster has 3 items: Home → Blog → Article", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: NO_DETECTION,
      },
      mockCtx()
    );

    const bc = out.schemaJsonLd.find((s) => s["@type"] === "BreadcrumbList")!;
    const items = bc["itemListElement"] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    expect(items[0]!["name"]).toBe("Home");
    expect(items[1]!["name"]).toBe("Blog");
    expect(items[2]!["name"]).toBe(BASE_ARTICLE.title);
    expect(items[2]!["item"]).toBe("https://ki-wissensraum.de/de/blog/ki-tools-vergleich");
  });

  it("BreadcrumbList with cluster has 4 items: Home → Blog → Cluster → Article", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: { name: "KI-Grundlagen", pillar: "AI Education" },
        detection: NO_DETECTION,
      },
      mockCtx()
    );

    const bc = out.schemaJsonLd.find((s) => s["@type"] === "BreadcrumbList")!;
    const items = bc["itemListElement"] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(4);
    expect(items[2]!["name"]).toBe("KI-Grundlagen");
    expect(items[2]!["item"]).toBe("https://ki-wissensraum.de/cluster/ki-grundlagen");
    expect(items[3]!["name"]).toBe(BASE_ARTICLE.title);
  });

  it("cluster URL slugifies German characters correctly", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: { name: "Künstliche Intelligenz & Überblick", pillar: "AI" },
        detection: NO_DETECTION,
      },
      mockCtx()
    );

    const bc = out.schemaJsonLd.find((s) => s["@type"] === "BreadcrumbList")!;
    const items = bc["itemListElement"] as Array<Record<string, unknown>>;
    const clusterItem = items[2]!;
    // ü→ue before NFD, ä→ae, ß→ss; & and spaces become dashes
    expect(clusterItem["item"]).toBe(
      "https://ki-wissensraum.de/cluster/kuenstliche-intelligenz-ueberblick"
    );
  });

  it("slugify: ä→ae, ö→oe, ü→ue, ß→ss, strips diacritics, collapses non-alphanumerics", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: { name: "Größte Übersicht — Café", pillar: "x" },
        detection: NO_DETECTION,
      },
      mockCtx()
    );

    const bc = out.schemaJsonLd.find((s) => s["@type"] === "BreadcrumbList")!;
    const items = bc["itemListElement"] as Array<Record<string, unknown>>;
    expect(items[2]!["item"]).toBe("https://ki-wissensraum.de/cluster/groesste-uebersicht-cafe");
  });

  // ───── FAQPage ───────────────────────────────────────────────────────────

  it("adds FAQPage when hasFaq=true and 3+ questions", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: FAQ_DETECTION,
      },
      mockCtx()
    );

    expect(out.addedTypes).toContain("FAQPage");
    const faq = out.schemaJsonLd.find((s) => s["@type"] === "FAQPage")!;
    expect(faq["@context"]).toBe("https://schema.org");
    const entities = faq["mainEntity"] as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(3);
    expect(entities[0]!["@type"]).toBe("Question");
    expect(entities[0]!["name"]).toBe("Was ist ChatGPT?");
    const answer = entities[0]!["acceptedAnswer"] as Record<string, unknown>;
    expect(answer["@type"]).toBe("Answer");
    expect(answer["text"]).toBe("ChatGPT ist ein KI-Chatbot von OpenAI.");
  });

  it("does NOT add FAQPage when hasFaq=false", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: NO_DETECTION,
      },
      mockCtx()
    );

    expect(out.addedTypes).not.toContain("FAQPage");
    expect(out.schemaJsonLd.find((s) => s["@type"] === "FAQPage")).toBeUndefined();
  });

  it("does NOT add FAQPage when hasFaq=true but fewer than 3 questions", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: {
          ...FAQ_DETECTION,
          faqQuestions: [
            { question: "Frage 1?", answer: "Antwort 1." },
            { question: "Frage 2?", answer: "Antwort 2." },
          ],
        },
      },
      mockCtx()
    );

    expect(out.addedTypes).not.toContain("FAQPage");
  });

  // ───── HowTo ─────────────────────────────────────────────────────────────

  it("adds HowTo when hasHowTo=true, 3+ steps, and howToName set", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: HOWTO_DETECTION,
      },
      mockCtx()
    );

    expect(out.addedTypes).toContain("HowTo");
    const howto = out.schemaJsonLd.find((s) => s["@type"] === "HowTo")!;
    expect(howto["@context"]).toBe("https://schema.org");
    expect(howto["name"]).toBe("Claude API einrichten");
    expect(howto["image"]).toBe(BASE_ARTICLE.heroImagePublicUrl);
    expect(howto["totalTime"]).toBe("PT15M");
    const steps = howto["step"] as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(3);
    expect(steps[0]!["@type"]).toBe("HowToStep");
    expect(steps[0]!["position"]).toBe(1);
    expect(steps[0]!["name"]).toBe("Account erstellen");
  });

  it("does NOT add HowTo when hasHowTo=false", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: NO_DETECTION,
      },
      mockCtx()
    );

    expect(out.addedTypes).not.toContain("HowTo");
    expect(out.schemaJsonLd.find((s) => s["@type"] === "HowTo")).toBeUndefined();
  });

  it("does NOT add HowTo when howToName is null (even if steps exist)", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: { ...HOWTO_DETECTION, howToName: null },
      },
      mockCtx()
    );

    expect(out.addedTypes).not.toContain("HowTo");
  });

  it("does NOT add HowTo when fewer than 3 steps", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: {
          ...HOWTO_DETECTION,
          howToSteps: [
            { name: "Schritt 1", text: "Erster Schritt." },
            { name: "Schritt 2", text: "Zweiter Schritt." },
          ],
        },
      },
      mockCtx()
    );

    expect(out.addedTypes).not.toContain("HowTo");
  });

  it("omits totalTime field when howToTotalTime is null", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: null,
        detection: { ...HOWTO_DETECTION, howToTotalTime: null },
      },
      mockCtx()
    );

    const howto = out.schemaJsonLd.find((s) => s["@type"] === "HowTo")!;
    expect(howto).toBeDefined();
    expect("totalTime" in howto).toBe(false);
  });

  // ───── All three types together ───────────────────────────────────────────

  it("emits BreadcrumbList + FAQPage + HowTo when both detected", async () => {
    const out = await step.execute(
      {
        article: BASE_ARTICLE,
        project: BASE_PROJECT,
        cluster: { name: "Claude API", pillar: "AI Tools" },
        detection: {
          hasFaq: true,
          hasHowTo: true,
          faqQuestions: FAQ_DETECTION.faqQuestions,
          howToSteps: HOWTO_DETECTION.howToSteps,
          howToName: HOWTO_DETECTION.howToName,
          howToTotalTime: HOWTO_DETECTION.howToTotalTime,
        },
      },
      mockCtx()
    );

    expect(out.addedTypes).toContain("BreadcrumbList");
    expect(out.addedTypes).toContain("FAQPage");
    expect(out.addedTypes).toContain("HowTo");
    // Original Article from Spec 20 + 3 new = 4 total
    expect(out.schemaJsonLd).toHaveLength(4);
  });

  // ───── Idempotency ────────────────────────────────────────────────────────

  it("replaces existing BreadcrumbList/FAQPage/HowTo entries on re-run (no duplicates)", async () => {
    const existingBreadcrumb = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [],
    };
    const existingFaq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] };

    const out = await step.execute(
      {
        article: {
          ...BASE_ARTICLE,
          schemaJsonLd: [
            { "@context": "https://schema.org", "@type": "Article", headline: "old" },
            existingBreadcrumb,
            existingFaq,
          ],
        },
        project: BASE_PROJECT,
        cluster: null,
        detection: FAQ_DETECTION,
      },
      mockCtx()
    );

    const breadcrumbs = out.schemaJsonLd.filter((s) => s["@type"] === "BreadcrumbList");
    const faqs = out.schemaJsonLd.filter((s) => s["@type"] === "FAQPage");
    expect(breadcrumbs).toHaveLength(1);
    expect(faqs).toHaveLength(1);
    // The new FAQ has actual questions; the old one had empty mainEntity
    const newFaq = faqs[0]!;
    expect((newFaq["mainEntity"] as unknown[]).length).toBe(3);
  });

  it("preserves existing Article JSON-LD from Spec 20 when adding new types", async () => {
    const articleSchema = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "KI-Tools im Vergleich",
    };

    const out = await step.execute(
      {
        article: { ...BASE_ARTICLE, schemaJsonLd: [articleSchema] },
        project: BASE_PROJECT,
        cluster: null,
        detection: FAQ_DETECTION,
      },
      mockCtx()
    );

    const articles = out.schemaJsonLd.filter((s) => s["@type"] === "Article");
    expect(articles).toHaveLength(1);
    expect(articles[0]!["headline"]).toBe("KI-Tools im Vergleich");
  });
});
