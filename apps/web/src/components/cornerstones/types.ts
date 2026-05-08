export type CornerstoneStatus =
  | "proposed"
  | "approved"
  | "in_generation"
  | "article_done"
  | "rejected";

export type CornerstoneSpec = {
  id: string;
  clusterId: string;
  locale: string;
  translationKey: string;
  cornerstoneKeyword: string;
  proposedTitle: string;
  proposedSlug: string;
  metaDescription: string;
  estimatedWordCount: number;
  h2Outline: string[];
  status: CornerstoneStatus;
  rejectedReason?: string | null;
};

export type CornerstonePair = {
  translationKey: string;
  clusterId: string;
  de: CornerstoneSpec | null;
  en: CornerstoneSpec | null;
};
