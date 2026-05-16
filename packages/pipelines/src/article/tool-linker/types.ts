export interface ToolReference {
  slug: string;
  name: string;
  pricing: string | null;
  rating: number | null;
  shortDescription: string | null;
  features: string[];
}

export interface RelevantTools {
  primary: ToolReference[];   // cluster-matched tools (LLM should use these)
  secondary: ToolReference[]; // top-3 in category by rating (LLM may use these)
}

export interface LinkifyResult {
  bodyMd: string;
  linksAdded: number;
  linkedTools: string[]; // slugs of tools that got linked
}
