// Spec 65.0 Day 3 — Watcher + Redis pub/sub integration tests.
//
// Covers the per-file sync hot-path (`syncOneTemplateFromFile`) using a
// temp .ts fixture. The chokidar event loop itself is left untested at
// V1 — its add/change/unlink delegations are thin glue.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  db,
  eq,
  isNull,
  templates,
  and,
} from "@marketing-auto/db";
import { templateRegistry } from "@marketing-auto/social/templates";
import {
  cacheCopyPathFor,
  cleanupStaleCacheCopies,
  syncOneTemplateFromFile,
} from "../../src/lib/template-registry-sync.ts";

const TEST_KEY = "test-spec-65-day3-watcher";

function templateModuleSource(opts: { displayName: string }): string {
  const display = opts.displayName.replace(/"/g, '\\"');
  return `
export const testWatcherTemplate = {
  key: "${TEST_KEY}",
  displayName: "${display}",
  description: "Spec 65.0 Day 3 test fixture",
  defaultSlideCount: 1,
  estimatedCostUsd: 0.001,
  outputFormat: "carousel",
  compatibleChannels: ["instagram"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "comparison",
    estimatedEngagementTier: "low",
    recycleableFromExistingArticle: false,
    requiresLiveData: false,
  },
  eligibility: () => ({ eligible: true }),
  generateContent: async () => ({
    hookOutput: { headline: "x", pattern: "negative_frame", explanation: "x" },
    caption: "",
    hashtags: [],
  }),
  buildInput: async () => ({}),
  render: async () => ({
    slides: [],
    caption: "",
    hashtags: [],
    metadata: { estimatedCostUsd: 0, templateKey: "${TEST_KEY}" },
  }),
  mockFixtures: {},
};
`.trim();
}

describe("syncOneTemplateFromFile (Spec 65.0 Day 3)", () => {
  let tempDir: string;
  let tempFile: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "spec-65-day3-"));
    tempFile = join(tempDir, "watcherTestTemplate.ts");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
    // Best-effort cleanup of any DB rows the test created.
    await db
      .delete(templates)
      .where(and(isNull(templates.projectId), eq(templates.templateKey, TEST_KEY)));
    // Remove the synthetic registry entry so unrelated tests don't see it
    // (the entry's filePath points at a tmpdir copy that's already gone).
    templateRegistry.unregister(TEST_KEY);
  });

  it("inserts a fresh global row on first sync from a temp definition file", async () => {
    await writeFile(tempFile, templateModuleSource({ displayName: "Watcher Test v1" }));
    const result = await syncOneTemplateFromFile({
      filePath: tempFile,
      projectId: null,
      publish: false,
    });
    expect(result.status).toBe("added");
    expect(result.template.key as string).toBe(TEST_KEY);
    expect(result.template.displayName).toBe("Watcher Test v1");
    expect(result.spec.fileHash.startsWith("hash:")).toBe(true);

    const [row] = await db
      .select()
      .from(templates)
      .where(and(isNull(templates.projectId), eq(templates.templateKey, TEST_KEY)))
      .limit(1);
    expect(row).toBeDefined();
    expect(row?.displayName).toBe("Watcher Test v1");
  });

  it("dynamically re-imports the updated file and reports status=updated", async () => {
    await writeFile(tempFile, templateModuleSource({ displayName: "Watcher Test v2" }));
    const result = await syncOneTemplateFromFile({
      filePath: tempFile,
      projectId: null,
      publish: false,
    });
    expect(result.status).toBe("updated");
    expect(result.template.displayName).toBe("Watcher Test v2");
    // Registry's in-memory entry was replaced.
    const registryEntry = templateRegistry
      .list()
      .find((t) => (t.key as string) === TEST_KEY);
    expect(registryEntry?.displayName).toBe("Watcher Test v2");
  });

  it("returns status=unchanged on idempotent re-sync of identical content", async () => {
    // Same content as v2 above — no edits between calls.
    const result = await syncOneTemplateFromFile({
      filePath: tempFile,
      projectId: null,
      publish: false,
    });
    expect(result.status).toBe("unchanged");
  });

  it("throws when the file has no TemplateDefinition-shaped export", async () => {
    const badFile = join(tempDir, "noExport.ts");
    await writeFile(badFile, `export const something = { foo: "bar" };`);
    await expect(
      syncOneTemplateFromFile({ filePath: badFile, projectId: null, publish: false }),
    ).rejects.toThrow(/no exported TemplateDefinition shape/);
  });
});

describe("cacheCopyPathFor", () => {
  it("emits a dot-prefixed sibling path with hash short-prefix", () => {
    const result = cacheCopyPathFor(
      "/abs/path/templates/definitions/comparisonGrid4.ts",
      "hash:abcdef0123456789cafebabe1234deadbeef",
    );
    expect(result).toBe(
      "/abs/path/templates/definitions/.comparisonGrid4.abcdef0123456789.ts",
    );
  });

  it("works without the hash: prefix too", () => {
    const result = cacheCopyPathFor(
      "/abs/x/y.ts",
      "1234567890abcdef" + "deadbeef".repeat(4),
    );
    expect(result).toBe("/abs/x/.y.1234567890abcdef.ts");
  });
});

describe("cleanupStaleCacheCopies", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cache-copies-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("deletes dot-prefixed cache files but leaves real templates alone", async () => {
    await writeFile(join(dir, ".fake.abcdef0123456789.ts"), "export const x = 1;");
    await writeFile(join(dir, ".other.fedcba9876543210.ts"), "export const x = 2;");
    await writeFile(join(dir, "realTemplate.ts"), "export const real = 1;");

    // Stamp the dotfiles 60 seconds in the past so the `mtime <= cutoff`
    // check doesn't flake on millisecond timing under the full test suite
    // (passes in isolation; intermittent under concurrent load).
    const past = new Date(Date.now() - 60 * 1000);
    await utimes(join(dir, ".fake.abcdef0123456789.ts"), past, past);
    await utimes(join(dir, ".other.fedcba9876543210.ts"), past, past);

    const deleted = await cleanupStaleCacheCopies({ directory: dir, maxAgeMs: 0 });
    expect(deleted).toBe(2);

    const remaining = (await readdir(dir)).sort();
    expect(remaining).toEqual(["realTemplate.ts"]);
  });

  it("keeps files newer than maxAgeMs", async () => {
    const youngFile = join(dir, ".young.1111222233334444.ts");
    await writeFile(youngFile, "export const young = 1;");
    // Stamp 10 minutes in the past — still newer than a 1h threshold.
    const past = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(youngFile, past, past);

    const deleted = await cleanupStaleCacheCopies({
      directory: dir,
      maxAgeMs: 60 * 60 * 1000,
    });
    expect(deleted).toBe(0);
    const remaining = (await readdir(dir)).sort();
    expect(remaining).toContain(".young.1111222233334444.ts");
  });
});
