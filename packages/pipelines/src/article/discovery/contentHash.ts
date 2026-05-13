import { createHash } from "node:crypto";

export function computeContentHash(bodyMd: string | null, frontmatterExtras: unknown): string {
  return createHash("md5")
    .update(bodyMd ?? "")
    .update(JSON.stringify(frontmatterExtras ?? {}))
    .digest("hex");
}
