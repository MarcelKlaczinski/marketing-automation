// Spec 65.0 Day 4 — Actual-Remotion happy-path integration test.
//
// Gated behind `RUN_VISUAL=1` because a full Remotion bundle init + headless
// Chrome render adds ~5-15s to the suite. Same gate pattern as
// `packages/social/test/visual.test.ts`. Default `bun test` runs skip these
// (1 skip, fast suite); CI / local Marcel `RUN_VISUAL=1 bun test` exercises
// the real render pipeline end-to-end through the preview service.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { stat as fsStat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { db, eq, projects } from "@marketing-auto/db";
import { previewTemplate } from "../../src/lib/template-preview-service.ts";
import { bootstrapAndSyncTemplates } from "../../src/lib/template-registry-sync.ts";

const VISUAL = process.env.RUN_VISUAL === "1";
const itVisual = VISUAL ? it : it.skip;

describe("previewTemplate actual-render (Spec 65.0 Day 4, RUN_VISUAL=1 only)", () => {
  let projectId: string;
  let createdSessionDirs: string[] = [];

  beforeAll(async () => {
    if (!VISUAL) return;
    await bootstrapAndSyncTemplates();

    const ts = Date.now();
    const [project] = await db
      .insert(projects)
      .values({
        slug: `preview-render-${ts}`,
        name: "Preview Render Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    if (!project) throw new Error("Failed to seed test project");
    projectId = project.id;
  });

  afterAll(async () => {
    if (!VISUAL) return;
    // Sweep any session dirs the test created so it doesn't leave
    // ~150KB PNGs lying around.
    for (const dir of createdSessionDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (projectId) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });

  /**
   * Minimal valid `ComparisonGrid4Input` for end-to-end render. Shape
   * mirrors `packages/social/src/compositions/comparison-grid-4/types.ts`
   * — required `generated` block + 4 tools. Hand-crafted because
   * `mockFixtures[X].input` is the `buildInput`-output shape (Grid4Context),
   * not the composition-input shape; the preview service does not transform
   * between them.
   */
  function buildSampleData() {
    return {
      slideIndex: 0,
      locale: "de" as const,
      theme: "dark" as const,
      generated: {
        headline: "Welcher KI-Bildgenerator",
        headlineEm: "gewinnt 2026?",
        subline:
          "Vier Modelle, dieselben 12 Prompts, drei Wochen Test — hier ist das Ergebnis.",
        eyebrow: "Vergleich · 4 Tools",
        slideNum: "01 / 04",
        ctaLine1: "Mehr Tool-Tests",
        ctaLine2: "auf toolwiki.ai",
        dateLabel: "Mai 2026",
        tools: [
          {
            name: "Midjourney",
            verdictStrong: "Premium-Ästhetik",
            verdictRest: "out-of-the-box, ideal für Hero-Visuals.",
            score: 92,
            scoreTier: "hi" as const,
            priceLabel: "ab 10 €",
            isWinner: true,
            winnerFlagText: "Testsieger",
            iconInitials: "MJ",
            iconHue: 220,
          },
          {
            name: "Flux 1.2 Pro",
            verdictStrong: "Stärkster Photorealismus",
            verdictRest: "mit fairer API-Pricing.",
            score: 88,
            scoreTier: "hi" as const,
            priceLabel: "ab 0,05 €",
            isWinner: false,
            iconInitials: "FX",
            iconHue: 260,
          },
          {
            name: "Recraft V3",
            verdictStrong: "Vektor-Export",
            verdictRest: "direkt aus der Box, ideal für Design-Teams.",
            score: 84,
            scoreTier: "mid" as const,
            priceLabel: "ab 0 €",
            isWinner: false,
            iconInitials: "RC",
            iconHue: 180,
          },
          {
            name: "Ideogram 2.0",
            verdictStrong: "Beste Typografie",
            verdictRest: "für Text-im-Bild-Motive.",
            score: 80,
            scoreTier: "mid" as const,
            priceLabel: "ab 0 €",
            isWinner: false,
            iconInitials: "ID",
            iconHue: 280,
          },
        ],
      },
    };
  }

  itVisual(
    "renders comparison-grid-4 from sampleData and writes the PNG to disk",
    async () => {
      const result = await previewTemplate({
        projectId,
        templateKey: "comparison-grid-4",
        sampleData: buildSampleData(),
      });

      // Result must be the happy-path shape (no `kind` discriminator).
      expect("kind" in result).toBe(false);
      if ("kind" in result) throw new Error("preview returned an error variant");

      expect(result.sessionId.startsWith("preview-")).toBe(true);
      expect(result.previewUrls.length).toBeGreaterThanOrEqual(1);
      expect(result.slideCount).toBe(result.previewUrls.length);
      expect(result.renderDurationMs).toBeGreaterThan(0);

      // URL shape: /renders/preview/<sessionId>/slide-00.png
      const firstUrl = result.previewUrls[0] as string;
      expect(firstUrl).toMatch(/^\/renders\/preview\/preview-[\w-]+\/slide-\d{2}\.png$/);

      // The first slide PNG must exist on disk and be non-empty.
      const cwd = process.cwd();
      const firstPath = join(cwd, firstUrl);
      const info = await fsStat(firstPath);
      expect(info.isFile()).toBe(true);
      expect(info.size).toBeGreaterThan(1000); // ~150KB typical; 1KB threshold catches empty files

      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      const header = (await readFile(firstPath)).subarray(0, 8);
      expect(header[0]).toBe(0x89);
      expect(header[1]).toBe(0x50);
      expect(header[2]).toBe(0x4e);
      expect(header[3]).toBe(0x47);

      // Track for cleanup.
      const sessionDir = join(cwd, "renders", "preview", result.sessionId);
      createdSessionDirs.push(sessionDir);
    },
    // Generous timeout: first Remotion bundle init = ~5-15s, render itself = ~1-3s.
    60_000,
  );

  itVisual(
    "renders a second sample quickly using the cached Remotion bundle",
    async () => {
      const start = Date.now();
      const result = await previewTemplate({
        projectId,
        templateKey: "comparison-grid-4",
        // Re-use the same shape; renders a different content variant.
        sampleData: {
          ...buildSampleData(),
          generated: {
            ...buildSampleData().generated,
            eyebrow: "Vergleich · Re-Render",
            slideNum: "02 / 04",
          },
        },
      });
      const elapsed = Date.now() - start;
      expect("kind" in result).toBe(false);
      if ("kind" in result) throw new Error("preview returned an error variant");
      // Bundle is cached from the prior test; this render should be <5s.
      // Loose ceiling — flaky CI hosts could spike, but >5s would signal
      // a regression in bundle caching.
      expect(elapsed).toBeLessThan(10_000);
      createdSessionDirs.push(
        join(process.cwd(), "renders", "preview", result.sessionId),
      );
    },
    30_000,
  );
});
