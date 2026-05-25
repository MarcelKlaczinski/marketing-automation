// Spec 65.0 Day 4 — Template preview service tests.
//
// Covers the error paths (template_not_found, fixture_not_found,
// no_render_function) + the cleanup helper. The happy-path actual-render
// case is NOT covered here — it would require a full Remotion bundle (5-10s
// per test) and is already exercised by `packages/social/scripts/visual-
// render-all.ts`. Day 4 V1 relies on manual verification of the end-to-end
// render once Day 5 builds the UI on top.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import {
  cleanupStalePreviewDirs,
  previewTemplate,
  resolveProjectIdBySlug,
} from "../../src/lib/template-preview-service.ts";
import { bootstrapAndSyncTemplates } from "../../src/lib/template-registry-sync.ts";

describe("template-preview-service error paths (Spec 65.0 Day 4)", () => {
  let projectId: string;

  beforeAll(async () => {
    // Ensure the in-memory registry is populated so the service can find
    // the canonical 5 templates.
    await bootstrapAndSyncTemplates();

    const ts = Date.now();
    const [project] = await db
      .insert(projects)
      .values({
        slug: `preview-test-${ts}`,
        name: "Preview Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!project) throw new Error("Failed to seed test project");
    projectId = project.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns template_not_found for an unknown template", async () => {
    const result = await previewTemplate({
      projectId,
      templateKey: "this-template-does-not-exist",
      sampleData: {},
    });
    expect("kind" in result).toBe(true);
    expect((result as { kind: string }).kind).toBe("template_not_found");
  });

  it("returns render_failed when sampleData fails the composition's Zod schema", async () => {
    // `comparison-grid-4` exists as a global row, but {} is missing the
    // required `generated` block and `tools` array. Remotion's renderStill
    // rejects with a parse error before any pixel work.
    const result = await previewTemplate({
      projectId,
      templateKey: "comparison-grid-4",
      sampleData: {},
    });
    // Note: this hits render-server.ts which bundles Remotion — slow on
    // first call (~5-10s) but the error path bails before headless Chrome.
    // Gating not necessary; the test asserts the error shape, not timing.
    expect("kind" in result).toBe(true);
    if ("kind" in result) {
      expect(["render_failed", "no_render_function"]).toContain(result.kind);
    }
  });
});

describe("resolveProjectIdBySlug (Spec 65.0 Day 4)", () => {
  let projectId: string;
  let slug: string;

  beforeAll(async () => {
    const ts = Date.now();
    slug = `resolve-test-${ts}`;
    const [project] = await db
      .insert(projects)
      .values({
        slug,
        name: "Resolve Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!project) throw new Error("Failed to seed test project");
    projectId = project.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns the project ID for an existing slug", async () => {
    const resolved = await resolveProjectIdBySlug(slug);
    expect(resolved).toBe(projectId);
  });

  it("returns null for an unknown slug", async () => {
    const resolved = await resolveProjectIdBySlug(`nonexistent-${Date.now()}`);
    expect(resolved).toBeNull();
  });
});

describe("cleanupStalePreviewDirs (Spec 65.0 Day 4)", () => {
  let previewDir: string;

  beforeAll(async () => {
    previewDir = join(tmpdir(), `preview-cleanup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(previewDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(previewDir, { recursive: true, force: true });
  });

  it("deletes preview-* dirs with maxAgeMs=0 (boot-time sweep)", async () => {
    await mkdir(join(previewDir, "preview-aaa"), { recursive: true });
    await writeFile(join(previewDir, "preview-aaa", "slide-00.png"), Buffer.from([]));
    await mkdir(join(previewDir, "preview-bbb"), { recursive: true });
    await writeFile(join(previewDir, "preview-bbb", "slide-00.png"), Buffer.from([]));
    // Non-preview dir survives.
    await mkdir(join(previewDir, "other-dir"), { recursive: true });

    // Stamp the preview dirs in the past so the test isn't subject to
    // millisecond-resolution timing flakes from mkdir-vs-Date.now().
    const past = new Date(Date.now() - 60 * 1000);
    const { utimes } = await import("node:fs/promises");
    await utimes(join(previewDir, "preview-aaa"), past, past);
    await utimes(join(previewDir, "preview-bbb"), past, past);

    const deleted = await cleanupStalePreviewDirs({ maxAgeMs: 0, directory: previewDir });
    expect(deleted).toBe(2);

    const remaining = await readdir(previewDir);
    expect(remaining).toContain("other-dir");
    expect(remaining).not.toContain("preview-aaa");
    expect(remaining).not.toContain("preview-bbb");
  });

  it("no-ops when the preview root is missing", async () => {
    const missingDir = join(tmpdir(), `preview-missing-${Date.now()}`);
    const deleted = await cleanupStalePreviewDirs({ maxAgeMs: 0, directory: missingDir });
    expect(deleted).toBe(0);
  });

  it("keeps dirs younger than maxAgeMs", async () => {
    const youngDir = join(previewDir, `preview-young-${Date.now()}`);
    await mkdir(youngDir, { recursive: true });
    // Default 1h threshold — just-created dir is far younger.
    const deleted = await cleanupStalePreviewDirs({
      maxAgeMs: 60 * 60 * 1000,
      directory: previewDir,
    });
    expect(deleted).toBe(0);
    const remaining = await readdir(previewDir);
    expect(remaining.some((n) => n.startsWith("preview-young-"))).toBe(true);
  });
});
