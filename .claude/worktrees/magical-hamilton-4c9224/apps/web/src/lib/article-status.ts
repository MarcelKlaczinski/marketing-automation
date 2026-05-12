export type StatusGroup = "to_review" | "in_progress" | "ready" | "issues";

export const STATUS_TO_GROUP: Record<string, StatusGroup> = {
  proposed: "to_review",
  outline_review: "to_review",
  final_review: "to_review",
  approved: "in_progress",
  generating: "in_progress",
  drafting: "in_progress",
  schema_extending: "in_progress",
  validating: "in_progress",
  ready_to_publish: "ready",
  published: "ready",
  blocked_by_pagespeed: "issues",
  failed: "issues",
  rejected: "issues",
};

export const GROUP_ORDER: StatusGroup[] = ["to_review", "in_progress", "ready", "issues"];

export const STATUS_GROUP_COLORS: Record<StatusGroup, string> = {
  to_review: "#f2c037",
  in_progress: "#3f51b5",
  ready: "#21ba45",
  issues: "#c10015",
};

export function isInFlightStatus(status: string): boolean {
  return ["generating", "drafting", "schema_extending", "validating"].includes(status);
}

export function isCornerstone(article: { cornerstoneSpecId: string | null }): boolean {
  return article.cornerstoneSpecId !== null;
}
