/**
 * Spec 65.3 — Persona-scoring routes.
 *
 * Surfaces the backfill workflow + a per-tool inspect endpoint for the
 * Settings UI. Mirrors the 65.2 tool-brand-assets routes shape (auth-gated,
 * project-slug-scoped, single Hono router mounted at /api/projects).
 *
 * Endpoints:
 *   GET  /:slug/persona-scoring/stats     — totals + per-persona breakdown
 *   GET  /:slug/persona-scoring/scores    — list (optional ?toolId, ?persona)
 *   POST /:slug/persona-scoring/backfill  — triggers backfillPersonaScores (synchronous)
 *
 * The backfill endpoint runs synchronously (not via BullMQ). A 108-tool
 * Toolwiki backfill takes ~5 min; Marcel-Decision §3.3 was Lazy + Backfill
 * (not eager-onboarding), so the trigger is rare and admin-only. Future
 * V1.1 could move it behind a BullMQ job if scale demands.
 */
import { zValidator } from "@hono/zod-validator";
import {
  and,
  articles,
  db,
  eq,
  gte,
  listPersonaScoresForTool,
  projects,
  sql,
  toolPersonaScores,
} from "@marketing-auto/db";
import { DEFAULT_PERSONAS, createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import { backfillPersonaScores } from "../../scripts/backfill-persona-scores.ts";

const log = createLogger("api:persona-scoring");

export const personaScoringRoutes = new Hono();
personaScoringRoutes.use(requireAuth);

/** Marcel-Decision §3.4 — fresh window. */
const FRESH_WINDOW_DAYS = 180;

// ─── GET /api/projects/:slug/persona-scoring/stats ───────────────────────────
// Lightweight dashboard data: total tools, scored tools, fresh-coverage per
// persona. Drives the Settings page top-of-card stats.

personaScoringRoutes.get("/:slug/persona-scoring/stats", async (c) => {
  const slug = c.req.param("slug");
  const [project] = await db
    .select({ id: projects.id, targetLocales: projects.targetLocales })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const primaryLocale = project.targetLocales?.[0]?.split("-")[0] ?? "de";
  const cutoff = new Date(Date.now() - FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Total tool-articles (one per logical tool — primary locale only).
  const toolsCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, project.id),
        eq(articles.collection, "tools"),
        eq(articles.locale, primaryLocale)
      )
    );
  const totalTools = toolsCountRows[0]?.count ?? 0;

  // Fresh score rows for the project, grouped by persona.
  const freshRows = await db
    .select({
      persona: toolPersonaScores.persona,
      toolId: toolPersonaScores.toolId,
    })
    .from(toolPersonaScores)
    .where(
      and(
        eq(toolPersonaScores.projectId, project.id),
        gte(toolPersonaScores.scoredAt, cutoff)
      )
    );

  // Per-persona unique-tool counts.
  const perPersona: Record<string, { freshCount: number }> = {};
  for (const p of DEFAULT_PERSONAS) perPersona[p] = { freshCount: 0 };
  const seenPerPersona = new Map<string, Set<string>>();
  for (const r of freshRows) {
    if (!seenPerPersona.has(r.persona)) seenPerPersona.set(r.persona, new Set());
    seenPerPersona.get(r.persona)!.add(r.toolId);
  }
  for (const [persona, set] of seenPerPersona) {
    if (!perPersona[persona]) perPersona[persona] = { freshCount: 0 };
    perPersona[persona].freshCount = set.size;
  }

  // Tools with COMPLETE fresh coverage (= 10 persona-rows fresh).
  const toolPersonaCount = new Map<string, number>();
  for (const r of freshRows) {
    toolPersonaCount.set(r.toolId, (toolPersonaCount.get(r.toolId) ?? 0) + 1);
  }
  let completeTools = 0;
  for (const [, n] of toolPersonaCount) {
    if (n >= DEFAULT_PERSONAS.length) completeTools++;
  }

  return c.json({
    ok: true,
    data: {
      totalTools,
      completeTools,
      pendingTools: totalTools - completeTools,
      perPersona,
      personasUsed: DEFAULT_PERSONAS,
      freshWindowDays: FRESH_WINDOW_DAYS,
    },
  });
});

// ─── GET /api/projects/:slug/persona-scoring/scores ──────────────────────────
// Browse scored tools. Optional ?persona=<slug> filter + ?toolId=<id> filter.
// Caps result to 200 rows by default.

const scoresQuerySchema = z.object({
  persona: z.string().min(1).optional(),
  toolId: z.string().uuid().optional(),
  minScore: z.coerce.number().int().min(0).max(10).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

personaScoringRoutes.get(
  "/:slug/persona-scoring/scores",
  zValidator("query", scoresQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    // Per-tool shortcut — re-use the existing helper for consistency.
    if (q.toolId) {
      const scores = await listPersonaScoresForTool({
        toolId: q.toolId,
        projectId: project.id,
      });
      return c.json({ ok: true, data: { scores, total: scores.length } });
    }

    const conditions = [eq(toolPersonaScores.projectId, project.id)];
    if (q.persona) conditions.push(eq(toolPersonaScores.persona, q.persona));
    if (q.minScore !== undefined) conditions.push(gte(toolPersonaScores.score, q.minScore));

    const rows = await db
      .select({
        toolId: toolPersonaScores.toolId,
        toolName: articles.title,
        toolSlug: articles.slug,
        persona: toolPersonaScores.persona,
        score: toolPersonaScores.score,
        reasoning: toolPersonaScores.reasoning,
        scoredAt: toolPersonaScores.scoredAt,
      })
      .from(toolPersonaScores)
      .innerJoin(articles, eq(articles.id, toolPersonaScores.toolId))
      .where(and(...conditions))
      .limit(q.limit);

    return c.json({ ok: true, data: { scores: rows, total: rows.length } });
  }
);

// ─── POST /api/projects/:slug/persona-scoring/backfill ───────────────────────
// Synchronous backfill trigger. Returns the BackfillPersonaScoresSummary.

const backfillBodySchema = z.object({
  apply: z.boolean().default(false),
  force: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

personaScoringRoutes.post(
  "/:slug/persona-scoring/backfill",
  zValidator("json", backfillBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const body = c.req.valid("json");

    const [project] = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    log.info(
      { projectSlug: slug, apply: body.apply, force: body.force, limit: body.limit },
      "persona-scoring backfill triggered via API"
    );

    try {
      const summary = await backfillPersonaScores({
        projectSlug: slug,
        apply: body.apply,
        ...(body.force !== undefined && { force: body.force }),
        ...(body.limit !== undefined && { limit: body.limit }),
      });
      return c.json({ ok: true, data: summary });
    } catch (err) {
      log.error(
        { projectSlug: slug, err: err instanceof Error ? err.message : String(err) },
        "persona-scoring backfill failed"
      );
      return c.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Backfill failed",
        },
        500
      );
    }
  }
);

