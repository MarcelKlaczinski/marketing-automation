// Spec 65.0 Day 5 — auto-fill examples for the template preview modal.
//
// Each entry is the FULL composition-input shape that the underlying
// render-server function expects — NOT the buildInput-output shape stored
// in `TemplateDefinition.mockFixtures`. Adapted from
// `packages/social/scripts/visual-render-all.ts` (the canonical visual
// harness); duplicated here because `apps/web` cannot import from
// `@marketing-auto/*` workspace packages.
//
// When a template's composition schema changes, the corresponding example
// must be updated here. Adding a new template = add a new entry; templates
// without an entry hide the "Auto-fill" button rather than break.

export type SampleDataByKey = Record<string, Record<string, unknown>>;

export const TEMPLATE_SAMPLE_DATA: SampleDataByKey = {
  // ── comparison-grid-4 ─────────────────────────────────────────────────
  "comparison-grid-4": {
    slideIndex: 0,
    locale: "de",
    theme: "dark",
    generated: {
      headline: "Welcher KI-Bildgenerator",
      headlineEm: "gewinnt 2026?",
      subline:
        "Vier Modelle, dieselben 12 Prompts, drei Wochen Test — hier ist das Ergebnis.",
      eyebrow: "Vergleich · 4 Tools",
      slideNum: "01 / 04",
      ctaLine1: "Mehr Tool-Tests",
      ctaLine2: "auf toolwiki.ai",
      dateLabel: "Mai 2026",
      tools: [
        {
          name: "Midjourney",
          verdictStrong: "Premium-Ästhetik",
          verdictRest: "out-of-the-box, ideal für Hero-Visuals.",
          score: 92,
          scoreTier: "hi",
          priceLabel: "ab 10 €",
          isWinner: true,
          winnerFlagText: "Testsieger",
          iconInitials: "MJ",
          iconHue: 220,
        },
        {
          name: "Flux 1.2 Pro",
          verdictStrong: "Stärkster Photorealismus",
          verdictRest: "mit fairer API-Pricing.",
          score: 88,
          scoreTier: "hi",
          priceLabel: "ab 0,05 €",
          isWinner: false,
          iconInitials: "FX",
          iconHue: 260,
        },
        {
          name: "Recraft V3",
          verdictStrong: "Vektor-Export",
          verdictRest: "direkt aus der Box, ideal für Design-Teams.",
          score: 84,
          scoreTier: "mid",
          priceLabel: "ab 0 €",
          isWinner: false,
          iconInitials: "RC",
          iconHue: 180,
        },
        {
          name: "Ideogram 2.0",
          verdictStrong: "Beste Typografie",
          verdictRest: "für Text-im-Bild-Motive.",
          score: 80,
          scoreTier: "mid",
          priceLabel: "ab 0 €",
          isWinner: false,
          iconInitials: "ID",
          iconHue: 280,
        },
      ],
    },
  },

  // ── comparison-grid-3 ─────────────────────────────────────────────────
  "comparison-grid-3": {
    slideIndex: 0,
    locale: "de",
    theme: "dark",
    generated: {
      headline: "Die",
      headlineEm: "drei Schulen",
      subline:
        "Ästhetik, Prompt-Adhärenz oder Kontrolle — jedes Tool steht für eine andere Philosophie.",
      eyebrow: "Vergleich · 3 Top-Modelle",
      slideNum: "01 / 01",
      ctaLine1: "Workflow-Empfehlungen →",
      ctaLine2: "toolwiki.ai/bilder",
      dateLabel: "Stand 05/2026 · toolwiki.ai/bilder",
      tools: [
        {
          name: "Midjourney v7",
          meta: "Premium-Ästhetik · web + Discord",
          score: 92,
          scoreTier: "hi",
          pricePrefix: "Ab",
          priceAmount: "10 $/Mo",
          isWinner: true,
          winnerFlagText: "Top Aesthetic",
          pros: [
            "Hero-Visuals out-of-the-box auf Agentur-Niveau",
            "--sref & --cref für Marken-Konsistenz",
          ],
          cons: ["Schwer aus dem MJ-Look auszubrechen", "Text im Bild bleibt schwach"],
          iconInitials: "MJ",
          iconHue: 220,
        },
        {
          name: "DALL·E 4",
          meta: "Prompt-Adhärenz · via ChatGPT",
          score: 81,
          scoreTier: "hi",
          pricePrefix: "Ab",
          priceAmount: "20 $/Mo",
          isWinner: false,
          pros: ["Liefert exakt was du beschreibst", "Text endlich lesbar"],
          cons: ["Stil oft glatt, austauschbar", "Weniger Stil-Kontrolle"],
          iconInitials: "DE",
          iconHue: 160,
        },
        {
          name: "Stable Diffusion",
          meta: "Maximale Kontrolle · ComfyUI",
          score: 74,
          scoreTier: "mid",
          pricePrefix: "",
          priceAmount: "Kostenlos",
          isWinner: false,
          pros: [
            "LoRAs für 98% Charakter-Konsistenz",
            "Kein Abo, keine Quota, lokal",
          ],
          cons: [
            "Steile Lernkurve (Hardware + Nodes)",
            "SD-Default wirkt blass ohne LoRA",
          ],
          iconInitials: "SD",
          iconHue: 270,
        },
      ],
    },
  },

  // ── verdict-per-use-case ──────────────────────────────────────────────
  "verdict-per-use-case": {
    theme: "dark",
    locale: "de",
    slideIndex: 0,
    websiteUrl: "toolwiki.ai",
    instagramHandle: "@toolwiki.ai",
    articleSlug: "recraft-vs-ideogram",
    tools: [
      { slug: "recraft", name: "Recraft", iconInitials: "RC", iconHue: 220 },
      { slug: "ideogram", name: "Ideogram", iconInitials: "ID", iconHue: 280 },
    ],
    verdicts: [
      {
        useCase: "Logo-Design für Brand-Identität",
        winner: "recraft",
        reason:
          "Vektor-Export und Brand-Konsistenz sind hier entscheidend — Recraft liefert beide aus der Box.",
      },
      {
        useCase: "Text im Bild (z.B. Poster, Meme)",
        winner: "ideogram",
        reason:
          "Ideograms Typografie-Kontrolle ist klar überlegen. Weniger Halluzinationen bei Buchstaben.",
      },
      {
        useCase: "Social-Media-Posts",
        winner: "recraft",
        reason:
          "Mehr vorgefertigte Formate, bessere Pixel-Kontrolle für Quadrat-Zuschnitte.",
      },
      {
        useCase: "Produktbilder (Freisteller)",
        winner: "recraft",
        reason:
          "Sauberere Hintergrundremovals, konsistentere Objektisolation bei komplexen Formen.",
      },
      {
        useCase: "Poster-Design & Kampagnen",
        winner: "ideogram",
        reason:
          "Stärkere Kombination aus Illustration und Schrift, besonders bei mehrsprachigen Motiven.",
      },
    ],
  },

  // ── single-tool-spotlight ─────────────────────────────────────────────
  // 3-slide composition: cover (slideIndex 0) / body (1) / end (2). The
  // example uses slideIndex 1 (body) — most representative single-still
  // preview. UI users can change slideIndex in the JSON editor.
  "single-tool-spotlight": {
    slideIndex: 1,
    slideTotal: 3,
    cover: null,
    body: {
      eyebrow: "Deep Dive · Tool-Portrait",
      headerNum: "Test 04/2026 · 50k+ Generierungen",
      slideIndex: 1,
      slideTotal: 3,
      tool: { logo: "", name: "Midjourney", version: "v7 · Premium-Ästhetik", isLive: true },
      verdictQuote: "Für Hero-Visuals und Mood-Boards 2026 immer noch ungeschlagen.",
      score: 92,
      scoreLabel: "Top Aesthetic",
      facts: [
        { key: "Pricing", value: "Ab 10 $/Mo" },
        { key: "Standard", value: "30 $ · 15h GPU" },
        { key: "Für wen", value: "Marketing" },
        { key: "Commercial", value: "Ab Basic" },
      ],
      strengths: [
        "Ästhetik out-of-the-box auf Stockfoto-Niveau.",
        "--sref für konsistenten Brand-Look.",
        "Subtile Hauttöne, anspruchsvolles Licht.",
        "API seit v6.1 für Studio-Pipelines.",
      ],
      weaknesses: [
        "Text im Bild bleibt schwach (→ Ideogram).",
        "Schwer aus dem MJ-Look auszubrechen.",
        "--cref max. 85 % Charakter-Ähnlichkeit.",
        "Komposition kippt aus Stil-Bias.",
      ],
      footer: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/midjourney" },
    },
    end: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/midjourney" },
    locale: "de",
    theme: "dark",
  },

  // ── pro-con-verdict ───────────────────────────────────────────────────
  "pro-con-verdict": {
    theme: "dark",
    locale: "de",
    slideIndex: 0,
    generated: {
      toolName: "Midjourney v7",
      toolCategory: "KI-Bildgenerator",
      iconInitials: "MJ",
      iconHue: 260,
      subline:
        "In Pro und Contra — wofür sich Midjourney lohnt, und wo du besser ein anderes Tool wählst.",
      eyebrow: "Pro & Contra · Tool-Verdict",
      slideNum: "05 / 05",
      ctaLine1: "Vollständiger Test →",
      ctaLine2: "toolwiki.ai/midjourney",
      dateLabel: "Stand 05/2026 · toolwiki.ai/bilder",
      prosHeader: "Stärken",
      consHeader: "Schwächen",
      pros: [
        "Beste Ästhetik out-of-the-box",
        "Konsistenz durch --sref & --cref",
        "Schnelle Iteration im Web-Interface",
        "Starke Community & Ressourcen",
      ],
      cons: [
        "Kein API für Automatisierung",
        "Text im Bild schwach",
        "Schwer aus dem MJ-Look auszubrechen",
        "Kein lokales Hosting möglich",
      ],
      verdictText:
        "Für Hero-Visuals und Branding erste Wahl — solange du keinen API-Zugang brauchst.",
      verdictEm: "erste Wahl",
      recommendationTag: "Empfohlen für: Content Creator & Agenturen",
    },
  },
};

export function hasSampleData(templateKey: string): boolean {
  return templateKey in TEMPLATE_SAMPLE_DATA;
}

export function getSampleData(templateKey: string): Record<string, unknown> | null {
  return TEMPLATE_SAMPLE_DATA[templateKey] ?? null;
}
