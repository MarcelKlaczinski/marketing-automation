export { RepoImportPipeline } from "./pipeline.ts";
export { enqueueRepoImport } from "./trigger.ts";
export { SyncClustersFromFrontmatterStep } from "./steps/sync-clusters-from-frontmatter.ts";
export { DetectContentGapsStep } from "./steps/detect-content-gaps.ts";
// Spec 000 — Hero-Image-Mirror. The pure helper + types are re-exported here
// so the backfill CLI (apps/api/src/scripts/backfill-imported-heroes.ts) can
// drive the same per-article logic offline with DI ports.
export {
  COLLECTIONS_WITHOUT_HERO,
  DEFAULT_HERO_PATH,
  MirrorHeroImagesStep,
  mirrorOneArticle,
  repoPathForHeroRef,
  type HeroFields,
  type MirrorDeps,
  type MirrorStats,
  type ParsedEntry,
  type ParsedEntryWithMirror,
} from "./steps/mirror-hero-images.ts";
