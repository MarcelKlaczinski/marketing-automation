/**
 * Spec 65.11 — End-Slide Definitions CRUD API.
 *
 * 4 endpoints under `/api/projects/:slug/end-slides[/...]`.
 *
 * Per-type Zod config validation via `END_SLIDE_CONFIG_SCHEMAS` from
 * `@marketing-auto/social/end-slide-components` — adding a new V1.5+ type
 * extends that map and surfaces here automatically. Multi-tenant guard
 * mirrors hooks + recurring-content-definitions routes.
 */
import { zValidator } from "@hono/zod-validator";
import {
  createEndSlideDefinition,
  db,
  eq,
  getEndSlideDefinition,
  listEndSlideDefinitions,
  projects,
  setEndSlideActive,
  updateEndSlideDefinition,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import {
  END_SLIDE_CONFIG_SCHEMAS,
  END_SLIDE_TYPES,
  type EndSlideType,
} from "@marketing-auto/social/end-slide-components/types";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";

const log = createLogger("api:end-slides");

export const endSlidesRoutes = new Hono();
endSlidesRoutes.use(requireAuth);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const endSlideTypeSchema = z.enum(END_SLIDE_TYPES);

const createEndSlideBodySchema = z.object({
  name: z.string().min(1).max(120),
  type: endSlideTypeSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

const patchEndSlideBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

const setActiveBodySchema = z.object({ isActive: z.boolean() });

const listQuerySchema = z.object({
  type: endSlideTypeSchema.optional(),
  includeInactive: z.coerce.boolean().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadProject(slug: string) {
  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return project ?? null;
}

async function loadOwnedEndSlide(endSlideId: string, projectId: string) {
  const row = await getEndSlideDefinition(endSlideId);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

/**
 * Per-type Zod validation. Returns `{ ok: true, data }` with the canonical
 * config or `{ ok: false, error }` with the message from the per-type
 * schema. The narrowing cast is justified because `type` is validated by
 * the enum schema at the route boundary.
 */
function validateEndSlideConfig(
  type: EndSlideType,
  config: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const schema = END_SLIDE_CONFIG_SCHEMAS[type];
  const parsed = schema.safeParse(config);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: parsed.error.message };
}

// ─── GET /:slug/end-slides ───────────────────────────────────────────────────

endSlidesRoutes.get(
  "/:slug/end-slides",
  zValidator("query", listQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const filters: Parameters<typeof listEndSlideDefinitions>[0] = {
      projectId: project.id,
      includeInactive: q.includeInactive ?? true,
    };
    if (q.type) filters.type = q.type;

    const endSlides = await listEndSlideDefinitions(filters);
    return c.json({ ok: true, data: { endSlides } });
  },
);

// ─── POST /:slug/end-slides ──────────────────────────────────────────────────

endSlidesRoutes.post(
  "/:slug/end-slides",
  zValidator("json", createEndSlideBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const cfgResult = validateEndSlideConfig(body.type, body.config);
    if (!cfgResult.ok) {
      return c.json(
        { ok: false, error: "Invalid end-slide config", details: cfgResult.error },
        422,
      );
    }

    const created = await createEndSlideDefinition({
      projectId: project.id,
      name: body.name,
      type: body.type,
      config: cfgResult.data as Record<string, unknown>,
      isActive: body.isActive,
    });
    log.info(
      { projectSlug: slug, endSlideId: created.id, type: body.type },
      "end-slide-definition created",
    );
    return c.json({ ok: true, data: { endSlide: created } }, 201);
  },
);

// ─── PATCH /:slug/end-slides/:id ─────────────────────────────────────────────

endSlidesRoutes.patch(
  "/:slug/end-slides/:id",
  zValidator("json", patchEndSlideBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const existing = await loadOwnedEndSlide(id, project.id);
    if (!existing) return c.json({ ok: false, error: "End-slide not found" }, 404);

    // Re-validate config against the existing type. We don't allow changing
    // `type` after creation — that would force a config-shape migration on
    // top of a UI-driven edit, which is high friction with no clear use
    // case (Marcel would create a new end-slide instead).
    if (body.config !== undefined) {
      const cfgResult = validateEndSlideConfig(existing.type as EndSlideType, body.config);
      if (!cfgResult.ok) {
        return c.json(
          { ok: false, error: "Invalid end-slide config", details: cfgResult.error },
          422,
        );
      }
    }

    const patch: Parameters<typeof updateEndSlideDefinition>[1] = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.config !== undefined) patch.config = body.config;
    if (body.isActive !== undefined) patch.isActive = body.isActive;

    const updated = await updateEndSlideDefinition(id, patch);
    return c.json({ ok: true, data: { endSlide: updated } });
  },
);

// ─── PATCH /:slug/end-slides/:id/active ──────────────────────────────────────

endSlidesRoutes.patch(
  "/:slug/end-slides/:id/active",
  zValidator("json", setActiveBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const existing = await loadOwnedEndSlide(id, project.id);
    if (!existing) return c.json({ ok: false, error: "End-slide not found" }, 404);

    await setEndSlideActive(id, body.isActive);
    return c.json({ ok: true, data: { isActive: body.isActive } });
  },
);
