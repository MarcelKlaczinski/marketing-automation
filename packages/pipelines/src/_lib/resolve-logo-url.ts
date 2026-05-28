/**
 * Spec 65.15 — Pipeline-side logo resolver for the brand-stamp watermark.
 *
 * Mirrors `apps/api/src/lib/brand-asset-service.ts:resolveLogoUrl` but lives
 * in `packages/pipelines/src/_lib/` so the social-image pipeline can call it
 * without violating the package-direction rule (pipelines must NOT import
 * from apps/api).
 *
 * Theme-variant resolution chain (Marcel-Decision Q2 — "wenn nur ein Variant
 * da ist, nutze ihn für beide Themes"):
 *   1. `<logoAssetKey>-<theme>` (e.g. `main-dark` for dark slides)
 *   2. `<logoAssetKey>` (single-variant base, e.g. `main`)
 *   3. `<logoAssetKey>-<oppositeTheme>` (e.g. `main-light` when only the
 *      opposite-theme variant is uploaded — graceful fallback)
 *
 * Returns `null` when no usable asset exists so the brand-stamp can
 * gracefully render nothing.
 *
 * Supported source types:
 *   - `r2`         → public R2 URL
 *   - `inline-svg` → `data:image/svg+xml;base64,…` data URL
 *
 * Skipped (returns null):
 *   - `wordmark` / `lobe-icons` — neither is appropriate as a corner watermark
 */
import {
  and,
  db,
  eq,
  projectBrandAssets,
  projects,
  type ProjectBrandAsset,
} from "@marketing-auto/db";
import { brandTokensSchema } from "@marketing-auto/shared/brand-tokens";

async function findLogoAsset(
  projectId: string,
  assetKey: string,
): Promise<ProjectBrandAsset | null> {
  const asset = await db.query.projectBrandAssets.findFirst({
    where: and(
      eq(projectBrandAssets.projectId, projectId),
      eq(projectBrandAssets.assetType, "logo"),
      eq(projectBrandAssets.assetKey, assetKey),
    ),
  });
  return asset ?? null;
}

export async function resolveLogoUrl(
  projectId: string,
  theme: "dark" | "light" = "dark",
): Promise<string | null> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { brandTokens: true },
  });
  if (!project) return null;

  const tokens = brandTokensSchema.parse(project.brandTokens ?? {});
  const logoKey = tokens.social?.logoAssetKey ?? "main";
  const oppositeTheme = theme === "dark" ? "light" : "dark";

  const asset =
    (await findLogoAsset(projectId, `${logoKey}-${theme}`)) ??
    (await findLogoAsset(projectId, logoKey)) ??
    (await findLogoAsset(projectId, `${logoKey}-${oppositeTheme}`));

  if (!asset) return null;

  if (asset.source === "r2" && asset.sourceRef) {
    // TODO(multi-tenant): the `pub.toolwiki.ai` custom-domain is hardcoded to
    // match the existing `resolveLogo` + `resolveToolIcon` convention. BK Solar
    // / Bellemann will need this routed via `R2_PUBLIC_BASE_URL`. Backlog item
    // per Spec 65.15 §15 Deviations (4).
    return `https://pub.toolwiki.ai/${asset.sourceRef}`;
  }
  if (asset.source === "inline-svg" && asset.inlineSvg) {
    const base64 = Buffer.from(asset.inlineSvg, "utf-8").toString("base64");
    return `data:image/svg+xml;base64,${base64}`;
  }

  return null;
}
