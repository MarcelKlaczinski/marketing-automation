import { afterEach, describe, expect, it } from "bun:test";
import { r2 } from "../src/index.ts";

const live = process.env.RUN_LIVE_R2 === "1";
const describeLive = live ? describe : describe.skip;

describeLive("R2 storage (LIVE)", () => {
  const testKey = `test/spec-12-${Date.now()}.txt`;

  afterEach(async () => {
    try {
      await r2.delete(testKey);
    } catch {}
  });

  it("puts a string and reads it back via fetch", async () => {
    const result = await r2.put({
      key: testKey,
      body: "hello world",
      contentType: "text/plain",
    });
    expect(result.publicUrl).toMatch(/^https:\/\//);
    expect(result.bytesStored).toBe(11);

    const resp = await fetch(result.publicUrl);
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toBe("hello world");
  });

  it("exists returns true after put, false after delete", async () => {
    await r2.put({ key: testKey, body: "x" });
    expect(await r2.exists(testKey)).toBe(true);
    await r2.delete(testKey);
    expect(await r2.exists(testKey)).toBe(false);
  });

  it("presignedUrl returns a signed URL", async () => {
    const url = await r2.presign({ key: testKey, method: "GET" });
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("X-Amz-Signature");
  });
});
