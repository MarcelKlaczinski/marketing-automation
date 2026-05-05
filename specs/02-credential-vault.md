# Spec 02: Credential Vault

**Phase:** 1 (Foundation)
**Estimated Effort:** ½ day
**Dependencies:** Spec 00, Spec 01
**Status:** Ready for implementation

---

## Goal

Implement encrypted storage for per-tenant external API credentials (Google Analytics, Search Console, AdSense, Instagram Graph API, GitHub deploy keys, Astro deploy webhooks). Encryption uses AES-256-GCM with a master key from environment. Credentials are never logged in plaintext, never returned via API in plaintext, and only decrypted at the moment of API call.

## Non-Goals

- No credential rotation automation (manual via UI in Phase 2)
- No HSM/KMS integration (single-master-key for MVP, KMS pivot when SaaS)
- No OAuth flow implementation (that's per-service in Phase 2 adapter specs)
- No UI for credential management (Phase 2)

## User-Facing Behavior

After this spec:
- Backend can store a credential payload (any JSON object) for a project + service
- Backend can retrieve and decrypt the payload by project + service
- Backend can list services that have credentials for a project (no payload returned)
- Wrong/missing master key produces a clear startup error
- Tampered ciphertext throws an error on decryption

## Detailed Implementation

### Master Key Generation

Marcel generates the key once:
```bash
openssl rand -hex 32
# Copy output to .env as ENCRYPTION_KEY
```

Validation: in `packages/shared/config.ts` we already require `ENCRYPTION_KEY` to be exactly 64 hex chars (32 bytes). For Spec 02, change `.optional()` to required:

```typescript
ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i),
```

### Crypto Module

`packages/core/src/credentials/crypto.ts`:
```typescript
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { getEnv } from "@marketing-auto/shared";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;          // GCM standard
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const env = getEnv();
  cachedKey = Buffer.from(env.ENCRYPTION_KEY, "hex");
  if (cachedKey.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes`);
  }
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
  
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  
  // Layout: IV || AuthTag || Ciphertext
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypts a base64 payload produced by encrypt().
 * Throws on invalid ciphertext, wrong key, or tampered data.
 */
export function decrypt(payload: string): string {
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid encrypted payload: too short");
  }
  
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  
  const key = getMasterKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Encrypts a JSON-serializable value.
 */
export function encryptJson<T>(value: T): string {
  return encrypt(JSON.stringify(value));
}

/**
 * Decrypts and parses a JSON value.
 */
export function decryptJson<T>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

// Test helper
export function _resetKeyCache(): void {
  cachedKey = null;
}
```

### Credential Vault Service

`packages/core/src/credentials/vault.ts`:
```typescript
import { eq, and } from "drizzle-orm";
import { db, projectCredentials } from "@marketing-auto/db";
import { type Result, ok, err, tryAsync } from "@marketing-auto/shared";
import { encryptJson, decryptJson } from "./crypto.ts";
import type { CredentialService, CredentialPayload } from "./types.ts";

export class CredentialVault {
  /**
   * Stores or replaces credentials for a project + service.
   * The payload is encrypted before storage.
   */
  async store<S extends CredentialService>(input: {
    projectId: string;
    service: S;
    payload: CredentialPayload<S>;
    expiresAt?: Date;
  }): Promise<Result<{ id: string }>> {
    return tryAsync(async () => {
      const encryptedPayload = encryptJson(input.payload);
      
      const [row] = await db
        .insert(projectCredentials)
        .values({
          projectId: input.projectId,
          service: input.service,
          encryptedPayload,
          expiresAt: input.expiresAt,
        })
        .onConflictDoUpdate({
          target: [projectCredentials.projectId, projectCredentials.service],
          set: {
            encryptedPayload,
            expiresAt: input.expiresAt,
            updatedAt: new Date(),
          },
        })
        .returning({ id: projectCredentials.id });
      
      return { id: row!.id };
    });
  }
  
  /**
   * Retrieves and decrypts credentials for a project + service.
   * Returns err(NotFound) if not present.
   */
  async get<S extends CredentialService>(input: {
    projectId: string;
    service: S;
  }): Promise<Result<{ payload: CredentialPayload<S>; expiresAt: Date | null }, "NotFound" | Error>> {
    const rows = await db
      .select()
      .from(projectCredentials)
      .where(
        and(
          eq(projectCredentials.projectId, input.projectId),
          eq(projectCredentials.service, input.service),
        ),
      )
      .limit(1);
    
    const row = rows[0];
    if (!row) return err("NotFound");
    
    return tryAsync(async () => ({
      payload: decryptJson<CredentialPayload<S>>(row.encryptedPayload),
      expiresAt: row.expiresAt,
    }));
  }
  
  /**
   * Lists which services have credentials configured for a project.
   * Does NOT return any payload data.
   */
  async listServices(input: { projectId: string }): Promise<Array<{
    service: string;
    expiresAt: Date | null;
    updatedAt: Date;
  }>> {
    return db
      .select({
        service: projectCredentials.service,
        expiresAt: projectCredentials.expiresAt,
        updatedAt: projectCredentials.updatedAt,
      })
      .from(projectCredentials)
      .where(eq(projectCredentials.projectId, input.projectId));
  }
  
  /**
   * Deletes credentials for a project + service.
   */
  async delete(input: { projectId: string; service: CredentialService }): Promise<Result<void>> {
    return tryAsync(async () => {
      await db
        .delete(projectCredentials)
        .where(
          and(
            eq(projectCredentials.projectId, input.projectId),
            eq(projectCredentials.service, input.service),
          ),
        );
    });
  }
}

// Singleton for app use
export const credentialVault = new CredentialVault();
```

### Typed Credential Payloads

`packages/core/src/credentials/types.ts`:
```typescript
/**
 * Per-service credential payload shapes.
 * Each service has different requirements. These types are the source of truth.
 */

export type CredentialService =
  | "google_analytics"
  | "google_search_console"
  | "google_adsense"
  | "instagram_graph"
  | "github_deploy"
  | "astro_deploy_webhook";

export type GoogleServiceAccountPayload = {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;          // PEM-encoded
  client_email: string;
  client_id: string;
  // Other Google-specific fields are kept verbatim
  [key: string]: unknown;
};

export type GoogleAnalyticsCreds = {
  serviceAccount: GoogleServiceAccountPayload;
  propertyId: string;           // GA4 Property ID, e.g. "properties/123456789"
};

export type GoogleSearchConsoleCreds = {
  serviceAccount: GoogleServiceAccountPayload;
  siteUrl: string;              // e.g. "sc-domain:ki-wissensraum.de" or "https://ki-wissensraum.de/"
};

export type GoogleAdSenseCreds = {
  // AdSense uses OAuth2, not service accounts (limitation of AdSense API)
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  accountId: string;            // e.g. "pub-1234567890"
};

export type InstagramGraphCreds = {
  longLivedAccessToken: string;
  igUserId: string;             // Instagram Business Account ID
  pageId: string;               // associated Facebook Page
};

export type GithubDeployCreds = {
  // Personal Access Token or fine-grained token with repo:write
  token: string;
  repo: string;                 // "owner/repo"
  branch: string;               // default branch to push to
};

export type AstroDeployWebhookCreds = {
  webhookUrl: string;           // e.g. Cloudflare Pages or Netlify build hook
  secretHeader?: { name: string; value: string };
};

// Discriminated union
export type CredentialPayload<S extends CredentialService> =
  S extends "google_analytics" ? GoogleAnalyticsCreds :
  S extends "google_search_console" ? GoogleSearchConsoleCreds :
  S extends "google_adsense" ? GoogleAdSenseCreds :
  S extends "instagram_graph" ? InstagramGraphCreds :
  S extends "github_deploy" ? GithubDeployCreds :
  S extends "astro_deploy_webhook" ? AstroDeployWebhookCreds :
  never;
```

### Package Files

`packages/core/package.json` (new package):
```json
{
  "name": "@marketing-auto/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./credentials": "./src/credentials/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "@marketing-auto/db": "workspace:*",
    "drizzle-orm": "^0.36.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

`packages/core/src/credentials/index.ts`:
```typescript
export * from "./types.ts";
export { encrypt, decrypt, encryptJson, decryptJson } from "./crypto.ts";
export { CredentialVault, credentialVault } from "./vault.ts";
```

`packages/core/src/index.ts`:
```typescript
export * from "./credentials/index.ts";
```

`packages/core/CLAUDE.md`:
```markdown
# Core Package

Domain logic that's not specific to API/worker/UI layers.

## Modules
- `credentials/`     Encrypted vault for tenant API credentials (Spec 02)
- `cost-tracker/`    Cost logging + hard limits (Spec 03)
- (more added over time)

## Conventions
- All public APIs return `Result<T, E>` rather than throwing (use `@marketing-auto/shared/result`)
- All side-effecting functions are testable in isolation (no hidden globals)
- Sensitive data NEVER appears in logs, even at debug level

## Common Mistakes to Avoid
- DO NOT log credential payloads, even fragments
- DO NOT return decrypted credentials from public APIs/UIs — only used at moment of external call
- DO NOT pass credentials through HTTP responses except through dedicated, audited endpoints
```

## Acceptance Criteria

- [ ] Crypto round-trip works: `decrypt(encrypt(x)) === x` for arbitrary strings (incl. unicode, empty, very long)
- [ ] `decryptJson(encryptJson(obj))` deeply equals `obj` for various JSON shapes
- [ ] Tampered ciphertext (1 byte changed) throws on decrypt (GCM auth tag check)
- [ ] Wrong master key throws on decrypt of valid ciphertext
- [ ] Vault `store` then `get` round-trips a Google Service Account JSON
- [ ] Vault `store` upserts (second store with same project+service replaces, doesn't error)
- [ ] Vault `listServices` returns service names + metadata, no encrypted payload
- [ ] Vault `delete` removes the credential
- [ ] Missing credential returns `err("NotFound")`, not throws
- [ ] App fails to start with clear error if `ENCRYPTION_KEY` is missing or wrong length
- [ ] No credential payload appears in any log output (review with `bun run dev:api` + grep)

## Testing Strategy

`packages/core/test/credentials.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from "bun:test";
import { encrypt, decrypt, encryptJson, decryptJson, _resetKeyCache } from "../src/credentials/crypto.ts";
import { credentialVault } from "../src/credentials/vault.ts";
import { db, projects } from "@marketing-auto/db";

// Set a test key before importing — in real test setup, .env.test handles this
process.env.ENCRYPTION_KEY = "0".repeat(64);  // 32 zero bytes for deterministic test
_resetKeyCache();

describe("crypto round-trip", () => {
  it("encrypts and decrypts ASCII", () => {
    const x = "hello world";
    expect(decrypt(encrypt(x))).toBe(x);
  });
  
  it("encrypts and decrypts unicode", () => {
    const x = "Hallo Welt 🌍 Ä Ö Ü ß";
    expect(decrypt(encrypt(x))).toBe(x);
  });
  
  it("encrypts and decrypts JSON", () => {
    const obj = { foo: "bar", n: 42, nested: { a: [1, 2, 3] } };
    expect(decryptJson(encryptJson(obj))).toEqual(obj);
  });
  
  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });
  
  it("throws on tampered ciphertext", () => {
    const ct = encrypt("hello");
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;  // flip last byte
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });
});

describe("CredentialVault", () => {
  let projectId: string;
  
  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug: `test-vault-${Date.now()}`,
      name: "Vault Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    }).returning();
    projectId = p!.id;
  });
  
  it("stores and retrieves Google Analytics credentials", async () => {
    const creds = {
      serviceAccount: {
        type: "service_account" as const,
        project_id: "test",
        private_key_id: "key1",
        private_key: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----",
        client_email: "test@test.iam.gserviceaccount.com",
        client_id: "123",
      },
      propertyId: "properties/123456789",
    };
    
    const stored = await credentialVault.store({
      projectId,
      service: "google_analytics",
      payload: creds,
    });
    expect(stored.ok).toBe(true);
    
    const got = await credentialVault.get({ projectId, service: "google_analytics" });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.payload.propertyId).toBe("properties/123456789");
      expect(got.value.payload.serviceAccount.client_email).toBe("test@test.iam.gserviceaccount.com");
    }
  });
  
  it("upserts on second store", async () => {
    await credentialVault.store({
      projectId,
      service: "github_deploy",
      payload: { token: "tok1", repo: "a/b", branch: "main" },
    });
    await credentialVault.store({
      projectId,
      service: "github_deploy",
      payload: { token: "tok2", repo: "a/b", branch: "main" },
    });
    const got = await credentialVault.get({ projectId, service: "github_deploy" });
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value.payload.token).toBe("tok2");
  });
  
  it("lists services without exposing payloads", async () => {
    const list = await credentialVault.listServices({ projectId });
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) {
      expect(item).not.toHaveProperty("encryptedPayload");
      expect(item).not.toHaveProperty("payload");
    }
  });
  
  it("returns NotFound for missing credentials", async () => {
    const result = await credentialVault.get({ projectId, service: "instagram_graph" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NotFound");
  });
});
```

## Open Questions / Decisions Made

**Decision 1: AES-256-GCM, not libsodium/age.** GCM is built into Node/Bun crypto, no extra deps. Authenticated encryption (built-in tampering detection). Industry standard.

**Decision 2: Single master key, not per-tenant keys.** For MVP. KMS pivot at SaaS time. Risk acknowledged: if master key leaks, all credentials need re-encryption.

**Decision 3: Layout `[IV | AuthTag | Ciphertext]` base64.** Self-contained, no separate IV/tag columns needed. Simpler.

**Decision 4: `onConflictDoUpdate` for upsert behavior.** Simpler than separate update path, the unique constraint `(project_id, service)` makes this safe.

**Decision 5: Discriminated union for credential payloads.** Strong typing per service. Trade-off: every new service requires a TypeScript change. Acceptable since adding services is a deliberate decision.

**Decision 6: No expiration enforcement at vault level.** `expiresAt` is stored, but the consumer (e.g., adapter calling Google API) is responsible for refreshing OAuth tokens before expiration. Vault doesn't auto-refresh — out of scope.

## Implementation Order

1. Make `ENCRYPTION_KEY` required in `packages/shared/src/config.ts`
2. Generate test/dev key, add to `.env`
3. Create `packages/core/` skeleton (package.json, tsconfig, CLAUDE.md)
4. Implement `crypto.ts` + tests for round-trip and tamper detection
5. Implement `types.ts` (discriminated union)
6. Implement `vault.ts`
7. Wire up index.ts files
8. Run full test suite
9. Manual smoke test: insert via vault, verify in DB that `encrypted_payload` is opaque (not readable)
10. Commit: `feat(core): credential vault with AES-256-GCM (spec 02)`

## Splitting Plan

Single session, ~½ day. No splitting needed.

## Discovered During Implementation

(empty)

## Deviations

(empty)
