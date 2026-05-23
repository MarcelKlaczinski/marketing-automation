/**
 * Single source of truth for the article collection → Astro folder mapping.
 *
 * Pre-Spec multi-domain-evolution S2.2 this map lived in 4 in-tree copies
 * (plus a reverse copy in apps/api) — the duplication was Pattern 107 of
 * the root CLAUDE.md ("each concern owns its constant"). That pattern is
 * now superseded for cross-package constants: shared shape, one home, all
 * other call sites import.
 *
 * The forward map is intentionally `as const` so callers receive a precise
 * literal-union type on both the key and value. For lookups against an
 * arbitrary string (e.g. the `articles.collection` text column), use
 * `astroFolderFor(collection)` which widens the key check + returns the
 * input unchanged when the collection has no folder rename (defensive
 * forward-compat for future tenant collections).
 *
 * S2.3 will move `ArticleCollectionType` (currently in `@marketing-auto/shared`)
 * into this package next to this map, completing the routing concern in
 * one module. Until then, keys stay in literal-union form so cross-package
 * structural compatibility holds.
 */

export const COLLECTION_ASTRO_NAME = {
  blog: "blog",
  comparison: "comparisons",
  "ki-wissen": "ki-wissen",
  tools: "tools",
  usecases: "usecases",
} as const;

export type CollectionKey = keyof typeof COLLECTION_ASTRO_NAME;
export type AstroFolder = (typeof COLLECTION_ASTRO_NAME)[CollectionKey];

/**
 * Reverse map: Astro folder name → collection key. Derived at module-load
 * time from `COLLECTION_ASTRO_NAME` so the two directions can never drift.
 */
export const ASTRO_FOLDER_TO_COLLECTION = Object.fromEntries(
  Object.entries(COLLECTION_ASTRO_NAME).map(([k, v]) => [v, k]),
) as Record<AstroFolder, CollectionKey>;

/**
 * Defensive lookup: returns the Astro folder name for a collection key,
 * or the input unchanged when the key is unknown. Use this in code paths
 * that receive a `string` (e.g. the `articles.collection` text column,
 * which is wider than the Drizzle `.$type<>()` cast it carries).
 */
export function astroFolderFor(collection: string): string {
  return (COLLECTION_ASTRO_NAME as Record<string, string>)[collection] ?? collection;
}

/**
 * Defensive reverse lookup: returns the collection key for an Astro folder
 * name, or `null` when the folder is unknown. Use this at HTTP boundaries
 * where the client sends a folder name and the server must validate before
 * routing into the enum-typed pipeline input.
 */
export function collectionForAstroFolder(folder: string): CollectionKey | null {
  return (ASTRO_FOLDER_TO_COLLECTION as Record<string, CollectionKey | undefined>)[folder] ?? null;
}
