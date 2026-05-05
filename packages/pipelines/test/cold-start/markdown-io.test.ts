import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileExists, readMarkdownIfExists, writeMarkdownAtomic } from "../../src/cold-start/shared/markdown-io.ts";

const TEST_DIR = join(tmpdir(), `markdown-io-test-${process.pid}`);

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("fileExists", () => {
  it("returns false for a non-existent path", async () => {
    expect(await fileExists("/tmp/definitely-does-not-exist-999999.md")).toBe(false);
  });

  it("returns true for an existing file", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, "exists.md");
    await Bun.write(path, "hello");
    expect(await fileExists(path)).toBe(true);
  });
});

describe("readMarkdownIfExists", () => {
  it("returns null for a non-existent path", async () => {
    expect(await readMarkdownIfExists("/tmp/nope-999999.md")).toBeNull();
  });

  it("returns file content for an existing file", async () => {
    await mkdir(TEST_DIR, { recursive: true });
    const path = join(TEST_DIR, "content.md");
    await Bun.write(path, "# Hello\nWorld");
    const result = await readMarkdownIfExists(path);
    expect(result).toBe("# Hello\nWorld");
  });
});

describe("writeMarkdownAtomic", () => {
  it("writes content to disk and the file is readable afterward", async () => {
    const path = join(TEST_DIR, "output.md");
    await writeMarkdownAtomic(path, "# My Content\n\nSome text.");
    const result = await readFile(path, "utf-8");
    expect(result).toBe("# My Content\n\nSome text.");
  });

  it("creates parent directories if they do not exist", async () => {
    const path = join(TEST_DIR, "nested", "deep", "file.md");
    await writeMarkdownAtomic(path, "nested content");
    expect(await fileExists(path)).toBe(true);
  });

  it("overwrites an existing file", async () => {
    const path = join(TEST_DIR, "overwrite.md");
    await writeMarkdownAtomic(path, "original");
    await writeMarkdownAtomic(path, "updated");
    const result = await readFile(path, "utf-8");
    expect(result).toBe("updated");
  });

  it("leaves no .tmp file behind after a successful write", async () => {
    const path = join(TEST_DIR, "clean.md");
    await writeMarkdownAtomic(path, "content");
    expect(await fileExists(`${path}.tmp`)).toBe(false);
    expect(await fileExists(path)).toBe(true);
  });
});
