import type { MockFixtureMap } from "../../types.ts";
import type { ToolContext } from "../../adapters/tool.ts";
import type { SingleToolSpotlightGenerated } from "../singleToolSpotlight.ts";
import type { SingleToolSpotlightInput } from "../../../compositions/single-tool-spotlight/types.ts";

// ---------------------------------------------------------------------------
// Template registry fixtures (input: ToolContext — used by preview gallery,
// eligibility checks, and fixture-based tests that call buildInput/render).
// ---------------------------------------------------------------------------

export const SINGLE_TOOL_SPOTLIGHT_FIXTURES: MockFixtureMap = {
  // Midjourney @ score 92 — full DS content ready for 60.1 body slide
  characteristic: {
    name: "characteristic",
    description: "Midjourney v7 — tool-spotlight mit verdictQuote, score 92, 4 strengths/weaknesses",
    input: {
      slug: "midjourney",
      name: "Midjourney",
      tagline: "Für Hero-Visuals und Mood-Boards 2026 immer noch ungeschlagen.",
      primaryCategory: "KI-Bildgenerator",
      pricingTier: "paid",
      priceFrom: 10,
      rating: 4.6,
      website: "https://midjourney.com",
      affiliateSlug: "midjourney",
      pros: [
        { text: "Ästhetik out-of-the-box auf Stockfoto-Niveau" },
        { text: "--sref für konsistenten Brand-Look" },
        { text: "Subtile Hauttöne, anspruchsvolles Licht" },
        { text: "API seit v6.1 für Studio-Pipelines" },
      ],
      cons: [
        { text: "Text im Bild bleibt schwach (→ Ideogram)" },
        { text: "Schwer aus dem MJ-Look auszubrechen" },
        { text: "--cref max. 85 % Charakter-Ähnlichkeit" },
        { text: "Komposition kippt manchmal aus Stil-Bias" },
      ],
      features: [
        "v7-Modell mit verbessertem Prompt-Verständnis",
        "--sref für Style-Reference-Konsistenz",
        "--cref für Character-Reference (85 % Ähnlichkeit)",
        "Web-Interface + API für Studio-Pipelines",
        "Niji-Modus für Anime-Ästhetik",
        "Negative Prompts via --no Flag",
      ],
      useCases: [
        "Hero-Visuals und Mood-Boards",
        "Marketing-Kampagnen mit konsistentem Brand-Look",
        "Editorial-Illustration für Blogs und Artikel",
        "Rapid Prototyping für Design-Konzepte",
      ],
      iconInitials: "MJ",
      iconHue: 200,
    } satisfies ToolContext,
    generatedContent: {
      verdictQuote:
        "Für Hero-Visuals und Mood-Boards 2026 immer noch ungeschlagen.",
      scoreLabel: "Top Aesthetic",
      facts: [
        { key: "Pricing",    value: "Ab 10 $/Mo" },
        { key: "Standard",   value: "30 $ · 15h GPU" },
        { key: "Für wen",    value: "Marketing" },
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
      caption:
        "Midjourney v7 im ehrlichen Test: Wo das Tool 2026 wirklich unschlagbar ist — und wo es Grenzen hat.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/midjourney",
      hashtags: [
        "#KIBildgenerator",
        "#AIImageGenerator",
        "#Midjourney",
        "#KIFürBusiness",
        "#AIForBusiness",
        "#DesignKI",
        "#AITools",
      ],
    } satisfies SingleToolSpotlightGenerated,
  },

  // Minimal — 3 strengths + 3 weaknesses, shortest valid content
  "edge-min": {
    name: "edge-min",
    description: "Minimal-Input: genau 3 pros (= strengths), kürzest gültige Felder",
    input: {
      slug: "min-tool",
      name: "MinTool",
      pricingTier: "free",
      pros: [
        { text: "Kostenlos nutzbar ohne Anmeldung" },
        { text: "Läuft im Browser ohne Installation" },
        { text: "Schnelle Ergebnisse unter 10 Sekunden" },
      ],
      cons: [
        { text: "Kein Export in Vektorformat" },
        { text: "Nur 5 Generierungen pro Tag kostenlos" },
        { text: "Keine API für Entwickler verfügbar" },
      ],
      features: [],
      useCases: [],
      iconInitials: "MT",
      iconHue: 190,
    } satisfies ToolContext,
    generatedContent: {
      verdictQuote:
        "Für schnelle Browser-Experimente ohne Setup die erste Wahl.",
      scoreLabel: "Solid Starter",
      facts: [
        { key: "Preis",   value: "Kostenlos" },
        { key: "Plan",    value: "Free Tier" },
        { key: "Für wen", value: "Einsteiger" },
        { key: "APIs",    value: "Nicht da" },
      ],
      strengths: [
        "Kostenlos nutzbar ohne Anmeldung nötig.",
        "Läuft im Browser ohne Installation.",
        "Schnelle Ergebnisse unter 10 Sekunden.",
      ],
      weaknesses: [
        "Kein Export in Vektorformat verfügbar.",
        "Nur 5 Generierungen pro Tag kostenlos.",
        "Keine API für Entwickler vorhanden.",
      ],
      caption: "MinTool: Kostenlos, kein Login, sofort nutzbar.\n\n→ toolwiki.ai/min-tool",
      hashtags: [
        "#KITools",
        "#AITools",
        "#KostenlosKI",
        "#KIFürBusiness",
        "#AIForBusiness",
        "#FreeAI",
        "#KITipp",
      ],
    } satisfies SingleToolSpotlightGenerated,
  },

  // Maximum — 4 strengths + 4 weaknesses, longest valid tool name and content
  "edge-max": {
    name: "edge-max",
    description: "Maximum-Input: 4 pros/cons at max length, tool name 14 chars — no overflow",
    input: {
      slug: "maximum-length-tool",
      name: "MaximumLengthT",
      tagline: "Enterprise-KI-Plattform für skalierbare Automatisierungs-Workflows und Compliance.",
      primaryCategory: "KI-Automatisierung",
      pricingTier: "enterprise",
      priceFrom: 499,
      rating: 4.1,
      website: "https://maximumlengthtool.example.com",
      affiliateSlug: "maximum-length-tool",
      pros: [
        { text: "SOC2 Type II zertifiziert, DSGVO-konform für EU-Deployment" },
        { text: "Unbegrenzte Workspaces und Nutzerlizenzen inklusive" },
        { text: "REST API plus Webhooks für alle Workflow-Aktionen" },
        { text: "Dedizierter 24/7 Enterprise-Support mit SLA-Garantie" },
      ],
      cons: [
        { text: "Steile Lernkurve bei komplexen Multi-Step-Workflows" },
        { text: "Onboarding dauert typischerweise zwei bis vier Wochen" },
        { text: "Keine native Mobile-App für iOS oder Android verfügbar" },
        { text: "Preis für kleine und mittlere Unternehmen schwer justifizierbar" },
      ],
      features: [
        "Visueller Drag-and-Drop Workflow-Builder",
        "KI-Anomalie-Erkennung in Echtzeit",
        "Multi-Cloud: AWS, Azure, GCP",
        "Granulare RBAC-Berechtigungen",
        "Audit-Trail mit 90-Tage-Retention",
        "White-Label und Custom-Domain",
      ],
      useCases: [
        "Automatisierung komplexer Enterprise-Workflows",
        "Compliance-Monitoring und Audit-Reporting",
        "Multi-Cloud-Datenintegration und ETL",
        "Echtzeit-Anomalie-Erkennung in Produktionssystemen",
      ],
      iconInitials: "ML",
      iconHue: 280,
    } satisfies ToolContext,
    generatedContent: {
      verdictQuote:
        "Für Enterprise-Teams mit Compliance-Anforderungen die technisch stärkste Plattform.",
      scoreLabel: "Enterprise Pick",
      facts: [
        { key: "Preis/Mo",   value: "Ab 499 $/Mo" },
        { key: "Zertifikat", value: "SOC2 + DSGVO" },
        { key: "Für wen",    value: "Enterprise" },
        { key: "Support",    value: "24/7 SLA" },
      ],
      strengths: [
        "SOC2 Type II und DSGVO-konform für EU-Einsatz.",
        "Unbegrenzte Workspaces und Lizenzen inklusive.",
        "REST API plus Webhooks für alle Aktionen.",
        "Dedizierter 24/7 Enterprise-Support mit SLA.",
      ],
      weaknesses: [
        "Steile Lernkurve bei Multi-Step-Workflows.",
        "Onboarding dauert zwei bis vier Wochen typisch.",
        "Keine native Mobile-App für iOS oder Android.",
        "Preis für KMU schwer zu rechtfertigen leider.",
      ],
      caption:
        "MaximumLengthT im Enterprise-Test: SOC2, RBAC, Multi-Cloud — lohnt sich der Preis wirklich?\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/maximum-length-tool",
      hashtags: [
        "#KIEnterprise",
        "#AIAutomation",
        "#EnterpriseKI",
        "#KIFürBusiness",
        "#AIForBusiness",
        "#WorkflowAutomation",
        "#SoftwareTest",
      ],
    } satisfies SingleToolSpotlightGenerated,
  },
};

// ---------------------------------------------------------------------------
// Composition fixtures — full SingleToolSpotlightInput shapes for visual tests
// (Section H.3). Used by single-tool-spotlight-visual.test.ts via renderAndDiff().
// ---------------------------------------------------------------------------

export const SINGLE_TOOL_SPOTLIGHT_COMPOSITION_FIXTURES: Record<string, SingleToolSpotlightInput> = {
  characteristic: {
    slideIndex: 0,
    slideTotal: 3,
    cover: null,
    body: {
      eyebrow: "Deep Dive · Tool-Portrait",
      headerNum: "Test 04/2026 · 50k+ Generierungen",
      slideIndex: 1,
      slideTotal: 3,
      tool: {
        logo: "",
        name: "Midjourney",
        version: "v7 · Premium-Ästhetik",
        isLive: true,
      },
      verdictQuote:
        "Für Hero-Visuals und Mood-Boards 2026 immer noch ungeschlagen.",
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
      footer: {
        ctaLine: "Vollständiger Test →",
        url: "toolwiki.ai/midjourney",
      },
    },
    end: {
      ctaLine: "Vollständiger Test →",
      url: "toolwiki.ai/midjourney",
    },
    theme: "dark",
    locale: "de",
  },

  "edge-min": {
    slideIndex: 0,
    slideTotal: 2,
    cover: null,
    body: {
      eyebrow: "Deep Dive · Tool",
      headerNum: "Test 05/2026 · Min-Tool",
      slideIndex: 0,
      slideTotal: 2,
      tool: {
        logo: "",
        name: "MinTool",
        version: "v1.0 · Kostenlos",
        isLive: false,
      },
      verdictQuote: "Für schnelle Browser-Experimente ohne Setup die erste Wahl.",
      score: 61,
      scoreLabel: "Solid Starter",
      facts: [
        { key: "Preis", value: "Kostenlos" },
        { key: "Plan", value: "Free Tier" },
        { key: "Für wen", value: "Einsteiger" },
        { key: "APIs", value: "Nicht da" },
      ],
      strengths: [
        "Kostenlos nutzbar ohne Anmeldung nötig.",
        "Läuft im Browser ohne Installation.",
        "Schnelle Ergebnisse unter 10 Sekunden.",
      ],
      weaknesses: [
        "Kein Export in Vektorformat verfügbar.",
        "Nur 5 Generierungen pro Tag kostenlos.",
        "Keine API für Entwickler vorhanden.",
      ],
      footer: {
        ctaLine: "Zum kostenlosen Test →",
        url: "toolwiki.ai/min-tool",
      },
    },
    end: {
      ctaLine: "Zum kostenlosen Test →",
      url: "toolwiki.ai/min-tool",
    },
    theme: "dark",
    locale: "de",
  },

  "edge-max": {
    slideIndex: 0,
    slideTotal: 3,
    cover: {
      eyebrow: "Enterprise · Deep Dive",
      headerNum: "Audit 05/2026 · MaximumLengthT",
      updateBadge: "Stand: Mai 2026",
      heroTitle: "Enterprise KI",
      kicker:
        "Vollständiger Test einer Enterprise-KI-Plattform mit SOC2, RBAC, Multi-Cloud und 24/7-Support.",
      toolLogos: [
        { src: "", alt: "MaximumLengthT" },
        { src: "", alt: "AWS" },
        { src: "", alt: "Azure" },
      ],
      toolsMoreText: "+ 3 weitere",
      stats: [
        { value: "SOC", label: "Type II zertifiziert" },
        { value: "99%", label: "SLA-Verfügbarkeit" },
        { value: "90d", label: "Audit-Trail-Retention" },
      ],
      byline: {
        initials: "MK",
        name: "Marcel Klaczinski",
        role: "Editor · Enterprise & Compliance",
        readTime: "18 Min Lesen",
      },
      swipeText: "Swipe für den Deep Dive",
      footer: {
        ctaLine: "Vollständiger Test →",
        url: "toolwiki.ai/enterprise",
      },
    },
    body: {
      eyebrow: "Enterprise · Deep Dive",
      headerNum: "Audit 05/2026 · MaximumLengthT",
      slideIndex: 1,
      slideTotal: 3,
      tool: {
        logo: "",
        name: "MaximumLengthT",
        version: "v4.2 Enterprise · SOC2 certified",
        isLive: true,
      },
      verdictQuote:
        "Für Enterprise-Teams mit Compliance-Anforderungen die technisch stärkste Plattform.",
      score: 84,
      scoreLabel: "Enterprise Pick",
      facts: [
        { key: "Preis/Mo", value: "Ab 499 $/Mo" },
        { key: "Zertifikat", value: "SOC2 + DSGVO" },
        { key: "Für wen", value: "Enterprise" },
        { key: "Support", value: "24/7 SLA" },
      ],
      strengths: [
        "SOC2 Type II und DSGVO-konform für EU-Einsatz.",
        "Unbegrenzte Workspaces und Lizenzen inklusive.",
        "REST API plus Webhooks für alle Aktionen.",
        "Dedizierter 24/7 Enterprise-Support mit SLA.",
      ],
      weaknesses: [
        "Steile Lernkurve bei Multi-Step-Workflows.",
        "Onboarding dauert zwei bis vier Wochen typisch.",
        "Keine native Mobile-App für iOS oder Android.",
        "Preis für KMU schwer zu rechtfertigen leider.",
      ],
      footer: {
        ctaLine: "Vollständiger Test →",
        url: "toolwiki.ai/enterprise",
      },
    },
    end: {
      ctaLine: "Vollständiger Test →",
      url: "toolwiki.ai/enterprise",
    },
    theme: "dark",
    locale: "de",
  },
};
