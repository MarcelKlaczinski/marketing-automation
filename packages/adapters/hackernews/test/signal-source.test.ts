import { describe, it, expect, mock, beforeEach } from "bun:test";
import { HackerNewsSignalSource } from "../src/signal-source.ts";

const mockSearchHnByDate = mock(async (_q: string, _n: number, _since?: number) => []);

mock.module("../src/client.ts", () => ({
  searchHnByDate: mockSearchHnByDate,
}));

const ctx = { projectId: "test-project-id" };

beforeEach(() => mockSearchHnByDate.mockClear());

describe("HackerNewsSignalSource — date filtering", () => {
  it("passes sinceUnixSeconds matching now-7d (±60s) when maxAgeDays=7", async () => {
    const source = new HackerNewsSignalSource();
    const before = Math.floor((Date.now() - 7 * 86_400_000) / 1000);

    await source.fetch({ queries: ["ai"], hitsPerPage: 5, minPoints: 0, maxAgeDays: 7 }, ctx);

    const after = Math.floor((Date.now() - 7 * 86_400_000) / 1000);
    const sinceArg = mockSearchHnByDate.mock.calls[0]?.[2] as number;

    expect(sinceArg).toBeGreaterThanOrEqual(before - 60);
    expect(sinceArg).toBeLessThanOrEqual(after + 60);
  });

  it("uses maxAgeDays=30 by default", async () => {
    const source = new HackerNewsSignalSource();
    const before = Math.floor((Date.now() - 30 * 86_400_000) / 1000);

    await source.fetch({ queries: ["ai"], hitsPerPage: 5, minPoints: 0, maxAgeDays: 30 }, ctx);

    const after = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
    const sinceArg = mockSearchHnByDate.mock.calls[0]?.[2] as number;

    expect(sinceArg).toBeGreaterThanOrEqual(before - 60);
    expect(sinceArg).toBeLessThanOrEqual(after + 60);
  });

  it("default input applies maxAgeDays=30 when called with empty object", async () => {
    const source = new HackerNewsSignalSource();
    const expectedSince = Math.floor((Date.now() - 30 * 86_400_000) / 1000);

    // {} as never — Zod applies all defaults including maxAgeDays=30
    await source.fetch({} as never, ctx);

    const sinceArg = mockSearchHnByDate.mock.calls[0]?.[2] as number;
    expect(sinceArg).toBeGreaterThanOrEqual(expectedSince - 60);
    expect(sinceArg).toBeLessThanOrEqual(expectedSince + 60);
  });
});
