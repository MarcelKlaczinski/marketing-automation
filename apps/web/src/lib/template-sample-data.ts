// Spec 65.0 Day 5 — auto-fill examples for the template preview modal.
//
// Each entry is the FULL composition-input shape that the underlying
// render-server function expects — NOT the buildInput-output shape stored
// in `TemplateDefinition.mockFixtures`. Adapted from
// `packages/social/scripts/visual-render-all.ts` (the canonical visual
// harness); duplicated here because `apps/web` cannot import from
// `@marketing-auto/*` workspace packages.
//
// Tool objects carry a `slug` field which the backend preview-service
// uses to auto-resolve real logos via simple-icons → iconify → lobe-icons
// → deterministic-avatar (same chain production buildToolLookup uses).
// Zod will strip the slug after resolution since it's not in the
// composition's input schema — that's intentional.
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
        "Vier Modelle, dieselben 12 Prompts, drei Wochen Test — das ist das Ergebnis.",
      eyebrow: "Vergleich · 4 Bildgeneratoren",
      slideNum: "01 / 04",
      ctaLine1: "Vollständiger Test",
      ctaLine2: "toolwiki.ai/bilder",
      dateLabel: "Mai 2026",
      tools: [
        {
          slug: "midjourney",
          name: "Midjourney",
          verdictStrong: "Premium-Ästhetik",
          verdictRest: "out-of-the-box, ideal für Hero-Visuals.",
          score: 92,
          scoreTier: "hi",
          priceLabel: "ab 10 $/Mo",
          isWinner: true,
          winnerFlagText: "Testsieger",
          iconInitials: "MJ",
          iconHue: 220,
        },
        {
          slug: "openai",
          name: "DALL·E 4",
          verdictStrong: "Beste Prompt-Adhärenz",
          verdictRest: "liefert genau was du beschreibst.",
          score: 88,
          scoreTier: "hi",
          priceLabel: "ab 20 $/Mo",
          isWinner: false,
          iconInitials: "DE",
          iconHue: 160,
        },
        {
          slug: "recraft",
          name: "Recraft V3",
          verdictStrong: "Vektor-Export",
          verdictRest: "direkt aus der Box — ideal für Design-Teams.",
          score: 84,
          scoreTier: "mid",
          priceLabel: "ab 0 €",
          isWinner: false,
          iconInitials: "RC",
          iconHue: 180,
        },
        {
          slug: "ideogram",
          name: "Ideogram 2.0",
          verdictStrong: "Stärkste Typografie",
          verdictRest: "wenn Text im Bild lesbar bleiben muss.",
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
  // Multi-slide carousel (Spec 65.7) — cover/compareHeader/tools/verdict/end
  // sections. Auto-fill picks slideIndex 0 (Cover) so the Spec 65.17 logo-
  // hero refresh is the visible thing on preview.
  "comparison-grid-3": {
    slideIndex: 0,
    slideTotal: 7,
    theme: "dark",
    locale: "de",
    cover: {
      eyebrow: "Vergleich · 3 KI-Bildgeneratoren",
      headlineLead: "Die 3 besten",
      headlineEm: "KI-Bildgeneratoren",
      subline:
        "Drei Tools im Direktvergleich — Pros, Cons, Pricing und der Sieger pro Use-Case.",
      headerNum: "05/2026 · toolwiki.ai/bilder",
    },
    compareHeader: {
      title: "KI-Bildgeneratoren: Was wir vergleichen.",
      criteria: ["Ergebnis-Qualität", "Pricing & Limits", "Workflow-Fit"],
      categoryBadge: "KI-Bildgeneratoren",
    },
    verdict: {
      winnerToolSlug: "midjourney",
      reasoning:
        "Beste Wahl für KI-Bildgeneratoren: Midjourney v7 — die runde Mischung aus Ergebnis-Qualität und Pricing.",
      eyebrow: "Fazit · Sieger",
      ctaLine: "Vollständiger Vergleich →",
    },
    end: {
      headlineLead: "Mehr Vergleiche",
      headlineEm: "ehrlich getestet.",
      articleUrl: "toolwiki.ai/bilder",
      ctaLine: "Vollständiger Vergleich →",
    },
    tools: [
        {
          slug: "midjourney",
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
          slug: "openai",
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
          slug: "stability",
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

  // ── verdict-per-use-case ──────────────────────────────────────────────
  // Single-still composition (Spec 60.4) — uses `verdict-per-use-case/`
  // directory (NOT the legacy `verdict-cards/`). Shape is
  // { generated: { headline, ..., useCases: 5-7 of {label, winnerName, icon*} } }
  "verdict-per-use-case": {
    slideIndex: 0,
    locale: "de",
    theme: "dark",
    generated: {
      headline: "Welches Tool",
      headlineEm: "gewinnt wann?",
      subline:
        "Fünf Use-Cases im direkten Vergleich — pro Aufgabe einen klaren Sieger ohne Diplomatie.",
      eyebrow: "Use-Case-Verdict",
      slideNum: "01 / 01",
      ctaLine1: "Vollständiger Test →",
      ctaLine2: "toolwiki.ai/bilder",
      dateLabel: "Stand 05/2026 · toolwiki.ai/bilder",
      useCases: [
        { label: "Logo-Design", winnerName: "Recraft", iconInitials: "RC", iconHue: 220 },
        { label: "Text im Bild", winnerName: "Ideogram", iconInitials: "ID", iconHue: 280 },
        { label: "Social-Posts", winnerName: "Recraft", iconInitials: "RC", iconHue: 220 },
        { label: "Produktbilder", winnerName: "Recraft", iconInitials: "RC", iconHue: 220 },
        { label: "Poster & Kampagnen", winnerName: "Ideogram", iconInitials: "ID", iconHue: 280 },
      ],
    },
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
      tool: {
        slug: "midjourney",
        logo: "",
        name: "Midjourney",
        version: "v7 · Premium-Ästhetik",
        isLive: true,
      },
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

  // ── head-to-head-vs ───────────────────────────────────────────────────
  // 6-slide Family-A carousel (Spec 65.7). Cover (slideIndex 0) shows the
  // Spec 65.17 VS-faceoff: 2 huge logos with italic "vs." glyph between.
  "head-to-head-vs": {
    slideIndex: 0,
    slideTotal: 6,
    theme: "dark",
    locale: "de",
    cover: {
      eyebrow: "Head-to-Head · Direktvergleich",
      headlineLead: "Cursor",
      headlineEm: "vs. GitHub Copilot",
      subline:
        "Welches Tool gewinnt für deinen Workflow? Direktvergleich mit drei Kriterien und Sieger.",
      headerNum: "05/2026 · toolwiki.ai/code-editors",
    },
    tools: [
      {
        slug: "cursor",
        name: "Cursor",
        score: 90,
        scoreTier: "hi",
        meta: "AI-First IDE · VS-Code-Fork",
        pricePrefix: "Ab",
        priceAmount: "20 $/Mo",
        pros: ["Composer für Multi-File-Refactors", "Tab-Completion mit Codebase-Kontext"],
        cons: ["Höhere Latenz inline", "Eigene IDE — Migration"],
        isWinner: true,
        iconInitials: "CR",
        iconHue: 200,
      },
      {
        slug: "github-copilot",
        name: "GitHub Copilot",
        score: 84,
        scoreTier: "hi",
        meta: "Inline-Autocomplete · VS-Code-Plugin",
        pricePrefix: "Ab",
        priceAmount: "10 $/Mo",
        pros: ["Native VS-Code-Integration", "Copilot Chat im Editor"],
        cons: ["Begrenzter Multi-File-Kontext", "Composer fehlt"],
        isWinner: false,
        iconInitials: "GC",
        iconHue: 30,
      },
    ],
    compare: {
      criteria: [
        { label: "Multi-File", toolAVerdict: "Composer ist State-of-the-Art", toolBVerdict: "Begrenzt auf offene Tabs", winner: "a" },
        { label: "Inline-Speed", toolAVerdict: "Etwas träger", toolBVerdict: "Sub-Sekunden-Antworten", winner: "b" },
        { label: "Pricing", toolAVerdict: "20 $/Mo Pro", toolBVerdict: "10 $/Mo Individual", winner: "b" },
      ],
    },
    verdict: {
      winnerToolSlug: "cursor",
      reasoning:
        "Cursor gewinnt für AI-First-Workflows — Composer macht Multi-File-Refactors zum Heimspiel.",
      eyebrow: "Fazit · Sieger",
      ctaLine: "Vollständiger Vergleich →",
    },
    end: {
      headlineLead: "Mehr Vergleiche",
      headlineEm: "ehrlich getestet.",
      articleUrl: "toolwiki.ai/code-editors",
      ctaLine: "Vollständiger Vergleich →",
    },
  },

  // ── tool-tier-ranking ─────────────────────────────────────────────────
  // Single-still composition (Spec 65.17). 3 stacked tier-lanes
  // (spitze · stark · solide) with 1–2 tool logos per lane, color-coded
  // gold/silver/bronze. Tool `slug` fields auto-resolve to real brand logos
  // via simple-icons → iconify → lobe-icons. FamilyATool requires
  // score/meta/pros/cons/etc. for Zod parse — tier-template only renders
  // name + logo + tier-label but the schema demands the full shape.
  "tool-tier-ranking": {
    slideIndex: 0,
    theme: "dark",
    locale: "de",
    generated: {
      eyebrow: "Tier-Ranking · 5 KI-Bildgeneratoren",
      headlineLead: "Solide,",
      headlineEm: "Stark, Spitze.",
      subline:
        "5 Tools getestet, in 3 Klassen sortiert — datengetrieben aus Persona-Scores.",
      headerNum: "05/2026 · toolwiki.ai/bilder",
      ctaLine: "Vollständiges Ranking →",
      articleUrl: "toolwiki.ai/bilder-ranking",
      tiers: [
        {
          tier: "spitze",
          label: "Spitze",
          tools: [
            {
              slug: "midjourney",
              name: "Midjourney",
              score: 92,
              scoreTier: "hi",
              meta: "Premium-Ästhetik",
              pricePrefix: "Ab",
              priceAmount: "10 $/Mo",
              pros: ["Hero-Visuals", "Konsistenz"],
              cons: ["Schwer auszubrechen", "Text schwach"],
              isWinner: true,
              iconInitials: "MJ",
              iconHue: 220,
            },
            {
              slug: "openai",
              name: "DALL·E 4",
              score: 88,
              scoreTier: "hi",
              meta: "Prompt-Adhärenz",
              pricePrefix: "Ab",
              priceAmount: "20 $/Mo",
              pros: ["Exakte Prompts", "Text lesbar"],
              cons: ["Stil glatt", "Weniger Kontrolle"],
              isWinner: false,
              iconInitials: "DE",
              iconHue: 160,
            },
          ],
        },
        {
          tier: "stark",
          label: "Stark",
          tools: [
            {
              slug: "recraft",
              name: "Flux 1.1 Pro",
              score: 78,
              scoreTier: "hi",
              meta: "Foto-Realismus",
              pricePrefix: "Ab",
              priceAmount: "5 $/Mo",
              pros: ["Photo-Look", "Schnell + günstig"],
              cons: ["Style-Transfer schwach", "EN bevorzugt"],
              isWinner: false,
              iconInitials: "FL",
              iconHue: 30,
            },
            {
              slug: "ideogram",
              name: "Ideogram 2.0",
              score: 72,
              scoreTier: "mid",
              meta: "Typografie",
              pricePrefix: "Ab",
              priceAmount: "8 $/Mo",
              pros: ["Bestes Text-im-Bild", "Schnelle Iteration"],
              cons: ["Foto weniger natürlich", "Begrenzte Library"],
              isWinner: false,
              iconInitials: "ID",
              iconHue: 290,
            },
          ],
        },
        {
          tier: "solide",
          label: "Solide",
          tools: [
            {
              slug: "stability",
              name: "Stable Diffusion",
              score: 58,
              scoreTier: "mid",
              meta: "Maximale Kontrolle",
              pricePrefix: "",
              priceAmount: "Kostenlos",
              pros: ["LoRAs für Konsistenz", "Kein Abo, lokal"],
              cons: ["Steile Lernkurve", "Default wirkt blass"],
              isWinner: false,
              iconInitials: "SD",
              iconHue: 270,
            },
          ],
        },
      ],
    },
  },

  // ── pro-con-verdict ───────────────────────────────────────────────────
  // Uses `generated.iconSlug` — preview-service auto-resolves it to
  // `generated.iconSvg` via the same chain. iconInitials/iconHue stay as
  // fallback if the resolution misses.
  "pro-con-verdict": {
    theme: "dark",
    locale: "de",
    slideIndex: 0,
    generated: {
      iconSlug: "midjourney",
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
