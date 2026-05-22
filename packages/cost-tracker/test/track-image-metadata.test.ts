import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { costLogs, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { track } from "../src/index.ts";

/**
 * Spec 64.6d: cost_logs.metadata extension for image-generation audit trail.
 *
 * The nano-banana + replicate adapter metadata callbacks pass `prompt`,
 * `resolution`, `aspectRatio` through track() so future quality audits can
 * reconstruct exactly what was sent to the provider without re-deriving from
 * pipeline output. These tests verify the spread behaviour of track() — the
 * callback's return value lands intact in cost_logs.metadata alongside the
 * baseline fields (durationMs, estimatedCostEur).
 */
describe("track() image-metadata enrichment (Spec 64.6d)", () => {
  let projectId: string;

  beforeEach(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        slug: `image-meta-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: "Image Metadata Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        // No cost limits → no quota checks, simplifies the test setup.
      })
      .returning();
    projectId = p!.id;
  });

  afterEach(async () => {
    if (projectId) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });

  it("persists prompt + resolution + aspectRatio in cost_logs.metadata", async () => {
    const augmentedPrompt =
      "Editorial flatlay of a vintage compass on cream linen.\n\nFormat: 16:9 widescreen aspect ratio, standard editorial quality.";

    await track({
      projectId,
      service: "google-gemini",
      operation: "hero-image-generation",
      estimatedCostEur: 0.07,
      fn: async () => ({ ok: true }),
      computeCostEur: () => 0.062,
      metadata: () => ({
        model: "nano-banana-2",
        prompt: augmentedPrompt,
        resolution: "1k",
        aspectRatio: "16:9",
      }),
    });

    const [log] = await db
      .select()
      .from(costLogs)
      .where(eq(costLogs.projectId, projectId));

    expect(log).toBeDefined();
    const meta = log!.metadata as Record<string, unknown>;
    expect(meta.prompt).toBe(augmentedPrompt);
    expect(meta.resolution).toBe("1k");
    expect(meta.aspectRatio).toBe("16:9");
    expect(meta.model).toBe("nano-banana-2");
    // Baseline fields still present alongside the new image-specific ones.
    expect(meta).toHaveProperty("durationMs");
    expect(meta).toHaveProperty("estimatedCostEur", 0.07);
  });

  it("accepts long prompts (800+ chars) without truncation", async () => {
    // Production prompts after augmentation regularly land at 300-500 chars.
    // 800 chars is a comfortable upper bound — JSONB has no practical size limit
    // at our cardinality (~50 articles/month × ~500 bytes ≈ 25 KB/month total).
    const longPrompt = `${"a".repeat(800)}\n\nFormat: 16:9 widescreen aspect ratio, standard editorial quality.`;

    await track({
      projectId,
      service: "google-gemini",
      operation: "hero-image-generation",
      estimatedCostEur: 0.07,
      fn: async () => ({ ok: true }),
      computeCostEur: () => 0.062,
      metadata: () => ({
        prompt: longPrompt,
        resolution: "2k",
        aspectRatio: "16:9",
      }),
    });

    const [log] = await db
      .select()
      .from(costLogs)
      .where(eq(costLogs.projectId, projectId));

    const meta = log!.metadata as Record<string, unknown>;
    expect(typeof meta.prompt).toBe("string");
    expect((meta.prompt as string).length).toBe(longPrompt.length);
    expect(meta.resolution).toBe("2k");
  });
});
