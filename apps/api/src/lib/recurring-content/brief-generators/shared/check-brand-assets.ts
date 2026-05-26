/**
 * Spec 65.5 — Pre-flight brand-asset gate for recurring brief-generators.
 *
 * Marcel-Decision: skip the whole brief when ≥1 selected tool has no logo.
 * Returning a 4-tool comparison with a hand-drawn placeholder for a missing
 * logo is worse than skipping a run — the recurring rhythm tolerates a
 * missing tick, the brand quality does not. The worker logs + notifies admin
 * (Memory D21 batched notification pattern) and waits for the next tick.
 */
import { listToolsWithBrandAssets } from "@marketing-auto/db";

export class BrandAssetsMissingError extends Error {
  readonly missingToolIds: string[];

  constructor(opts: { missingToolIds: string[]; message?: string }) {
    super(opts.message ?? `Brand assets missing for ${opts.missingToolIds.length} tool(s)`);
    this.name = "BrandAssetsMissingError";
    this.missingToolIds = opts.missingToolIds;
  }
}

/**
 * Throws `BrandAssetsMissingError` when any of `toolIds` lacks a logo.
 * Brief-generators wrap this in a try/catch and map to
 * `{ status: "skipped", reason: "brand-assets-missing" }`.
 */
export async function ensureBrandAssetsAvailable(input: {
  toolIds: string[];
}): Promise<void> {
  if (input.toolIds.length === 0) return;
  const { toolsMissing } = await listToolsWithBrandAssets({ toolIds: input.toolIds });
  if (toolsMissing.length > 0) {
    throw new BrandAssetsMissingError({ missingToolIds: toolsMissing });
  }
}
