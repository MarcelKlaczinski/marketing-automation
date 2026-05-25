// Spec 64.20 — composer tests for fetchFullRepoMetadata + detectSkill.
import { describe, expect, it, mock } from "bun:test";
import { fetchFullRepoMetadata } from "../src/fetchers/repo-metadata.ts";
import {
  detectSkill,
  parseSkillFrontmatter,
  parseSourceIdentifier,
} from "../src/fetchers/skill-detector.ts";
import releaseFixture from "./fixtures/release-v1.json";
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

describe("fetchFullRepoMetadata", () => {
  it("composes repo + release into GithubInventoryMetadata", async () => {
    let calls = 0;
    globalThis.fetch = mock((url: string | URL | Request) => {
      calls += 1;
      const s = typeof url === "string" ? url : url.toString();
      if (s.endsWith("/repos/anthropics/claude-code")) return Promise.resolve(ok(repoFixture));
      if (s.endsWith("/releases/latest")) return Promise.resolve(ok(releaseFixture));
      throw new Error(`unexpected URL: ${s}`);
    }) as unknown as typeof fetch;

    const result = await fetchFullRepoMetadata("anthropics/claude-code", CREDS);
    expect(calls).toBe(2);
    expect(result.metadata.starsCount).toBe(25000);
    expect(result.metadata.forksCount).toBe(1234);
    expect(result.metadata.primaryLanguage).toBe("TypeScript");
    expect(result.metadata.license).toBe("MIT");
    expect(result.metadata.topics).toEqual(["ai", "cli", "claude"]);
    expect(result.metadata.defaultBranch).toBe("main");
    expect(result.metadata.latestRelease).not.toBeNull();
    expect(result.metadata.latestRelease?.tag).toBe("v1.0.0");
    expect(result.metadata.latestRelease?.name).toBe("First Release");
  });

  it("latestRelease is null when releases endpoint returns 404", async () => {
    globalThis.fetch = mock((url: string | URL | Request) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.endsWith("/releases/latest")) {
        return Promise.resolve(new Response("{}", { status: 404 }));
      }
      return Promise.resolve(ok(repoFixture));
    }) as unknown as typeof fetch;

    const result = await fetchFullRepoMetadata("anthropics/claude-code", CREDS);
    expect(result.metadata.latestRelease).toBeNull();
  });

  it("license defaults to 'no-license' when missing", async () => {
    const noLicenseRepo = { ...repoFixture, license: null };
    globalThis.fetch = mock((url: string | URL | Request) => {
      const s = typeof url === "string" ? url : url.toString();
      if (s.endsWith("/releases/latest"))
        return Promise.resolve(new Response("{}", { status: 404 }));
      return Promise.resolve(ok(noLicenseRepo));
    }) as unknown as typeof fetch;
    const result = await fetchFullRepoMetadata("nolicense/repo", CREDS);
    expect(result.metadata.license).toBe("no-license");
  });
});

describe("parseSourceIdentifier", () => {
  it("splits owner/repo with no subdir", () => {
    expect(parseSourceIdentifier("anthropics/claude-code")).toEqual({
      fullName: "anthropics/claude-code",
      subdir: null,
    });
  });

  it("splits owner/repo:subdir", () => {
    expect(parseSourceIdentifier("anthropics/skills:web-design")).toEqual({
      fullName: "anthropics/skills",
      subdir: "web-design",
    });
  });

  it("supports nested subdir", () => {
    expect(parseSourceIdentifier("vercel/repo:packages/foo")).toEqual({
      fullName: "vercel/repo",
      subdir: "packages/foo",
    });
  });

  it("treats trailing colon as no subdir", () => {
    expect(parseSourceIdentifier("a/b:")).toEqual({
      fullName: "a/b",
      subdir: null,
    });
  });
});

describe("parseSkillFrontmatter", () => {
  it("parses a minimal SKILL.md frontmatter", () => {
    const body = `---
name: web-design
description: Generates web UI mockups
---

# Web Design Skill

Body content here.`;
    const fm = parseSkillFrontmatter(body);
    expect(fm).toEqual({ name: "web-design", description: "Generates web UI mockups" });
  });

  it("strips quotes around values", () => {
    const body = `---
name: "quoted-name"
description: 'single-quoted'
category: development
---
content`;
    expect(parseSkillFrontmatter(body)).toEqual({
      name: "quoted-name",
      description: "single-quoted",
      category: "development",
    });
  });

  it("returns null when name or description missing", () => {
    expect(parseSkillFrontmatter(`---\ndescription: only desc\n---\nbody`)).toBeNull();
    expect(parseSkillFrontmatter(`---\nname: only-name\n---\nbody`)).toBeNull();
  });

  it("returns null when no frontmatter block present", () => {
    expect(parseSkillFrontmatter("# Just a heading\n\nNo frontmatter.")).toBeNull();
  });

  it("includes category and version when present", () => {
    const body = `---
name: my-skill
description: A skill
category: security
version: 1.2.0
---
body`;
    expect(parseSkillFrontmatter(body)).toEqual({
      name: "my-skill",
      description: "A skill",
      category: "security",
      version: "1.2.0",
    });
  });
});

describe("detectSkill", () => {
  function contentResponse(yamlBody: string): Response {
    const b64 = Buffer.from(yamlBody, "utf-8").toString("base64");
    return ok({
      type: "file",
      name: "SKILL.md",
      path: "SKILL.md",
      content: b64,
      encoding: "base64",
      sha: "abc123",
      size: yamlBody.length,
    });
  }

  it("fetches SKILL.md from repo root for standalone skill", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        contentResponse(`---\nname: stand-alone\ndescription: A skill\n---\nbody`),
      );
    }) as unknown as typeof fetch;
    const result = await detectSkill("coleam00/excalidraw-diagram-skill", CREDS);
    expect(capturedUrl).toContain("/repos/coleam00/excalidraw-diagram-skill/contents/SKILL.md");
    expect(result.frontmatter).toEqual({ name: "stand-alone", description: "A skill" });
  });

  it("fetches SKILL.md from subdir for mono-repo skill", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url: string | URL | Request) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return Promise.resolve(
        contentResponse(`---\nname: web-design\ndescription: UI mockups\n---\nbody`),
      );
    }) as unknown as typeof fetch;
    await detectSkill("anthropics/skills:web-design", CREDS);
    expect(capturedUrl).toContain("/repos/anthropics/skills/contents/web-design/SKILL.md");
  });

  it("returns frontmatter=null when SKILL.md not found (404)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 404 })),
    ) as unknown as typeof fetch;
    const result = await detectSkill("ghost/repo", CREDS);
    expect(result.frontmatter).toBeNull();
  });

  it("returns frontmatter=null when SKILL.md has no valid frontmatter", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(contentResponse("# Just a heading\n\nNo frontmatter.")),
    ) as unknown as typeof fetch;
    const result = await detectSkill("a/b", CREDS);
    expect(result.frontmatter).toBeNull();
  });
});
