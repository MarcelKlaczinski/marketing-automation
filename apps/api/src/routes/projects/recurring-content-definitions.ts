/**
 * Spec 65.11 — Recurring Content Definitions API.
 *
 * 8 endpoints under `/api/projects/:slug/recurring-content/definitions[/...]`
 * — CRUD + activation toggle + run-now + dry-run + history.
 *
 * Multi-tenancy enforced at every endpoint: the URL slug resolves to a
 * `projects.id` which is matched against every record before read/write.
 * Cross-project access (e.g. PATCH-ing a definition by ID that belongs to a
 * different project) returns 404 so the existence of foreign rows is not
 * leaked.
 *
 * Format-config validation runs through `validateFormatConfig` from
 * `@marketing-auto/shared/format-types` so the per-format-type Zod schema is
 * enforced at write time. Unknown format-types pass through the permissive
 * fallback so new types can ship without blocking persistence.
 */
import { zValidator } from "@hono/zod-validator";
import {
  countTopicBriefsByRecurringDefinitionId,
  createRecurringDefinition,
  db,
  eq,
  getRecurringDefinition,
  listRecurringDefinitions,
  listTopicBriefsByRecurringDefinitionId,
  projects,
  setRecurringDefinitionActive,
  updateRecurringDefinition,
} from "@marketing-auto/db";
import { frequencySchema } from "@marketing-auto/shared/recurring-content";
import { FORMAT_TYPES, validateFormatConfig } from "@marketing-auto/shared/format-types";
import { createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import { computeNextRun } from "../../lib/recurring-content/compute-next-run.ts";
import {
  checkBudgetAvailable,
  recordBudgetConsumption,
} from "../../lib/recurring-content/budget-check.ts";
import { renderSampleImage } from "../../lib/recurring-content/sample-image.ts";
import { resolveImageStylePreset } from "../../lib/recurring-content/resolve-image-style-preset.ts";
import {
  enqueueRecurringBriefGenerator,
  runDryRunForDefinition,
} from "../../workers/recurring-brief-generator.worker.ts";

const log = createLogger("api:recurring-content-definitions");

export const recurringContentDefinitionsRoutes = new Hono();
recurringContentDefinitionsRoutes.use(requireAuth);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const outputTargetsSchema = z.object({
  article: z.boolean(),
  social: z.boolean(),
});

const templateStrategySchema = z.enum(["fixed", "lru", "llm-picks", "latest"]);

/**
 * Body schema for POST /definitions. Most fields mirror the row 1:1; the
 * `formatConfig` blob is validated separately via `validateFormatConfig`
 * because the per-format Zod schema is keyed by `formatType`.
 */
const createDefinitionBodySchema = z.object({
  name: z.string().min(1).max(120),
  formatType: z.string().min(1).max(80),
  formatConfig: z.record(z.string(), z.unknown()).default({}),
  frequency: frequencySchema,
  /** Optional explicit first-run timestamp; defaults to NOW(). */
  nextRunAt: z.coerce.date().optional(),
  outputTargets: outputTargetsSchema.default({ article: false, social: true }),
  templateSelectionStrategy: templateStrategySchema.default("lru"),
  fixedTemplateKey: z.string().min(1).max(120).optional(),
  endSlideStrategy: z.string().min(1).max(40).default("rotation"),
  endSlidePool: z.array(z.string().uuid()).default([]),
  isActive: z.boolean().default(true),
  /**
   * Spec 65.V1.5b — per-definition auto-approve override.
   * NULL = inherit project default (`projects.recurringAutoApproveDefault`).
   * TRUE/FALSE = win over project default for this definition only.
   */
  autoApproveOverride: z.boolean().nullable().optional(),
  /**
   * Spec 65.16 — per-definition image-style preset override.
   * NULL = inherit project default (`projects.socialImageStylePreset`).
   * Set to one of the 3 PRESET_KEYS to win over the project default for
   * this definition only. Resolved at brief-generation time via
   * `resolvePresetForArticle()` cascade.
   */
  socialImageStylePresetOverride: z
    .enum(["dark-neon-grid", "light-editorial", "blue-tech-gradient"])
    .nullable()
    .optional(),
});

const patchDefinitionBodySchema = createDefinitionBodySchema.partial();

const setActiveBodySchema = z.object({ isActive: z.boolean() });

const sampleImageBodySchema = z.object({
  /**
   * Spec 65.16 V1.7 #3 — optional per-test preset override for the sample
   * render. `null` / `undefined` means "use the resolved cascade"
   * (definition override → project default). An explicit preset key
   * short-circuits the cascade so Marcel can preview a preset he hasn't
   * committed to yet.
   */
  presetOverride: z
    .enum(["dark-neon-grid", "light-editorial", "blue-tech-gradient"])
    .nullable()
    .optional(),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const listQuerySchema = z.object({
  formatType: z.string().min(1).optional(),
  includeInactive: z.coerce.boolean().optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loadProject(slug: string) {
  const [project] = await db
    .select({
      id: projects.id,
      slug: projects.slug,
      // Spec 65.16 V1.7 #3 — project-default preset for sample-render cascade.
      socialImageStylePreset: projects.socialImageStylePreset,
    })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return project ?? null;
}

/**
 * Resolve a definition by id AND verify it belongs to the project. Returns
 * the row when it matches, `null` when it doesn't exist or belongs to a
 * different project (treated as 404 to avoid existence-leaks).
 */
async function loadOwnedDefinition(definitionId: string, projectId: string) {
  const def = await getRecurringDefinition(definitionId);
  if (!def || def.projectId !== projectId) return null;
  return def;
}

// ─── GET /:slug/recurring-content/definitions ────────────────────────────────

recurringContentDefinitionsRoutes.get(
  "/:slug/recurring-content/definitions",
  zValidator("query", listQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const filters: Parameters<typeof listRecurringDefinitions>[0] = {
      projectId: project.id,
      includeInactive: q.includeInactive ?? true,
    };
    if (q.formatType) filters.formatType = q.formatType;

    const definitions = await listRecurringDefinitions(filters);
    return c.json({ ok: true, data: { definitions } });
  },
);

// ─── GET /:slug/recurring-content/definitions/format-types ───────────────────
// Static metadata endpoint that the Wizard reads to populate the picker step
// (visual cards) — surfaces the 5 v1 format-types registered in
// `FORMAT_TYPES` without leaking the Zod schema internals.

recurringContentDefinitionsRoutes.get(
  "/:slug/recurring-content/definitions/format-types",
  async (c) => {
    const slug = c.req.param("slug");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const types = Object.entries(FORMAT_TYPES).map(([key, def]) => ({
      key,
      family: def.family,
      eligibleTemplates: def.eligibleTemplates,
      needsHooks: def.needsHooks,
      defaultEndSlides: def.defaultEndSlides,
    }));
    return c.json({ ok: true, data: { formatTypes: types } });
  },
);

// ─── POST /:slug/recurring-content/definitions ───────────────────────────────

recurringContentDefinitionsRoutes.post(
  "/:slug/recurring-content/definitions",
  zValidator("json", createDefinitionBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    // Per-format-type config validation.
    const cfgResult = validateFormatConfig(body.formatType, body.formatConfig);
    if (!cfgResult.ok) {
      return c.json(
        {
          ok: false,
          error: "Invalid format_config",
          details: cfgResult.error,
        },
        422,
      );
    }

    // Fixed strategy requires fixed_template_key. (lru/llm-picks/latest pick
    // the template at brief-generation time.)
    if (body.templateSelectionStrategy === "fixed" && !body.fixedTemplateKey) {
      return c.json(
        {
          ok: false,
          error: "templateSelectionStrategy='fixed' requires fixedTemplateKey",
        },
        422,
      );
    }

    const nextRunAt = body.nextRunAt ?? new Date();
    const insertValues: Parameters<typeof createRecurringDefinition>[0] = {
      projectId: project.id,
      name: body.name,
      formatType: body.formatType,
      formatConfig: body.formatConfig,
      frequency: body.frequency,
      nextRunAt,
      outputTargets: body.outputTargets,
      templateSelectionStrategy: body.templateSelectionStrategy,
      endSlideStrategy: body.endSlideStrategy,
      endSlidePool: body.endSlidePool,
      isActive: body.isActive,
    };
    if (body.fixedTemplateKey) insertValues.fixedTemplateKey = body.fixedTemplateKey;
    if (body.autoApproveOverride !== undefined)
      insertValues.autoApproveOverride = body.autoApproveOverride;
    if (body.socialImageStylePresetOverride !== undefined)
      insertValues.socialImageStylePresetOverride = body.socialImageStylePresetOverride;

    const created = await createRecurringDefinition(insertValues);
    log.info(
      { projectSlug: slug, definitionId: created.id, formatType: body.formatType },
      "recurring-definition created",
    );
    return c.json({ ok: true, data: { definition: created } }, 201);
  },
);

// ─── GET /:slug/recurring-content/definitions/:id ────────────────────────────

recurringContentDefinitionsRoutes.get(
  "/:slug/recurring-content/definitions/:id",
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const def = await loadOwnedDefinition(id, project.id);
    if (!def) return c.json({ ok: false, error: "Definition not found" }, 404);
    return c.json({ ok: true, data: { definition: def } });
  },
);

// ─── PATCH /:slug/recurring-content/definitions/:id ──────────────────────────

recurringContentDefinitionsRoutes.patch(
  "/:slug/recurring-content/definitions/:id",
  zValidator("json", patchDefinitionBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const existing = await loadOwnedDefinition(id, project.id);
    if (!existing) return c.json({ ok: false, error: "Definition not found" }, 404);

    // If formatType OR formatConfig changes, re-validate against the
    // (possibly new) per-format-type schema. We re-validate even when only
    // one of the two changes because format_config shape is keyed by format
    // type — a stale config blob under a new type would fail at brief-time.
    if (body.formatConfig !== undefined || body.formatType !== undefined) {
      const cfgResult = validateFormatConfig(
        body.formatType ?? existing.formatType,
        body.formatConfig ?? existing.formatConfig,
      );
      if (!cfgResult.ok) {
        return c.json(
          { ok: false, error: "Invalid format_config", details: cfgResult.error },
          422,
        );
      }
    }

    // Strip undefined fields — Zod's partial-schema infers `field?: T |
    // undefined` but Drizzle's `Partial<NewX>` under
    // `exactOptionalPropertyTypes` rejects the explicit undefined. The
    // canonical helper pattern from packages/db CLAUDE.md.
    type DefinitionPatch = Partial<
      Parameters<typeof updateRecurringDefinition>[1]
    >;
    const patch = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    ) as DefinitionPatch;
    const updated = await updateRecurringDefinition(id, patch);
    if (!updated) return c.json({ ok: false, error: "Definition not found" }, 404);
    return c.json({ ok: true, data: { definition: updated } });
  },
);

// ─── PATCH /:slug/recurring-content/definitions/:id/active ───────────────────

recurringContentDefinitionsRoutes.patch(
  "/:slug/recurring-content/definitions/:id/active",
  zValidator("json", setActiveBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const existing = await loadOwnedDefinition(id, project.id);
    if (!existing) return c.json({ ok: false, error: "Definition not found" }, 404);

    await setRecurringDefinitionActive(id, body.isActive);
    log.info(
      { projectSlug: slug, definitionId: id, isActive: body.isActive },
      "recurring-definition active flag updated",
    );
    return c.json({ ok: true, data: { isActive: body.isActive } });
  },
);

// ─── POST /:slug/recurring-content/definitions/:id/run-now ───────────────────

recurringContentDefinitionsRoutes.post(
  "/:slug/recurring-content/definitions/:id/run-now",
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const def = await loadOwnedDefinition(id, project.id);
    if (!def) return c.json({ ok: false, error: "Definition not found" }, 404);
    if (!def.isActive) {
      return c.json({ ok: false, error: "Cannot Run-Now on inactive definition" }, 409);
    }

    const { jobId } = await enqueueRecurringBriefGenerator({
      definitionId: id,
      projectId: project.id,
      forceImmediate: true,
    });
    log.info(
      { projectSlug: slug, definitionId: id, jobId },
      "recurring-definition Run-Now enqueued",
    );
    return c.json({ ok: true, data: { status: "enqueued", jobId } }, 202);
  },
);

// ─── POST /:slug/recurring-content/definitions/:id/dry-run ───────────────────

recurringContentDefinitionsRoutes.post(
  "/:slug/recurring-content/definitions/:id/dry-run",
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const def = await loadOwnedDefinition(id, project.id);
    if (!def) return c.json({ ok: false, error: "Definition not found" }, 404);

    // Spec 65.V1.5b — pre-flight budget gate. Dry-runs are full LLM-cost
    // (~20-30 cents each); a monthly cap prevents Marcel-clicking from
    // accidentally draining the budget while debugging a definition.
    const DRY_RUN_EXPECTED_COST_CENTS = 25;
    const budgetState = await checkBudgetAvailable({
      projectId: project.id,
      budgetType: "dry_run",
      expectedCostCents: DRY_RUN_EXPECTED_COST_CENTS,
    });
    if (!budgetState.allowed) {
      log.warn(
        {
          projectSlug: slug,
          definitionId: id,
          consumed: budgetState.consumed,
          limit: budgetState.limit,
        },
        "dry-run rejected: monthly budget exhausted",
      );
      return c.json(
        {
          ok: false,
          error: "dry_run_budget_exceeded",
          consumed: budgetState.consumed,
          limit: budgetState.limit,
          currentMonth: budgetState.currentMonth,
          message: `Monthly dry-run budget of €${(budgetState.limit / 100).toFixed(2)} consumed (€${(budgetState.consumed / 100).toFixed(2)}). Wait until next month or raise the limit.`,
        },
        429,
      );
    }

    log.info(
      { projectSlug: slug, definitionId: id },
      "recurring-definition dry-run started",
    );
    try {
      const result = await runDryRunForDefinition({
        definitionId: id,
        projectId: project.id,
      });
      // Always record the expected cost — even when the dry-run short-circuits
      // (skip path) it still consumed Haiku-curate calls before bailing. Using
      // the constant keeps accounting predictable; finer per-stage accounting
      // is a V1.6 optimisation if Marcel asks for it.
      await recordBudgetConsumption({
        projectId: project.id,
        budgetType: "dry_run",
        actualCostCents: DRY_RUN_EXPECTED_COST_CENTS,
      });
      log.info(
        { projectSlug: slug, definitionId: id, status: result.status },
        "recurring-definition dry-run finished",
      );
      return c.json({ ok: true, data: { result } });
    } catch (err) {
      log.error(
        { projectSlug: slug, definitionId: id, err: err instanceof Error ? err.message : String(err) },
        "recurring-definition dry-run failed",
      );
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : "Dry-run failed" },
        500,
      );
    }
  },
);

// ─── POST /:slug/recurring-content/definitions/:id/sample-image (Spec 65.16 V1.7 #3)
//
// Fires ONE NB2 image-gen with the resolved preset + a fixed editorial
// scene so Marcel can preview each preset's signature visual language
// without waiting for the next real cron-fire. Reuses the `dry_run`
// monthly budget bucket (similar ~€0.25/click cost shape).

recurringContentDefinitionsRoutes.post(
  "/:slug/recurring-content/definitions/:id/sample-image",
  zValidator("json", sampleImageBodySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const def = await loadOwnedDefinition(id, project.id);
    if (!def) return c.json({ ok: false, error: "Definition not found" }, 404);

    // Reuse the dry-run budget — sample-renders are similar cost-shape
    // (~€0.25 per click), and a separate budget type would need a migration
    // + UI. The €5/month default covers ~20 clicks; Marcel can raise via
    // the Settings UI Budget editor.
    const SAMPLE_IMAGE_EXPECTED_COST_CENTS = 25;
    const budgetState = await checkBudgetAvailable({
      projectId: project.id,
      budgetType: "dry_run",
      expectedCostCents: SAMPLE_IMAGE_EXPECTED_COST_CENTS,
    });
    if (!budgetState.allowed) {
      log.warn(
        {
          projectSlug: slug,
          definitionId: id,
          consumed: budgetState.consumed,
          limit: budgetState.limit,
        },
        "sample-image rejected: monthly budget exhausted",
      );
      return c.json(
        {
          ok: false,
          error: "sample_image_budget_exceeded",
          consumed: budgetState.consumed,
          limit: budgetState.limit,
          currentMonth: budgetState.currentMonth,
          message: `Monthly sample-render budget of €${(budgetState.limit / 100).toFixed(2)} consumed (€${(budgetState.consumed / 100).toFixed(2)}). Wait until next month or raise the limit.`,
        },
        429,
      );
    }

    // Resolve the preset via the canonical 3-tier cascade (content-level =
    // body.presetOverride > definition.socialImageStylePresetOverride >
    // project.socialImageStylePreset). The helper handles all null-fallback
    // semantics.
    const preset = resolveImageStylePreset({
      projectDefault: project.socialImageStylePreset,
      definitionOverride: def.socialImageStylePresetOverride,
      contentLevelChoice: body.presetOverride ?? null,
    });

    log.info(
      { projectSlug: slug, definitionId: id, preset },
      "recurring-definition sample-image started",
    );
    try {
      const result = await renderSampleImage({
        projectId: project.id,
        projectSlug: slug,
        definitionId: id,
        preset,
      });
      // Record consumption (same posture as dry-run — even if rendering
      // partially fails inside the adapter, Gemini API calls were made and
      // billed; the upper-bound is the safe accounting figure).
      await recordBudgetConsumption({
        projectId: project.id,
        budgetType: "dry_run",
        actualCostCents: SAMPLE_IMAGE_EXPECTED_COST_CENTS,
      });
      log.info(
        { projectSlug: slug, definitionId: id, preset, r2Key: result.r2Key },
        "recurring-definition sample-image finished",
      );
      return c.json({ ok: true, data: { result } });
    } catch (err) {
      log.error(
        { projectSlug: slug, definitionId: id, preset, err: err instanceof Error ? err.message : String(err) },
        "recurring-definition sample-image failed",
      );
      return c.json(
        { ok: false, error: err instanceof Error ? err.message : "Sample-image failed" },
        500,
      );
    }
  },
);

// ─── GET /:slug/recurring-content/definitions/:id/history ────────────────────

recurringContentDefinitionsRoutes.get(
  "/:slug/recurring-content/definitions/:id/history",
  zValidator("query", historyQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const q = c.req.valid("query");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const def = await loadOwnedDefinition(id, project.id);
    if (!def) return c.json({ ok: false, error: "Definition not found" }, 404);

    const [items, total] = await Promise.all([
      listTopicBriefsByRecurringDefinitionId({
        projectId: project.id,
        definitionId: id,
        limit: q.limit,
        offset: q.offset,
      }),
      countTopicBriefsByRecurringDefinitionId({
        projectId: project.id,
        definitionId: id,
      }),
    ]);

    return c.json({
      ok: true,
      data: { items, total, limit: q.limit, offset: q.offset },
    });
  },
);

// ─── GET /:slug/recurring-content/definitions/:id/upcoming ───────────────────
// Returns the next N upcoming runs computed from `definition.frequency`.
// Pure derivation (no DB writes) — used by the Detail page Calendar tab.

const upcomingQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(20).default(4),
});

recurringContentDefinitionsRoutes.get(
  "/:slug/recurring-content/definitions/:id/upcoming",
  zValidator("query", upcomingQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const id = c.req.param("id");
    const q = c.req.valid("query");
    const project = await loadProject(slug);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);
    const def = await loadOwnedDefinition(id, project.id);
    if (!def) return c.json({ ok: false, error: "Definition not found" }, 404);

    const upcoming: Date[] = [];
    let cursor = def.nextRunAt;
    const now = new Date();
    // If next_run_at is already past, walk forward until we land in the
    // future — Marcel may have a definition with stale next_run_at because
    // the cron last fired before he updated the frequency.
    while (cursor < now) {
      cursor = computeNextRun(def.frequency, cursor);
    }
    upcoming.push(cursor);
    for (let i = 1; i < q.count; i++) {
      const prev = upcoming[upcoming.length - 1];
      if (!prev) break;
      upcoming.push(computeNextRun(def.frequency, prev));
    }

    return c.json({ ok: true, data: { upcoming } });
  },
);
