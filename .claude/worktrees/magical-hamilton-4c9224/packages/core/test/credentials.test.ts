import { beforeAll, describe, expect, it } from "bun:test";
import { db, projectCredentials, projects } from "@marketing-auto/db";
import { resetEnvCache } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import {
  _resetKeyCache,
  decrypt,
  decryptJson,
  encrypt,
  encryptJson,
} from "../src/credentials/crypto.ts";
import { credentialVault } from "../src/credentials/vault.ts";

// Pin a deterministic test key. .env may also have one, but we override for predictability.
const TEST_KEY = "0".repeat(64);
process.env.ENCRYPTION_KEY = TEST_KEY;
resetEnvCache();
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

  it("encrypts and decrypts the empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("encrypts and decrypts a very long payload", () => {
    const x = "x".repeat(100_000);
    expect(decrypt(encrypt(x))).toBe(x);
  });

  it("encrypts and decrypts JSON", () => {
    const obj = { foo: "bar", n: 42, nested: { a: [1, 2, 3], b: null } };
    expect(decryptJson<typeof obj>(encryptJson(obj))).toEqual(obj);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", () => {
    const ct = encrypt("hello");
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("throws on payload shorter than IV+AuthTag", () => {
    expect(() => decrypt(Buffer.alloc(10).toString("base64"))).toThrow(/too short/);
  });

  it("throws when decrypting with the wrong master key", () => {
    const ciphertext = encrypt("secret");

    process.env.ENCRYPTION_KEY = "f".repeat(64);
    resetEnvCache();
    _resetKeyCache();

    try {
      expect(() => decrypt(ciphertext)).toThrow();
    } finally {
      process.env.ENCRYPTION_KEY = TEST_KEY;
      resetEnvCache();
      _resetKeyCache();
    }
  });
});

describe("CredentialVault", () => {
  let projectId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `test-vault-${Date.now()}`,
        name: "Vault Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
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
      expect(got.value.payload.serviceAccount.client_email).toBe(
        "test@test.iam.gserviceaccount.com"
      );
      expect(got.value.expiresAt).toBeNull();
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

  it("persists expiresAt and round-trips it", async () => {
    const expires = new Date(Date.now() + 3600_000);
    await credentialVault.store({
      projectId,
      service: "google_adsense",
      payload: {
        refreshToken: "1//rt",
        clientId: "cid",
        clientSecret: "cs",
        accountId: "pub-1",
      },
      expiresAt: expires,
    });

    const got = await credentialVault.get({ projectId, service: "google_adsense" });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.expiresAt?.getTime()).toBe(expires.getTime());
    }
  });

  it("lists services without exposing payloads", async () => {
    const list = await credentialVault.listServices({ projectId });
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) {
      expect(item).not.toHaveProperty("encryptedPayload");
      expect(item).not.toHaveProperty("payload");
      expect(typeof item.service).toBe("string");
    }
  });

  it("returns NotFound for missing credentials", async () => {
    const result = await credentialVault.get({ projectId, service: "instagram_graph" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NotFound");
  });

  it("delete removes the credential", async () => {
    await credentialVault.store({
      projectId,
      service: "astro_deploy_webhook",
      payload: { webhookUrl: "https://example.com/hook" },
    });

    const beforeDelete = await credentialVault.get({
      projectId,
      service: "astro_deploy_webhook",
    });
    expect(beforeDelete.ok).toBe(true);

    const del = await credentialVault.delete({
      projectId,
      service: "astro_deploy_webhook",
    });
    expect(del.ok).toBe(true);

    const afterDelete = await credentialVault.get({
      projectId,
      service: "astro_deploy_webhook",
    });
    expect(afterDelete.ok).toBe(false);
    if (!afterDelete.ok) expect(afterDelete.error).toBe("NotFound");
  });

  it("stores opaque ciphertext (no plaintext fragments visible in DB column)", async () => {
    const secret = "PLAINTEXT_MARKER_SHOULD_NOT_APPEAR_IN_DB";
    await credentialVault.store({
      projectId,
      service: "instagram_graph",
      payload: {
        longLivedAccessToken: secret,
        igUserId: "ig-1",
        pageId: "p-1",
      },
    });

    const [row] = await db
      .select({ encryptedPayload: projectCredentials.encryptedPayload })
      .from(projectCredentials)
      .where(
        and(
          eq(projectCredentials.projectId, projectId),
          eq(projectCredentials.service, "instagram_graph")
        )
      );

    expect(row).toBeDefined();
    expect(row!.encryptedPayload.length).toBeGreaterThan(0);
    expect(row!.encryptedPayload).not.toContain(secret);
  });
});
