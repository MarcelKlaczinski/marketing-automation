import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { getEnv } from "@marketing-auto/shared";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const env = getEnv();
  const key = Buffer.from(env.ENCRYPTION_KEY, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes`);
  }
  cachedKey = key;
  return cachedKey;
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns base64-encoded payload: [IV (12) | AuthTag (16) | Ciphertext]
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypts a base64 payload produced by encrypt().
 * Throws on invalid ciphertext, wrong key, or tampered data.
 */
export function decrypt(payload: string): string {
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted payload: too short");
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const key = getMasterKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptJson<T>(value: T): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T>(payload: string): T {
  // cast is safe: JSON.parse is intrinsically `unknown`; caller's generic asserts the expected shape
  return JSON.parse(decrypt(payload)) as T;
}

/** Test-only: drops the cached master key so a freshly-set ENCRYPTION_KEY is picked up. */
export function _resetKeyCache(): void {
  cachedKey = null;
}
