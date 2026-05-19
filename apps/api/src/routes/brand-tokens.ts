import { zValidator } from "@hono/zod-validator";
import { db, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { validateBrandTokenContrast } from "@marketing-auto/social/lib";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";
import {
  getBrandTokens,
  brandTokensSchema,
  type ParsedBrandTokens,
} from "../lib/brand-asset-service.ts";
import { DEFAULT_BRAND_TOKENS } from "@marketing-auto/shared/brand-tokens";

const log = createLogger("routes:brand-tokens");

export const brandTokenRoutes = new Hono();
brandTokenRoutes.use(requireAuth);

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

  return c.json({ ok: true, data: { tokens, defaults: DEFAULT_BRAND_TOKENS } });
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
    const force = c.req.query("force") === "true";

    const [project] = await db
      .select({ id: projects.id, brandTokens: projects.brandTokens })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const existing = brandTokensSchema.parse(project.brandTokens ?? {});

    // Deep merge: only override fields the caller sent
    const rawMerge = {
      colors: { ...existing.colors, ...body.tokens.colors },
      typography: { ...existing.typography, ...body.tokens.typography },
      voice: { ...existing.voice, ...body.tokens.voice },
      social: { ...existing.social, ...body.tokens.social },
    };

    // Spec 60.0: parse through canonical schema before writing — ensures DB is always valid.
    // This also normalises deprecated fields (e.g. surfaceSecondary default) at write time.
    const merged: ParsedBrandTokens = brandTokensSchema.parse(rawMerge);

    // WCAG contrast validation — warning by default, blocker unless ?force=true
    const violations = validateBrandTokenContrast(merged);
    if (violations.length > 0 && !force) {
      return c.json({ ok: false, error: "Contrast violations detected", violations }, 400);
    }

    const rows = await db
      .update(projects)
      // biome-ignore lint/suspicious/noExplicitAny: exactOptionalPropertyTypes incompatibility
      .set({ brandTokens: merged as any, updatedAt: new Date() })
      .where(eq(projects.id, project.id))
      .returning({ id: projects.id });

    if (!rows[0]) return c.json({ ok: false, error: "Update failed" }, 500);

    // Apply defaults before returning
    const tokens = await getBrandTokens(project.id);
    log.info({ projectId: project.id, violationCount: violations.length }, "brand tokens updated");

    return c.json({ ok: true, data: { tokens, violations } });
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

  // Delete requested sections, then re-parse through canonical schema so the DB
  // always stores fully-normalised data (Spec 60.0: write-time validation invariant).
  const afterDelete: Record<string, unknown> = { ...existing };
  for (const section of sectionsToReset) {
    delete afterDelete[section];
  }
  const updated: ParsedBrandTokens = brandTokensSchema.parse(afterDelete);

  await db
    .update(projects)
    // biome-ignore lint/suspicious/noExplicitAny: exactOptionalPropertyTypes incompatibility (see PATCH handler)
    .set({ brandTokens: updated as any, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  const tokens = await getBrandTokens(project.id);
  log.info({ projectId: project.id, sections: sectionsToReset }, "brand tokens reset");

  return c.json({ ok: true, data: { tokens } });
});
