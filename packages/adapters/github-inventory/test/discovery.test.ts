// Spec 64.20 follow-up A2 — discovery sources (search-API + awesome-lists).
// Offline tests via mocked fetch.

import { describe, expect, it, mock } from "bun:test";
import {
  discoverViaAwesomeLists,
  discoverViaSearch,
  parseGithubLinksFromMarkdown,
} from "../src/discovery/index.ts";
import repoFixture from "./fixtures/repo-anthropics-claude-code.json";

const CREDS = { personalAccessToken: "ghp_test" };

const stdHeaders = {
  "x-ratelimit-remaining": "4900",
  "x-ratelimit-limit": "5000",
  "x-ratelimit-reset": "1800000000",
  "Content-Type": "application/json",
};

function ok(body: unknown, headers = stdHeaders): Response {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function searchResponseOf(items: Array<Partial<typeof repoFixture>>): Response {
  return ok({
    total_count: items.length,
    incomplete_results: false,
    items: items.map((i) => ({ ...repoFixture, ...i })),
  });
}

// ─── search-api.ts ──────────────────────────────────────────────────────────

describe("discoverViaSearch", () => {
  it("returns candidates ranked by stars descending across queries", async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      // Each query returns a different repo so dedup doesn't kick in
      return Promise.resolve(
        searchResponseOf([
          {
            full_name: `tool-${calls}/repo`,
            name: `repo-${calls}`,
            stargazers_count: 1000 * calls,
            archived: false,
          },
        ]),
      );
    }) as unknown as typeof fetch;

    const result = await discoverViaSearch({
      credentials: CREDS,
      queries: ["topic:ai stars:>1000", "topic:llm stars:>1000"],
    });

    expect(result.candidates).toHaveLength(2);
    // Sorted by stars desc
    expect(result.candidates[0]?.starsCount).toBe(2000);
    expect(result.candidates[1]?.starsCount).toBe(1000);
    expect(result.candidates[0]?.discoverySource).toBe("github_search");
  });

  it("dedupes across queries; keeps highest-star version", async () => {
    let callIdx = 0;
    globalThis.fetch = mock(() => {
      callIdx += 1;
      // Same repo in both query results, different star counts
      return Promise.resolve(
        searchResponseOf([
          {
            full_name: "shared/repo",
            name: "repo",
            stargazers_count: callIdx === 1 ? 1000 : 5000,
            archived: false,
          },
        ]),
      );
    }) as unknown as typeof fetch;

    const result = await discoverViaSearch({
      credentials: CREDS,
      queries: ["q1", "q2"],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.starsCount).toBe(5000); // higher version wins
  });

  it("filters out archived repos + awesome-list-like names", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        searchResponseOf([
          { full_name: "good/tool-x", name: "tool-x", stargazers_count: 1000, archived: false },
          { full_name: "bad/awesome-stuff", name: "awesome-stuff", stargazers_count: 2000, archived: false },
          { full_name: "stale/repo", name: "repo", stargazers_count: 3000, archived: true },
          { full_name: "noise/learn-react", name: "learn-react", stargazers_count: 1500, archived: false },
        ]),
      ),
    ) as unknown as typeof fetch;

    const result = await discoverViaSearch({
      credentials: CREDS,
      queries: ["test"],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.sourceIdentifier).toBe("good/tool-x");
  });

  it("collects failed queries without throwing on per-query errors", async () => {
    // Track URL so q1 always succeeds + q2 always fails (the client's
    // retry loop calls fetch up to 4 times per query on 5xx; we want q2
    // to consistently fail so the loop exhausts + throws).
    globalThis.fetch = mock((url: string | URL | Request) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.includes("q2-broken")) {
        return Promise.resolve(new Response("nope", { status: 500 }));
      }
      return Promise.resolve(
        searchResponseOf([
          { full_name: "ok/repo", name: "repo", stargazers_count: 100, archived: false },
        ]),
      );
    }) as unknown as typeof fetch;

    const result = await discoverViaSearch({
      credentials: CREDS,
      queries: ["topic:ai", "q2-broken"],
    });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.failedQueries).toHaveLength(1);
    expect(result.failedQueries[0]?.query).toBe("q2-broken");
  });
});

// ─── awesome-list-parser.ts ─────────────────────────────────────────────────

describe("parseGithubLinksFromMarkdown", () => {
  it("extracts owner/repo from [name](https://github.com/owner/repo) links", () => {
    const md = `
# Awesome Skills

- [Web Design](https://github.com/anthropics/skills) — generates frontends
- [Diagrams](https://github.com/coleam00/excalidraw-diagram-skill) — Excalidraw

Some prose with [unrelated link](https://example.com) ignored.
`;
    const links = parseGithubLinksFromMarkdown(md);
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      sourceIdentifier: "anthropics/skills",
      displayName: "Web Design",
    });
    expect(links[1]?.sourceIdentifier).toBe("coleam00/excalidraw-diagram-skill");
  });

  it("dedupes when the same repo appears multiple times", () => {
    const md = `
- [First mention](https://github.com/foo/bar)
- [Second mention](https://github.com/foo/bar)
`;
    const links = parseGithubLinksFromMarkdown(md);
    expect(links).toHaveLength(1);
    expect(links[0]?.displayName).toBe("First mention");
  });

  it("filters out self-references (the awesome-list referencing itself)", () => {
    const md = `
- [The list itself](https://github.com/ComposioHQ/awesome-claude-skills)
- [A real skill](https://github.com/foo/bar)
`;
    const links = parseGithubLinksFromMarkdown(md);
    expect(links).toHaveLength(1);
    expect(links[0]?.sourceIdentifier).toBe("foo/bar");
  });

  it("strips emphasis markup from display text", () => {
    const md = `- [**Bold name**](https://github.com/foo/bar) — desc`;
    const links = parseGithubLinksFromMarkdown(md);
    expect(links[0]?.displayName).toBe("Bold name");
  });

  it("strips badge image markdown from display text", () => {
    const md = `- [![badge](https://shields.io/x) ToolName](https://github.com/foo/bar)`;
    const links = parseGithubLinksFromMarkdown(md);
    expect(links[0]?.displayName).toBe("ToolName");
  });

  it("ignores non-github + non-bare-repo links in markdown", () => {
    const md = `
- [Docs](https://example.com/x)
- [Repo](https://github.com/real/repo)
- [Issue](https://github.com/foo/bar/issues/1)
`;
    const links = parseGithubLinksFromMarkdown(md);
    // Only bare `owner/repo` URLs match; `/issues/1` has extra path segments
    // that the regex rejects (repo name doesn't include '/').
    expect(links.map((l) => l.sourceIdentifier)).toEqual(["real/repo"]);
  });
});

describe("discoverViaAwesomeLists", () => {
  function contentsResponse(body: string): Response {
    const b64 = Buffer.from(body, "utf-8").toString("base64");
    return ok({
      type: "file",
      name: "README.md",
      path: "README.md",
      content: b64,
      encoding: "base64",
      sha: "abc",
      size: body.length,
    });
  }

  it("fetches README.md per list + dedupes across lists", async () => {
    let fetchedPaths: string[] = [];
    globalThis.fetch = mock((url: string | URL | Request) => {
      const s = typeof url === "string" ? url : url.toString();
      fetchedPaths.push(s);
      if (s.includes("list-a")) {
        return Promise.resolve(
          contentsResponse(`- [tool-x](https://github.com/owner-a/tool-x)\n- [tool-y](https://github.com/owner-a/tool-y)`),
        );
      }
      if (s.includes("list-b")) {
        return Promise.resolve(
          contentsResponse(`- [tool-y](https://github.com/owner-a/tool-y)\n- [tool-z](https://github.com/owner-b/tool-z)`),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }) as unknown as typeof fetch;

    const result = await discoverViaAwesomeLists({
      credentials: CREDS,
      lists: ["maintainer-a/list-a", "maintainer-b/list-b"],
    });

    expect(fetchedPaths.some((p) => p.includes("/maintainer-a/list-a/contents/README.md"))).toBe(true);
    expect(fetchedPaths.some((p) => p.includes("/maintainer-b/list-b/contents/README.md"))).toBe(true);

    // tool-y appears in both → dedup to 1; total 3 unique
    expect(result.candidates).toHaveLength(3);
    const ids = result.candidates.map((c) => c.sourceIdentifier).sort();
    expect(ids).toEqual(["owner-a/tool-x", "owner-a/tool-y", "owner-b/tool-z"]);

    // Each candidate carries the discovery source + which list it came from
    const toolX = result.candidates.find((c) => c.sourceIdentifier === "owner-a/tool-x");
    expect(toolX?.discoverySource).toBe("awesome_list");
    expect(toolX?.awesomeListSource).toBe("maintainer-a/list-a");
  });

  it("records failed lists without throwing", async () => {
    globalThis.fetch = mock((url: string | URL | Request) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.includes("good")) {
        return Promise.resolve(
          contentsResponse(`- [tool](https://github.com/foo/bar)`),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }) as unknown as typeof fetch;

    const result = await discoverViaAwesomeLists({
      credentials: CREDS,
      lists: ["good/list", "missing/list"],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.failedLists).toHaveLength(1);
    expect(result.failedLists[0]?.list).toBe("missing/list");
  });
});
