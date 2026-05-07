import { createHash, randomBytes } from "node:crypto";

/**
 * Generate a URL-safe random token of N bytes (returns ~4*N/3 base64url characters).
 * 32 bytes = 256 bits of entropy for magic links; 48 bytes for session tokens.
 */
export function generateToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * SHA-256 hash of a token. We store hashes in DB so a DB leak doesn't expose
 * live sessions or magic links — raw tokens only travel in email/cookie.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
