import { db, fetchTemplateOverrides, projectTemplateOverrides, projects } from "@marketing-auto/db";
import {
  OVERRIDE_TEMPLATE_KEYS,
  getOverrideSchema,
  isOverrideTemplateKey,
  mergeOverrides,
} from "@marketing-auto/social/templates/overrides";
import { createLogger } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth } from "../../middleware/auth.ts";

const log = createLogger("routes:template-overrides");

export const templateOverrideRoutes = new Hono();
templateOverrideRoutes.use(requireAuth);

// ─── GET /api/projects/:slug/template-overrides ────────────────────────────────
// Returns all override rows for the project merged with schema defaults.
// Templates without a stored row return values = schema defaults, hasCustomOverrides = false.

templateOverrideRoutes.get("/:slug/template-overrides", async (c) => {
  const slug = c.req.param("slug");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const rows = await db
    .select()
    .from(projectTemplateOverrides)
    .where(eq(projectTemplateOverrides.projectId, project.id));

  const result = OVERRIDE_TEMPLATE_KEYS.map((key) => {
    const row = rows.find((r) => r.templateKey === key);
    const schema = getOverrideSchema(key);
    const values = mergeOverrides(schema, row?.values ?? null);
    return {
      templateKey: key,
      hasCustomOverrides: row !== undefined,
      values,
      lastUsedAt: row?.lastUsedAt ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  });

  return c.json({ ok: true, data: result });
});

// ─── PUT /api/projects/:slug/template-overrides/:templateKey ──────────────────
// Upserts override row. Body: { values: Record<string, unknown> }.
// Validates values against the template's override schema (unknown keys stripped).

templateOverrideRoutes.put("/:slug/template-overrides/:templateKey", async (c) => {
  const slug = c.req.param("slug");
  const templateKey = c.req.param("templateKey");

  if (!isOverrideTemplateKey(templateKey)) {
    return c.json({ ok: false, error: "Unknown template key" }, 404);
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const rawBody = await c.req.json().catch(() => ({}));
  const body = (rawBody as { values?: unknown }).values;

  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ ok: false, error: "Body must contain a 'values' object" }, 400);
  }

  const schema = getOverrideSchema(templateKey);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    log.warn({ templateKey, issues: parsed.error.flatten() }, "Override validation failed");
    return c.json(
      { ok: false, error: "Validation failed", details: parsed.error.flatten() },
      400,
    );
  }

  await db
    .insert(projectTemplateOverrides)
    .values({
      projectId: project.id,
      templateKey,
      values: parsed.data as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [projectTemplateOverrides.projectId, projectTemplateOverrides.templateKey],
      set: {
        values: parsed.data as Record<string, unknown>,
        updatedAt: new Date(),
      },
    });

  log.info({ projectId: project.id, templateKey }, "Template overrides saved");
  return c.json({ ok: true });
});

// ─── DELETE /api/projects/:slug/template-overrides/:templateKey ───────────────
// Removes the override row → template falls through to schema defaults on next render.

templateOverrideRoutes.delete("/:slug/template-overrides/:templateKey", async (c) => {
  const slug = c.req.param("slug");
  const templateKey = c.req.param("templateKey");

  if (!isOverrideTemplateKey(templateKey)) {
    return c.json({ ok: false, error: "Unknown template key" }, 404);
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const rows = await db
    .delete(projectTemplateOverrides)
    .where(
      and(
        eq(projectTemplateOverrides.projectId, project.id),
        eq(projectTemplateOverrides.templateKey, templateKey),
      ),
    )
    .returning({ id: projectTemplateOverrides.id });

  log.info({ projectId: project.id, templateKey, deleted: rows.length }, "Template overrides reset");
  return c.json({ ok: true, deleted: rows.length > 0 });
});

// ─── GET /api/projects/:slug/template-overrides/:templateKey ──────────────────
// Fetch a single template's current effective values (merged with defaults).

templateOverrideRoutes.get("/:slug/template-overrides/:templateKey", async (c) => {
  const slug = c.req.param("slug");
  const templateKey = c.req.param("templateKey");

  if (!isOverrideTemplateKey(templateKey)) {
    return c.json({ ok: false, error: "Unknown template key" }, 404);
  }

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const row = await fetchTemplateOverrides(project.id, templateKey);
  const schema = getOverrideSchema(templateKey);
  const values = mergeOverrides(schema, row?.values ?? null);

  return c.json({ ok: true, data: { templateKey, hasCustomOverrides: row !== null, values } });
});
