import { createHash } from "node:crypto";

export function computeContentHash(bodyMd: string | null, domainExtras: unknown): string {
  return createHash("md5")
    .update(bodyMd ?? "")
    .update(JSON.stringify(domainExtras ?? {}))
    .digest("hex");
}
