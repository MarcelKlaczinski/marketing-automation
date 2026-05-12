export interface NicheContext {
  niche: string | null;
  description: string;
  exampleCompetitors: {
    international: string[];
    dach: string[];
  };
  topicalKeywords: string[];
  contentTypes: string[];
}

const NICHE_LIBRARY: Record<string, NicheContext> = {
  "ai-tool-wiki": {
    niche: "ai-tool-wiki",
    description:
      "Editorial, tested directory + knowledge hub for AI tools, with reviews and comparisons",
    exampleCompetitors: {
      international: ["toolify.ai", "futurepedia.io", "theresanaiforthat.com", "aitools.fyi"],
      dach: ["ki-tools.de", "datasolut.com", "futurebiz.de"],
    },
    topicalKeywords: [
      "AI tools",
      "KI Werkzeuge",
      "AI directory",
      "KI Tool-Tests",
      "AI tool reviews",
      "ChatGPT alternatives",
    ],
    contentTypes: ["tool reviews", "comparisons", "knowledge pillars", "use-case guides"],
  },
  "automotive-dealer": {
    niche: "automotive-dealer",
    description: "Regional car dealership + sales platform (DACH-focused)",
    exampleCompetitors: {
      international: [],
      dach: ["mobile.de", "autoscout24.de", "auto.de"],
    },
    topicalKeywords: ["Auto kaufen", "Gebrauchtwagen", "Autohaus", "Neuwagen"],
    contentTypes: ["car listings", "comparisons", "buying guides"],
  },
  "solar-energy": {
    niche: "solar-energy",
    description: "Solar energy products + balcony power stations (DACH-focused)",
    exampleCompetitors: {
      international: [],
      dach: ["selfmade-energy.com", "priwatt.de", "anker.com/de", "balkonsolar.net"],
    },
    topicalKeywords: ["Balkonkraftwerk", "Photovoltaik", "Solar", "Eigenverbrauch"],
    contentTypes: ["product reviews", "installation guides", "buying advice"],
  },
};

const GENERIC_FALLBACK: NicheContext = {
  niche: null,
  description: "Generic content site — no specific niche library available",
  exampleCompetitors: { international: [], dach: [] },
  topicalKeywords: [],
  contentTypes: [],
};

export function buildNicheContext(niche: string | null): NicheContext {
  if (niche && NICHE_LIBRARY[niche]) {
    return NICHE_LIBRARY[niche]!;
  }
  return GENERIC_FALLBACK;
}
