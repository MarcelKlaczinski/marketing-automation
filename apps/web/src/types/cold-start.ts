export interface ColdStartBrandColors {
  primary: string;
  secondary: string;
}

export interface ColdStartBrandTypography {
  headingFont: string;
}

export interface ColdStartBrandVoice {
  description: string;
}

export interface ColdStartBrandTokens {
  colors: ColdStartBrandColors;
  typography: ColdStartBrandTypography;
  voice: ColdStartBrandVoice;
}

export interface ColdStartPillar {
  id?: string;
  name: string;
  description: string;
  keywords: string[];
}

export interface ColdStartAuthor {
  slug?: string;
  name: string;
  role: string;
  bio: string;
  voiceTone: Record<string, number>;
  expertiseTopics: string[];
}

export interface ColdStartDraft {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  targetLocales: string[];
  marketingContextMd?: string;
  brandTokens?: ColdStartBrandTokens;
  pillars?: ColdStartPillar[];
  authors?: ColdStartAuthor[];
  astroRepoPath?: string;
  deployTarget?: string;
  astroContentPath?: string;
}

export interface ColdStartState {
  currentPhase: number;
  completedPhases: number[];
  brandDiscoveryStatus?: "idle" | "running" | "completed" | "failed";
}

export interface ColdStartFinalizeResult {
  project: { slug: string };
}

export interface ColdStartDraftListItem {
  id: string;
  name: string;
  currentPhase: number;
  updatedAt: string;
}
