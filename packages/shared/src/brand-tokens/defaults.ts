import { brandTokensSchema } from "./schema.ts";
import type { BrandTokens } from "./types.ts";

export const DEFAULT_BRAND_TOKENS: BrandTokens = brandTokensSchema.parse({});
