export type DivergenceState = "in_sync" | "this_newer" | "sibling_newer" | "both_diverged";

export function detectDivergence(
  thisLastEdited: Date | null,
  thisLastSync: Date | null,
  siblingLastEdited: Date | null,
  siblingLastSync: Date | null,
): DivergenceState {
  const thisDiverged =
    thisLastEdited !== null && (thisLastSync === null || thisLastEdited > thisLastSync);
  const siblingDiverged =
    siblingLastEdited !== null && (siblingLastSync === null || siblingLastEdited > siblingLastSync);

  if (thisDiverged && siblingDiverged) return "both_diverged";
  if (thisDiverged) return "this_newer";
  if (siblingDiverged) return "sibling_newer";
  return "in_sync";
}
