import type { MockFixtureMap } from "../../types.ts";
import type { ToolContext } from "../../adapters/tool.ts";
import type { SingleToolSpotlightGenerated } from "../singleToolSpotlight.ts";

export const SINGLE_TOOL_SPOTLIGHT_FIXTURES: MockFixtureMap = {
  // Full tool with all fields — proves 5-slide layout with use-case slide
  characteristic: {
    name: "characteristic",
    description: "ChatGPT — volles Frontmatter, alle Felder, 5 Slides",
    input: {
      slug: "chatgpt",
      name: "ChatGPT",
      tagline: "Der bekannteste KI-Assistent der Welt — für Text, Code und Recherche.",
      primaryCategory: "KI-Assistent",
      pricingTier: "freemium",
      priceFrom: 20,
      rating: 4.6,
      website: "https://chat.openai.com",
      affiliateSlug: "chatgpt",
      pros: [
        { text: "Stärkste Sprachmodelle (GPT-4o, o1)" },
        { text: "Riesige Plugin- und GPT-Bibliothek" },
        { text: "Beste Coding-Unterstützung in Free-Tier" },
        { text: "Multimodal: Text, Bild, Audio, Video" },
        { text: "API mit günstigsten Token-Kosten" },
      ],
      cons: [
        { text: "Datenschutz: Opt-out nötig für Training" },
        { text: "Kontext-Limit bei langen Gesprächen" },
        { text: "Halluziniert bei sehr spezifischen Fakten" },
      ],
      features: [
        "GPT-4o und o1 Reasoning-Modell",
        "DALL-E 3 Bildgenerierung integriert",
        "Code Interpreter mit Python-Ausführung",
        "Custom GPTs baubar",
        "Plugins und Tools-Ecosystem",
        "Web-Browsing in Echtzeit",
      ],
      useCases: [
        "Texte schreiben und überarbeiten",
        "Code debuggen und generieren",
        "Recherche und Zusammenfassungen",
        "Bilder generieren mit DALL-E 3",
      ],
      iconInitials: "GP",
      iconHue: 160,
    } satisfies ToolContext,
    generatedContent: {
      caption: "ChatGPT: Der bekannteste KI-Assistent im ehrlichen Test — Stärken, Schwächen und für wen er sich wirklich lohnt.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/chatgpt",
      hashtags: ["#KITools", "#AITools", "#ChatGPT", "#KIAssistent", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"],
    } satisfies SingleToolSpotlightGenerated,
  },

  // Minimal input — proves 4-slide layout stays clean with little content
  "edge-min": {
    name: "edge-min",
    description: "Minimal-Input: genau 2 Pros, 1 Use-Case, simples Pricing — 4 Slides",
    input: {
      slug: "simple-tool",
      name: "SimpleTool",
      pricingTier: "free",
      pros: [
        { text: "Kostenlos nutzbar ohne Registrierung" },
        { text: "Funktioniert in jedem Browser" },
      ],
      cons: [],
      features: [],
      useCases: ["Schnelle Textzusammenfassungen"],
      iconInitials: "ST",
      iconHue: 190,
    } satisfies ToolContext,
    generatedContent: {
      caption: "SimpleTool: Kostenlos und ohne Registrierung nutzbar.\n\n→ toolwiki.ai/simple-tool",
      hashtags: ["#KITools", "#AITools", "#KostenlosKI", "#KIFürBusiness", "#AIForBusiness", "#FreeTools", "#SoftwareTest"],
    } satisfies SingleToolSpotlightGenerated,
  },

  // Maximum content — proves constraints hold, no overflow
  "edge-max": {
    name: "edge-max",
    description: "Maximum-Input: 5 Pros, 4 Cons, 6 Features, 4 Use-Cases — keine Overflows",
    input: {
      slug: "mega-tool",
      name: "MegaTool Pro",
      tagline: "Enterprise-Plattform mit KI-gestützter Automatisierung für skalierbare Workflows.",
      primaryCategory: "KI-Workflow",
      pricingTier: "enterprise",
      priceFrom: 299,
      rating: 4.2,
      website: "https://megatool.example.com",
      affiliateSlug: "megatool-pro",
      pros: [
        { text: "SOC2 Type II + DSGVO-konform zertifiziert" },
        { text: "Unbegrenzte Workspaces und Nutzer" },
        { text: "REST API + Webhooks für alle Aktionen" },
        { text: "On-Premise-Deployment auf eigenen Servern" },
        { text: "Dedizierter Enterprise-Support 24/7" },
      ],
      cons: [
        { text: "Steile Lernkurve bei komplexen Workflows" },
        { text: "Onboarding dauert 2–4 Wochen" },
        { text: "Keine Mobile-App verfügbar" },
        { text: "Preis für KMUs schwer rechtfertigbar" },
      ],
      features: [
        "Visueller Drag-and-Drop Workflow-Builder",
        "KI-gestützte Anomalie-Erkennung in Echtzeit",
        "Multi-Cloud-Connector: AWS, Azure, GCP",
        "Granulare RBAC-Berechtigungen",
        "Audit-Trail mit 90-Tage-Retention",
        "White-Label und Custom-Domain-Support",
      ],
      useCases: [
        "Automatisierung komplexer Unternehmens-Workflows",
        "Compliance-Monitoring und Audit-Reporting",
        "Multi-Cloud-Datenintegration und ETL",
        "Echtzeit-Anomalie-Erkennung in Produktionssystemen",
      ],
      iconInitials: "MP",
      iconHue: 280,
    } satisfies ToolContext,
    generatedContent: {
      caption: "MegaTool Pro: Enterprise-Automatisierung mit KI im ausführlichen Test — 5 Pros, 4 Cons, für wen lohnt sich der Preis wirklich?\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/megatool-pro",
      hashtags: ["#KITools", "#AITools", "#Enterprise", "#KIFürBusiness", "#AIForBusiness", "#WorkflowAutomation", "#SoftwareTest"],
    } satisfies SingleToolSpotlightGenerated,
  },
};
