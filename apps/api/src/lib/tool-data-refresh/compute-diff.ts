/**
 * Spec 65.3 Part B — pure diff computation between the prior snapshot and
 * the LLM-extracted current snapshot. Returns a structured changeset the
 * worker can act on.
 *
 * The diff intentionally does NOT overwrite live `articles.tool_pricing` /
 * `tool_price_from` columns — those are Marcel-owned (imported from Astro
 * frontmatter). Instead, the worker writes the extract under
 * `domainExtras.toolDataRefresh` so Marcel can review + promote it via a
 * future workflow.
 *
 * Material change drives two side-effects in the worker:
 *   1. Persona-score invalidation for the tool.
 *   2. Inclusion in the batched admin notification.
 */
import { createHash } from "node:crypto";
import type { ToolDataExtract } from "./extract-tool-data.ts";

/**
 * Stable hashes for the pricing / feature shapes — used as the "fingerprint"
 * stored in tool_data_refresh_metadata so the NEXT tick can short-circuit if
 * nothing changed at the structural level (purely cosmetic refresh).
 */
export function pricingFingerprint(extract: ToolDataExtract): string {
  const canonical = {
    hasFreeTier: extract.pricing.hasFreeTier,
    cheapestPaidEur: extract.pricing.cheapestPaidEur,
    paidTierNames: [...extract.pricing.paidTierNames].sort(),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 16);
}

export function featureFingerprint(extract: ToolDataExtract): string {
  const canonical = {
    apiAccess: extract.features.apiAccess,
    selfHosted: extract.features.selfHosted,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 16);
}

export interface ToolDataDiff {
  /** True when the LLM-judged material flag is set (drives persona invalidation + notification). */
  materialChange: boolean;
  /** Short one-liner for the admin notification ("Pricing-tier 'Pro' added at €29"). */
  summary: string | null;
  /** True when pricing fingerprint differs from prior tick (structural change, may still be non-material). */
  pricingChanged: boolean;
  /** True when feature fingerprint differs from prior tick. */
  featuresChanged: boolean;
  /** New fingerprints to persist for the next tick's short-circuit check. */
  newPricingFingerprint: string;
  newFeatureFingerprint: string;
}

export interface ComputeDiffInput {
  extract: ToolDataExtract;
  /** Prior fingerprints from the previous refresh tick. Null on first refresh. */
  priorPricingFingerprint: string | null;
  priorFeatureFingerprint: string | null;
}

/**
 * Pure helper — no DB, no I/O. Returns the diff descriptor.
 *
 * The "material" flag is canonical from the LLM judgment. Pricing/feature
 * change booleans are informational (drive observability) — the worker
 * stores them in the audit metadata regardless of material status.
 */
export function computeToolDataDiff(input: ComputeDiffInput): ToolDataDiff {
  const newPricingFp = pricingFingerprint(input.extract);
  const newFeatureFp = featureFingerprint(input.extract);

  return {
    materialChange: input.extract.materialChangeJudgment.isMaterial,
    summary: input.extract.materialChangeJudgment.summary,
    pricingChanged: input.priorPricingFingerprint !== newPricingFp,
    featuresChanged: input.priorFeatureFingerprint !== newFeatureFp,
    newPricingFingerprint: newPricingFp,
    newFeatureFingerprint: newFeatureFp,
  };
}
