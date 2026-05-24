// Spec 64.19 follow-up — smoke-level surface test so the `bun test` runner
// finds at least one test file. Live API behaviour is covered indirectly via
// pipeline integration tests that consume `voyage.embed`/`voyage.embedBatch`.

import { describe, expect, it } from "bun:test";
import { voyage, embed, embedBatch, VoyageError } from "../src/index.ts";

describe("voyage adapter — public surface", () => {
  it("exports the namespaced `voyage` object with embed + embedBatch", () => {
    expect(typeof voyage).toBe("object");
    expect(typeof voyage.embed).toBe("function");
    expect(typeof voyage.embedBatch).toBe("function");
  });

  it("exports named `embed` + `embedBatch` functions identical to namespace properties", () => {
    expect(voyage.embed).toBe(embed);
    expect(voyage.embedBatch).toBe(embedBatch);
  });

  it("exports VoyageError class", () => {
    const e = new VoyageError("test");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("test");
  });

  it("embedBatch rejects > 128 texts before any network call", async () => {
    const too_many = Array.from({ length: 129 }, () => "x");
    await expect(
      voyage.embedBatch(too_many, {
        projectId: "00000000-0000-0000-0000-000000000000",
        operation: "test",
      }),
    ).rejects.toThrow(/too many texts/);
  });

  it("embedBatch on empty array returns [] without any network call", async () => {
    const result = await voyage.embedBatch([], {
      projectId: "00000000-0000-0000-0000-000000000000",
      operation: "test",
    });
    expect(result).toEqual([]);
  });
});
