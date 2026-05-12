/**
 * Generates a stable, system-controlled translation key for a cornerstone-pair.
 * Format: cluster-{shortClusterId}-{slugifiedKeyword}
 *
 * The shortClusterId is the first segment of the cluster UUID (8 hex chars), providing
 * project-scoped uniqueness. The keyword-slug provides human readability.
 *
 * Example:
 *   clusterId: "a1b2c3d4-e5f6-..."
 *   keyword: "KI-Bildgenerierung"
 *   → "cluster-a1b2c3d4-ki-bildgenerierung"
 */
export function generateTranslationKey(input: {
  clusterId: string;
  cornerstoneKeyword: string;
}): string {
  const shortId = input.clusterId.split("-")[0]!;
  const slug = slugifyKeyword(input.cornerstoneKeyword);
  return `cluster-${shortId}-${slug}`;
}

function slugifyKeyword(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
