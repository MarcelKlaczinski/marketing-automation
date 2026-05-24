// Spec 64.19 follow-up — smoke-level surface test so the `bun test` runner
// finds at least one test file. Live behaviour is covered by signal-collector
// integration tests in apps/api that exercise `ProductHuntSignalSource.fetch`.

import { describe, expect, it } from "bun:test";
import { ProductHuntSignalSource } from "../src/index.ts";

describe("ProductHuntSignalSource — public surface", () => {
  it("exports the class with the expected discriminator", () => {
    const src = new ProductHuntSignalSource("test-key", "test-secret");
    expect(src.source).toBe("producthunt");
    expect(typeof src.fetch).toBe("function");
    expect(src.inputSchema).toBeDefined();
  });

  it("inputSchema applies defaults for topic + first", () => {
    const src = new ProductHuntSignalSource("k", "s");
    const parsed = src.inputSchema.parse({});
    expect(parsed.topic).toBe("artificial-intelligence");
    expect(parsed.first).toBe(20);
  });

  it("inputSchema rejects out-of-range first values", () => {
    const src = new ProductHuntSignalSource("k", "s");
    expect(() => src.inputSchema.parse({ first: 0 })).toThrow();
    expect(() => src.inputSchema.parse({ first: 51 })).toThrow();
  });
});
