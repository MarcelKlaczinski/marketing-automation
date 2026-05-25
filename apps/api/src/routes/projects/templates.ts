/**
 * Spec 65.0 Day 4 — Template preview endpoint.
 *
 *   POST /api/projects/:slug/templates/:templateKey/preview
 *
 * Renders a template with caller-supplied (or named-fixture) sample data
 * and returns ephemeral PNG URLs served by the API process's
 * `/renders/preview/...` static handler. No DB writes; no cost log
 * (rendering is local Remotion + Sharp, no external API call).
 *
 * Auth: required (settings UI).
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import { brandTokensSchema } from "@marketing-auto/shared/brand-tokens";
import { requireAuth } from "../../middleware/auth.ts";
import {
  previewTemplate,
  resolveProjectIdBySlug,
} from "../../lib/template-preview-service.ts";

const log = createLogger("api:templates-preview");

export const templatePreviewRoutes = new Hono();
templatePreviewRoutes.use(requireAuth);

const previewBodySchema = z.object({
  /**
   * Full composition input — same shape as the underlying render-server
   * Zod schema (e.g. `ComparisonGrid4Input`). Required; the preview
   * service does NOT auto-build this from mockFixtures because the
   * fixture's `input` is a different shape (`buildInput`-output, not
   * composition-input). Day 5 UI builds a convenient form on top of this
   * raw API.
   */
  sampleData: z.record(z.string(), z.unknown()),
  theme: z.enum(["dark", "light"]).optional(),
  locale: z.enum(["de", "en"]).optional(),
  brandTokensOverride: brandTokensSchema.optional(),
});

templatePreviewRoutes.post(
  "/:slug/templates/:templateKey/preview",
  zValidator("json", previewBodySchema),
  async (c) => {
    const { slug, templateKey } = c.req.param();
    const body = c.req.valid("json");

    const projectId = await resolveProjectIdBySlug(slug);
    if (!projectId) {
      return c.json({ ok: false, error: "project_not_found" }, 404);
    }

    const result = await previewTemplate({
      projectId,
      templateKey,
      sampleData: body.sampleData,
      ...(body.theme !== undefined && { theme: body.theme }),
      ...(body.locale !== undefined && { locale: body.locale }),
      ...(body.brandTokensOverride !== undefined && {
        brandTokensOverride: body.brandTokensOverride,
      }),
    });

    // Discriminate on the result shape.
    if ("kind" in result) {
      switch (result.kind) {
        case "template_not_found":
        case "template_not_in_registry":
          return c.json(
            { ok: false, error: result.kind, templateKey: result.templateKey },
            404,
          );
        case "no_render_function":
          return c.json(
            { ok: false, error: "no_render_function", templateKey: result.templateKey },
            501,
          );
        case "render_failed":
          log.warn({ slug, templateKey, message: result.message }, "Preview render failed");
          return c.json({ ok: false, error: "render_failed", message: result.message }, 400);
        case "project_not_found":
          return c.json({ ok: false, error: "project_not_found" }, 404);
        default: {
          // Exhaustive switch — any new error variant added to PreviewError
          // will surface at compile time here. Memory D125 pattern.
          const _exhaustive: never = result;
          void _exhaustive;
          return c.json({ ok: false, error: "unknown" }, 500);
        }
      }
    }

    return c.json({ ok: true, data: result });
  },
);
