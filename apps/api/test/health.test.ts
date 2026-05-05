import { describe, expect, it } from "bun:test";
import app from "../src/server.js";

describe("GET /health", () => {
  it("returns ok with version", async () => {
    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.1.0");
    expect(typeof body.uptimeSec).toBe("number");
  });
});
