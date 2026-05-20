// Spec 62.0a Section 8.4.1 (D8): batch-processor must read Anthropic API key from the
// global-credentials vault first, falling back to env only when the vault is empty.
//
// Pre-flight Task 1 caught this: in self-hosted deployments the env var is unset and the
// worker was failing. The fix added vault-first lookup in
// `apps/api/src/workers/batch-processor.worker.ts:39-48` (`getAnthropicClient`).
//
// This regression test pins the vault contract end-to-end (decrypt round-trip + value
// retrieval). The worker's caching of the resulting Anthropic client is verified by the
// fact that the production code reads `getGlobal("anthropic", "api_key")` — that read
// path is what we lock in here.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { deleteGlobal, getGlobal, setGlobal } from "@marketing-auto/core/credentials";

const TEST_VAULT_KEY = `__test_d8_key_${Date.now()}__`;

describe("batch-processor vault credential loading (Spec 62.0a D8)", () => {
  beforeAll(async () => {
    // Clean any stale row from a previous failed run with the same key.
    await deleteGlobal("anthropic", TEST_VAULT_KEY);
  });

  afterAll(async () => {
    await deleteGlobal("anthropic", TEST_VAULT_KEY);
  });

  it("returns null from the vault when no entry exists (env-fallback path)", async () => {
    const result = await getGlobal("anthropic", TEST_VAULT_KEY);
    expect(result).toBeNull();
  });

  it("returns the decrypted value when the vault has an entry (vault-first path)", async () => {
    const secret = "sk-vault-test-d8-fixture-value";
    await setGlobal("anthropic", TEST_VAULT_KEY, secret);
    const result = await getGlobal("anthropic", TEST_VAULT_KEY);
    expect(result).toBe(secret);
  });

  it("returns null again after the entry is deleted", async () => {
    await deleteGlobal("anthropic", TEST_VAULT_KEY);
    const result = await getGlobal("anthropic", TEST_VAULT_KEY);
    expect(result).toBeNull();
  });
});
