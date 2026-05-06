import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import app from "../src/server.ts";
import { db, users, magicLinkTokens } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

describe("Magic Link Auth", () => {
  const testEmail = `test-${Date.now()}@example.com`;

  beforeEach(async () => {
    await db
      .insert(users)
      .values({ email: testEmail, name: "Test User", role: "owner" })
      .onConflictDoUpdate({ target: users.email, set: { name: "Test User" } });
  });

  afterAll(async () => {
    await db.delete(magicLinkTokens).where(eq(magicLinkTokens.email, testEmail));
    await db.delete(users).where(eq(users.email, testEmail));
  });

  it("login with valid email returns ok and creates a token", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    const tokens = await db
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.email, testEmail));
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0]!.tokenHash).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it("login with non-existent email returns ok but creates no token", async () => {
    const fakeEmail = `nonexistent-${Date.now()}@example.com`;
    const res = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fakeEmail }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    const tokens = await db
      .select()
      .from(magicLinkTokens)
      .where(eq(magicLinkTokens.email, fakeEmail));
    expect(tokens.length).toBe(0);
  });

  it("verify with invalid token redirects with error=invalid_link", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/verify?token=" + "x".repeat(48)),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=invalid_link");
  });

  it("/me without cookie returns 401", async () => {
    const res = await app.fetch(new Request("http://localhost/api/auth/me"));
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("logout without cookie still returns ok", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("login rejects invalid email format", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
