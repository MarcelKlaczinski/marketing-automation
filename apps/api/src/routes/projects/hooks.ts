/**
 * Spec 65.11 — Hook Library CRUD API (Family-B narrative-hook patterns).
 *
 * 4 endpoints under `/api/projects/:slug/hooks[/...]`.
 *
 * Multi-tenancy enforced by resolving the URL slug to `projects.id` and
 * matching `hookTemplates.projectId` on every read/write. Cross-project
 * access returns 404 to avoid existence-leaks.
 *
 * The `formatType` + `language` are immutable after creation (UI exposes
 * them as read-only) — PATCH only edits `pattern`, `variables`, `isActive`.
 */
import { zValidator } from "@hono/zod-validator";
import {
  createHookTemplate,
  db,
  eq,
  getHookTemplate,
  hookTemplates,
  listHookTemplates,
  projects,
  setHookTemplateActive,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";

const log = createLogger("api:hooks");

export const hooksRoutes = new Hono();
hooksRoutes.use(requireAuth);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const languageSchema = z.enum(["de", "en"]);

const createHookBodySchema = z.object({
  formatType: z.string().min(1).max(80),
  pattern: z.string().min(2).max(280),
  language: languageSchema,
  variables: z.array(z.string().min(1).max(40)).default([]),
  isActive: z.boolean().default(true),
});

const patchHookBodySchema = z.object({
  pattern: z.string().min(2).max(280).optional(),
  variables: z.array(z.string().min(1).max(40)).optional(),
  isActive: z.boolean().optional(),
});

const setActiveBodySchema = z.object({ isActive: z.boolean() });

const listQuerySchema = z.object({
  formatType: z.string().min(1).optional(),
  language: languageSchema.optional(),
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

async function loadOwnedHook(hookId: string, projectId: string) {
  const hook = await getHookTemplate(hookId);
  if (!hook || hook.projectId !== projectId) return null;
  return hook;
}

// ─── GET /:slug/hooks ────────────────────────────────────────────────────────

hooksRoutes.get(
  "/:slug/hooks",
  zValidator("query", listQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const filters: Parameters<typeof listHookTemplates>[0] = {
      projectId: project.id,
      includeInactive: q.includeInactive ?? true,
    };
    if (q.formatType) filters.formatType = q.formatType;
    if (q.language) filters.language = q.language;

    const hooks = await listHookTemplates(filters);
    return c.json({ ok: true, data: { hooks } });
  },
);

// ─── POST /:slug/hooks ───────────────────────────────────────────────────────

hooksRoutes.post(
  "/:slug/hooks",
  zValidator("json", createHookBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    // Reject patterns referencing variables that aren't declared. The
    // 65.4 `renderHook` throws at runtime on missing variables; catching
    // here gives Marcel a 422 instead of a silent runtime failure later.
    const placeholders = extractPlaceholders(body.pattern);
    const missing = placeholders.filter((p) => !body.variables.includes(p));
    if (missing.length > 0) {
      return c.json(
        {
          ok: false,
          error: `Pattern references undeclared variables: ${missing.join(", ")}`,
        },
        422,
      );
    }

    const created = await createHookTemplate({
      projectId: project.id,
      formatType: body.formatType,
      pattern: body.pattern,
      language: body.language,
      variables: body.variables,
      isActive: body.isActive,
    });
    log.info(
      { projectSlug: slug, hookId: created.id, formatType: body.formatType },
      "hook-template created",
    );
    return c.json({ ok: true, data: { hook: created } }, 201);
  },
);

// ─── PATCH /:slug/hooks/:id ──────────────────────────────────────────────────

hooksRoutes.patch(
  "/:slug/hooks/:id",
  zValidator("json", patchHookBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const existing = await loadOwnedHook(id, project.id);
    if (!existing) return c.json({ ok: false, error: "Hook not found" }, 404);

    // Re-validate placeholder coverage when either field changes.
    if (body.pattern !== undefined || body.variables !== undefined) {
      const pattern = body.pattern ?? existing.pattern;
      const variables = body.variables ?? existing.variables;
      const placeholders = extractPlaceholders(pattern);
      const missing = placeholders.filter((p) => !variables.includes(p));
      if (missing.length > 0) {
        return c.json(
          {
            ok: false,
            error: `Pattern references undeclared variables: ${missing.join(", ")}`,
          },
          422,
        );
      }
    }

    const patch: Partial<typeof hookTemplates.$inferInsert> = {};
    if (body.pattern !== undefined) patch.pattern = body.pattern;
    if (body.variables !== undefined) patch.variables = body.variables;
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    await db.update(hookTemplates).set(patch).where(eq(hookTemplates.id, id));
    const updated = await getHookTemplate(id);
    return c.json({ ok: true, data: { hook: updated } });
  },
);

// ─── PATCH /:slug/hooks/:id/active ───────────────────────────────────────────

hooksRoutes.patch(
  "/:slug/hooks/:id/active",
  zValidator("json", setActiveBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const existing = await loadOwnedHook(id, project.id);
    if (!existing) return c.json({ ok: false, error: "Hook not found" }, 404);

    await setHookTemplateActive(id, body.isActive);
    return c.json({ ok: true, data: { isActive: body.isActive } });
  },
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract `{name}` placeholder tokens from a hook pattern. Mirrors the
 * substitution behaviour of `renderHook` in `lib/hook-library/render-hook.ts`
 * — single curly braces, no nested expressions.
 */
function extractPlaceholders(pattern: string): string[] {
  const matches = pattern.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
  const out: string[] = [];
  for (const m of matches) {
    const name = m[1];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
