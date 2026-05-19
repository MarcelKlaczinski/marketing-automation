import type { z } from "zod";
import type { brandTokensSchema } from "./schema.ts";

export type BrandTokens = z.infer<typeof brandTokensSchema>;
