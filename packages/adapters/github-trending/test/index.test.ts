import { describe, it, expect, mock } from "bun:test";
import { GitHubSignalSource } from "../src/index.ts";
import newRisingFixture from "./fixtures/search-new-rising.json";
import activeEstablishedFixture from "./fixtures/search-active-established.json";
import emptyFixture from "./fixtures/search-empty.json";

const CTX = { projectId: "00000000-0000-0000-0000-000000000001" };

function baseInput() {
  return {
    topics: ["ai-tools", "llm"],
    timeWindowDays: 7,
    minStarsNew: 20,
    minStarsEstablished: 500,
    maxAgeDays: 9999, // don't age-filter in unit tests
    perQueryLimit: 30,
    credentials: { personalAccessToken: "ghp_test" },
  };
}

function makeFetch(newRisingRes: object, activeEstablishedRes: object) {
  let callCount = 0;
  globalThis.fetch = mock(() => {
    callCount++;
    const fixture = callCount === 1 ? newRisingRes : activeEstablishedRes;
    return Promise.resolve(
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

describe("GitHubSignalSource.fetch", () => {
  it("returns RawSignal[] from both queries", async () => {
    makeFetch(newRisingFixture, activeEstablishedFixture);

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    // new-rising: 2 unique, active-established: langchain (new) + acme/awesome-llm (dedup)
    // expected: acme/awesome-llm + beta/ai-agents-kit + langchain-ai/langchain = 3 unique
    expect(signals).toHaveLength(3);
  });

  it("deduplicates repos present in both queries", async () => {
    // acme/awesome-llm appears in both fixtures
    makeFetch(newRisingFixture, activeEstablishedFixture);

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    const ids = signals.map((s) => s.externalId);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it("filters archived repos", async () => {
    const withArchived = {
      ...newRisingFixture,
      items: [{ ...newRisingFixture.items[0], archived: true }, newRisingFixture.items[1]],
    };
    makeFetch(withArchived, emptyFixture);

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.externalId).toBe("gh_beta_ai-agents-kit");
  });

  it("continues when first query fails", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response("{}", { status: 401 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(activeEstablishedFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    // active-established fixture has 2 items
    expect(signals.length).toBeGreaterThan(0);
  });

  it("continues when second query fails", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve(new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(newRisingFixture), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch;

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    expect(signals).toHaveLength(2);
  });

  it("returns empty array when both queries return no results", async () => {
    makeFetch(emptyFixture, emptyFixture);

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    expect(signals).toHaveLength(0);
  });

  it("sets externalId as gh_owner_repo", async () => {
    makeFetch(newRisingFixture, emptyFixture);

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    expect(signals[0]?.externalId).toBe("gh_acme_awesome-llm");
  });

  it("sets source to 'github'", async () => {
    makeFetch(newRisingFixture, emptyFixture);

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    expect(signals.every((s) => s.source === "github")).toBe(true);
  });

  it("stores stars in metrics", async () => {
    makeFetch(newRisingFixture, emptyFixture);

    const source = new GitHubSignalSource();
    const signals = await source.fetch(baseInput(), CTX);

    expect(signals[0]?.metrics?.["stars"]).toBe(340);
  });
});
