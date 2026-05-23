/**
 * Back-compat re-export. Canonical home since Spec multi-domain-evolution
 * S2.4 is `@marketing-auto/content-schema/domains/toolwiki`. Consumers can
 * migrate at their own pace; this re-export is droppable post-BK-launch.
 */
export {
  KiWissenCategorySchema,
  type KiWissenCategory,
  KiWissenLevelSchema,
  type KiWissenLevel,
  KiWissenExtrasSchema,
  type KiWissenExtras,
  kiWissenFrontmatterBounds,
  validateKiWissenExtras,
} from "@marketing-auto/content-schema/domains/toolwiki";
