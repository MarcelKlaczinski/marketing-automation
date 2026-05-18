import { describe, it, expect, mock } from "bun:test";
import { verifyGitHub } from "../src/verify.ts";

const CREDS = { personalAccessToken: "ghp_test" };

describe("verifyGitHub", () => {
  it("returns ok:true on 200", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ login: "testuser" }), { status: 200 }),
      ),
    ) as unknown as typeof fetch;

    const result = await verifyGitHub(CREDS);
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with error message on 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 401 })),
    ) as unknown as typeof fetch;

    const result = await verifyGitHub(CREDS);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid");
  });

  it("returns ok:false with status on non-200 non-401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 500 })),
    ) as unknown as typeof fetch;

    const result = await verifyGitHub(CREDS);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("500");
  });

  it("returns ok:false on network error", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Network error")),
    ) as unknown as typeof fetch;

    const result = await verifyGitHub(CREDS);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Network error");
  });
});
