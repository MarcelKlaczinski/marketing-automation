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
import { listActiveTemplates, setTemplateActive } from "@marketing-auto/db";
import { requireAuth } from "../../middleware/auth.ts";
import {
  loadPersistedPreviewState,
  previewTemplate,
  resolveProjectIdBySlug,
} from "../../lib/template-preview-service.ts";

const log = createLogger("api:templates-preview");

export const templatePreviewRoutes = new Hono();
templatePreviewRoutes.use(requireAuth);

// ─── GET /api/projects/:slug/templates — list active templates ──────────────

// ─── PATCH /api/projects/:slug/templates/:templateKey — flip is_active ──────

const patchBodySchema = z.object({
  /** Spec 65.0 §13 Q8 default: soft-disable via DB flag. */
  isActive: z.boolean(),
});

templatePreviewRoutes.patch(
  "/:slug/templates/:templateKey",
  zValidator("json", patchBodySchema),
  async (c) => {
    const { slug, templateKey } = c.req.param();
    const body = c.req.valid("json");

    const projectId = await resolveProjectIdBySlug(slug);
    if (!projectId) {
      return c.json({ ok: false, error: "project_not_found" }, 404);
    }

    const result = await setTemplateActive({
      projectId,
      templateKey,
      isActive: body.isActive,
    });

    if (result.updated === 0) {
      return c.json({ ok: false, error: "template_not_found", templateKey }, 404);
    }

    return c.json({
      ok: true,
      data: {
        templateKey,
        isActive: body.isActive,
        // Tells the UI whether the flip targeted the project-scoped row or
        // the global one — useful for the eventual "show me what scope is
        // hidden vs visible" admin view.
        scope: result.scope,
      },
    });
  },
);

const listQuerySchema = z.object({
  /**
   * Optional filter: return only templates whose `format_types` array
   * contains this value. Hits the GIN index on `format_types` from Day 1-2.
   */
  formatType: z.string().min(1).max(64).optional(),
  /**
   * Spec 65.0 Day 6: include soft-disabled (`is_active = false`) rows.
   * Default omits them — matches the pre-Day-6 contract that returned
   * only active templates.
   */
  includeInactive: z.coerce.boolean().optional(),
});

templatePreviewRoutes.get(
  "/:slug/templates",
  zValidator("query", listQuerySchema),
  async (c) => {
    const { slug } = c.req.param();
    const q = c.req.valid("query");

    const projectId = await resolveProjectIdBySlug(slug);
    if (!projectId) {
      return c.json({ ok: false, error: "project_not_found" }, 404);
    }

    const rows = await listActiveTemplates({
      projectId,
      ...(q.formatType !== undefined && { formatType: q.formatType }),
      ...(q.includeInactive !== undefined && { includeInactive: q.includeInactive }),
    });

    // Spec 65.0 Day 5: probe the filesystem per row for persisted preview
    // slides. Each preview lives under
    // `<cwd>/renders/preview/<slug>/<templateKey>/slide-NN.png`; re-renders
    // overwrite the same path. The probe is one readdir per row (~5 rows
    // typical) — cheap. Failures degrade silently to `lastPreview: null`.
    const items = await Promise.all(
      rows.map(async (r) => {
        const lastPreview = await loadPersistedPreviewState({
          projectSlug: slug,
          templateKey: r.templateKey,
        });
        return {
          id: r.id,
          projectId: r.projectId,
          templateKey: r.templateKey,
          baseTemplateKey: r.baseTemplateKey,
          variant: r.variant,
          filePath: r.filePath,
          fileHash: r.fileHash,
          isActive: r.isActive,
          formatTypes: r.formatTypes,
          outputFormat: r.outputFormat,
          compatibleChannels: r.compatibleChannels,
          generationClass: r.generationClass,
          displayName: r.displayName,
          description: r.description,
          defaultSlideCount: r.defaultSlideCount,
          estimatedCostUsd: r.estimatedCostUsd,
          usageCount: r.usageCount,
          lastUsedAt: r.lastUsedAt,
          lastSeenAt: r.lastSeenAt,
          previewImageUrl: r.previewImageUrl,
          // `scope` is convenience: tells the UI whether this row is global
          // (any tenant) or project-specific without dereferencing projectId.
          scope: r.projectId === null ? "global" : "project",
          // null when no preview has ever been rendered for this project + key.
          lastPreview,
        };
      }),
    );

    return c.json({ ok: true, data: { items } });
  },
);

// ─── POST /api/projects/:slug/templates/:templateKey/preview ────────────────

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
      projectSlug: slug,
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
