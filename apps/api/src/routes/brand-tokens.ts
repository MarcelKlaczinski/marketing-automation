import { zValidator } from "@hono/zod-validator";
import { db, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";
import {
  getBrandTokens,
  brandTokensSchema,
  DEFAULT_TYPOGRAPHY,
  type ParsedBrandTokens,
} from "../lib/brand-asset-service.ts";

const log = createLogger("routes:brand-tokens");

export const brandTokenRoutes = new Hono();
brandTokenRoutes.use(requireAuth);

const DEFAULT_TOKENS: ParsedBrandTokens = {
  typography: DEFAULT_TYPOGRAPHY,
};

// ─── GET /api/projects/:slug/brand-tokens ─────────────────────────────────────

brandTokenRoutes.get("/:slug/brand-tokens", async (c) => {
  const slug = c.req.param("slug");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const tokens = await getBrandTokens(project.id);

  return c.json({ ok: true, data: { tokens, defaults: DEFAULT_TOKENS } });
});

// ─── PATCH /api/projects/:slug/brand-tokens ───────────────────────────────────

const patchBodySchema = z.object({
  tokens: brandTokensSchema.partial(),
});

brandTokenRoutes.patch(
  "/:slug/brand-tokens",
  zValidator("json", patchBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const body = c.req.valid("json");

    const [project] = await db
      .select({ id: projects.id, brandTokens: projects.brandTokens })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const existing = brandTokensSchema.parse(project.brandTokens ?? {});

    // Deep merge: only override fields the caller sent
    const merged: ParsedBrandTokens = {
      colors: { ...existing.colors, ...body.tokens.colors },
      typography: { ...existing.typography, ...body.tokens.typography },
      voice: { ...existing.voice, ...body.tokens.voice },
      social: { ...existing.social, ...body.tokens.social },
    };

    const rows = await db
      .update(projects)
      // exactOptionalPropertyTypes: ParsedBrandTokens has field?: T|undefined while BrandTokens has field?: T
      // The shapes are structurally compatible at runtime; cast is safe here.
      // biome-ignore lint/suspicious/noExplicitAny: exactOptionalPropertyTypes incompatibility
      .set({ brandTokens: merged as any, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .returning({ id: projects.id });

    if (!rows[0]) return c.json({ ok: false, error: "Update failed" }, 500);

    // Apply defaults before returning
    const tokens = await getBrandTokens(project.id);
    log.info({ projectId: project.id }, "brand tokens updated");

    return c.json({ ok: true, data: { tokens } });
  }
);

// ─── POST /api/projects/:slug/brand-tokens/reset ──────────────────────────────

const resetBodySchema = z.object({
  sections: z.array(z.enum(["colors", "typography", "voice", "social"])).optional(),
});

brandTokenRoutes.post("/:slug/brand-tokens/reset", async (c) => {
  const rawBody = await c.req.json().catch(() => ({}));
  const body = resetBodySchema.safeParse(rawBody).data ?? {};

  const slug = c.req.param("slug");

  const [project] = await db
    .select({ id: projects.id, brandTokens: projects.brandTokens })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const existing = brandTokensSchema.parse(project.brandTokens ?? {});
  const sectionsToReset = body.sections ?? ["colors", "typography", "voice", "social"];

  const updated: ParsedBrandTokens = { ...existing };
  for (const section of sectionsToReset) {
    delete updated[section];
  }

  await db
    .update(projects)
    // biome-ignore lint/suspicious/noExplicitAny: exactOptionalPropertyTypes incompatibility (see PATCH handler)
    .set({ brandTokens: updated as any, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  const tokens = await getBrandTokens(project.id);
  log.info({ projectId: project.id, sections: sectionsToReset }, "brand tokens reset");

  return c.json({ ok: true, data: { tokens } });
});
