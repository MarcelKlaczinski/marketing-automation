import { zValidator } from "@hono/zod-validator";
import {
  and,
  db,
  desc,
  eq,
  inArray,
  lt,
  projects,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import { Hono } from "hono";
import { z } from "zod";
import { getDomainRegistry } from "@marketing-auto/pipelines/domain-registry";
import { requireAuth } from "../../middleware/auth.ts";
import { approveBrief } from "../../lib/brief-service.ts";
import {
  BRIEF_SOURCES,
  type BriefSource,
  buildBriefsWhere,
  resolveBulkBriefIds,
} from "../../lib/brief-bulk-selector.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("briefs-route");

export const scopedBriefRoutes = new Hono();
scopedBriefRoutes.use(requireAuth);

// ─── Helper ───────────────────────────────────────────────────────────────────

async function resolveProject(slug: string): Promise<{ id: string } | null> {
  const [proj] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return proj ?? null;
}

// Spec 64.17: BRIEF_SOURCES + BriefSource + buildBriefsWhere now live in
// src/lib/brief-bulk-selector.ts so GET /briefs and the bulk-action filter-shape
// resolver share a single source of truth for filter→SQL translation.

// ─── GET /:slug/briefs ────────────────────────────────────────────────────────

const briefsListQuerySchema = z.object({
  section: z.enum(["pending", "in-flight", "done", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional(),
  // Comma-separated list of source values to filter by. Empty / absent = no filter.
  source: z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return undefined;
      const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
      const valid = parts.filter((p): p is BriefSource =>
        (BRIEF_SOURCES as readonly string[]).includes(p),
      );
      return valid.length > 0 ? valid : undefined;
    }),
  // Approve-readiness filter:
  //   ready       → primary_keyword is set OR source = comparison_discovery (no keyword needed)
  //   unready     → primary_keyword is NULL AND source != comparison_discovery
  //   plan_ready  → approval_status = 'plan_pending' (Spec 63.6: Marcel approved, awaiting Planner pickup)
  //   all/undef   → no filter
  readiness: z.enum(["ready", "unready", "plan_ready", "all"]).optional(),
});

scopedBriefRoutes.get(
  "/:slug/briefs",
  zValidator("query", briefsListQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");

    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const conditions = buildBriefsWhere(project.id, {
      section: q.section,
      ...(q.source !== undefined && { source: q.source }),
      ...(q.readiness !== undefined && { readiness: q.readiness }),
    });

    if (q.cursor) {
      conditions.push(lt(topicBriefs.createdAt, new Date(q.cursor)));
    }

    // Pending sorted by trend score desc; others by createdAt desc
    const orderBy =
      q.section === "pending"
        ? [
            desc(sql`COALESCE((${topicBriefs.trendMetadata}->>'trendScore')::numeric, 0)`),
            desc(topicBriefs.createdAt),
          ]
        : [desc(topicBriefs.createdAt)];

    const limit = q.limit;
    const rows = await db
      .select()
      .from(topicBriefs)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.createdAt.toISOString() : null; // safe: items is non-empty when hasMore=true (fetched limit+1)

    return c.json({
      ok: true,
      data: {
        section: q.section,
        items,
        nextCursor,
        hasMore,
        limit,
      },
    });
  },
);

// ─── GET /:slug/briefs/:briefId ──────────────────────────────────────────────

scopedBriefRoutes.get("/:slug/briefs/:briefId", async (c) => {
  const slug = c.req.param("slug");
  const briefId = c.req.param("briefId");

  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(and(eq(topicBriefs.id, briefId), eq(topicBriefs.projectId, project.id)))
    .limit(1);

  if (!brief) return c.json({ ok: false, error: "brief_not_found" }, 404);

  return c.json({ ok: true, data: { brief } });
});

// ─── Bulk-action selector schema (Spec 64.17) ────────────────────────────────
//
// Discriminated union: either an explicit briefIds array or a filter-shape that
// the server re-queries at action time (race-safety against cron tick between
// selection and submit). Cap of 500 on both shapes — soft safety bound; bulk
// status updates run in a single transaction per brief, no fan-out.

const filterShapeSchema = z.object({
  section: z.enum(["pending", "in-flight", "done", "all"]).default("pending"),
  source: z.array(z.enum(BRIEF_SOURCES)).optional(),
  readiness: z.enum(["ready", "unready", "plan_ready", "all"]).optional(),
});

const bulkBriefSelectorSchema = z.union([
  z.object({
    briefIds: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    filter: filterShapeSchema,
    excludeIds: z.array(z.string().uuid()).max(500).default([]),
  }),
]);

// ─── POST /:slug/briefs/bulk-approve ─────────────────────────────────────────

// Spec 63.6: `dispatch` defaults to 'plan' — the safer path that flips briefs
// to plan_pending and lets the weekly Planner pick them up under the 90% Budget
// Gate. `dispatch: 'immediate'` is the explicit Direct-Generate override (legacy
// behaviour: article-INSERT + pipeline-enqueue inline). `mode` is the older
// assist/auto field; both modes today drive identical server behaviour.
//
// Spec 64.17: selector widened to `briefIds[]` OR `{filter, excludeIds}`; cap 500.
const bulkApproveSchema = z.intersection(
  bulkBriefSelectorSchema,
  z.object({
    mode: z.enum(["assist", "auto"]).default("assist"),
    dispatch: z.enum(["plan", "immediate"]).default("plan"),
  }),
);

scopedBriefRoutes.post(
  "/:slug/briefs/bulk-approve",
  zValidator("json", bulkApproveSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const body = c.req.valid("json");
    const { mode, dispatch } = body;

    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const { briefIds, reQueried } = await resolveBulkBriefIds(project.id, body);

    if (briefIds.length === 0) {
      return c.json(
        {
          ok: true,
          data: {
            dispatch,
            reQueried,
            totalMatched: 0,
            total: 0,
            approvedCount: 0,
            planQueuedCount: 0,
            skippedCount: 0,
            failedCount: 0,
            results: { approved: [], planQueued: [], skipped: [], failed: [] },
          },
        },
        202,
      );
    }

    const results = {
      approved: [] as Array<{ briefId: string; runId: string; jobId: string }>,
      planQueued: [] as Array<{ briefId: string }>,
      skipped: [] as Array<{ briefId: string; reason: string }>,
      failed: [] as Array<{ briefId: string; error: string }>,
    };

    // Sequential processing — predictable cost ordering, prevents budget overshoot
    for (const briefId of briefIds) {
      try {
        const result = await approveBrief(briefId, project, dispatch);

        if (result.kind === "cluster_assignment_required") {
          results.skipped.push({ briefId, reason: "cluster_assignment_required" });
        } else if (result.kind === "skipped") {
          results.skipped.push({ briefId, reason: result.reason });
        } else if (result.kind === "plan_queued") {
          results.planQueued.push({ briefId });
        } else if (result.kind === "success") {
          results.approved.push({ briefId, runId: result.runId, jobId: result.jobId });
        } else {
          results.failed.push({ briefId, error: result.error });
        }
      } catch (err) {
        results.failed.push({
          briefId,
          error: err instanceof Error ? err.message : "unknown_error",
        });
      }
    }

    log.info(
      {
        slug,
        mode,
        dispatch,
        reQueried,
        total: briefIds.length,
        approved: results.approved.length,
        planQueued: results.planQueued.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
      },
      "bulk brief approve complete",
    );

    return c.json(
      {
        ok: true,
        data: {
          dispatch,
          reQueried,
          totalMatched: briefIds.length,
          total: briefIds.length,
          approvedCount: results.approved.length,
          planQueuedCount: results.planQueued.length,
          skippedCount: results.skipped.length,
          failedCount: results.failed.length,
          results,
        },
      },
      202,
    );
  },
);

// ─── POST /:slug/briefs/bulk-preflight-cluster-check (Spec 64.17) ───────────
//
// Pure read-only SQL aggregate. Returns the eligibility breakdown for both
// dispatch modes given the current brief set, so BulkApproveModal can warn
// before submit instead of letting Marcel discover skipped briefs after.
//
// Gates mirror approveBrief() in apps/api/src/lib/brief-service.ts:
//   plan-dispatch blocks ONLY: cluster_action='append_to_existing' AND cluster_id IS NULL
//   immediate-dispatch blocks: cluster_action='create_new' OR cluster_id IS NULL
// (No source-based special-case — the gate is source-agnostic; comparison
//  briefs without clusterId ARE blocked by immediate dispatch, by design.)

scopedBriefRoutes.post(
  "/:slug/briefs/bulk-preflight-cluster-check",
  zValidator("json", bulkBriefSelectorSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const { briefIds, reQueried } = await resolveBulkBriefIds(project.id, c.req.valid("json"));

    if (briefIds.length === 0) {
      return c.json({
        ok: true,
        data: {
          reQueried,
          totalMatched: 0,
          plan: { eligible: 0, needsCluster: 0 },
          immediate: { eligible: 0, needsCluster: 0 },
        },
      });
    }

    const [agg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        planNeedsCluster: sql<number>`count(*) FILTER (WHERE ${topicBriefs.clusterAction} = 'append_to_existing' AND ${topicBriefs.clusterId} IS NULL)::int`,
        immediateNeedsCluster: sql<number>`count(*) FILTER (WHERE ${topicBriefs.clusterAction} = 'create_new' OR ${topicBriefs.clusterId} IS NULL)::int`,
      })
      .from(topicBriefs)
      .where(and(eq(topicBriefs.projectId, project.id), inArray(topicBriefs.id, briefIds)));

    const total = agg?.total ?? 0;
    const planNeeds = agg?.planNeedsCluster ?? 0;
    const immediateNeeds = agg?.immediateNeedsCluster ?? 0;

    return c.json({
      ok: true,
      data: {
        reQueried,
        totalMatched: total,
        plan: { eligible: total - planNeeds, needsCluster: planNeeds },
        immediate: { eligible: total - immediateNeeds, needsCluster: immediateNeeds },
      },
    });
  },
);

// ─── Manual brief creation — shared types + endpoints (Spec 64.14 Phase C) ──
//
// `COLLECTION_HINTS` + `INTENT_TYPES` are the historical hardcoded taxonomy
// the POST schema accepts. Both endpoints below read from them:
//   - GET /brief-options uses them as the FALLBACK list when the project
//     has no registered DomainSpec (registry returns null)
//   - POST /briefs uses them via z.enum(...) for backward-compatible
//     validation. Per-tenant variation is enforced AFTER schema parse by
//     the registry-gate inside the handler.

const COLLECTION_HINTS = ["blog", "comparison", "ki-wissen", "cluster"] as const;
type CollectionHint = (typeof COLLECTION_HINTS)[number];

const INTENT_TYPES = [
  "knowledge",
  "tutorial",
  "use_case",
  "comparison",
  "review",
  "news",
  "best_practices",
  "alternatives",
  "pricing",
  "risks",
] as const;

// ─── GET /:slug/brief-options (Domain-Registry follow-up) ───────────────────
//
// Spec multi-domain-evolution Domain-Registry follow-up — exposes the dynamic
// taxonomy from the project's DomainSpec so the BriefCreatePage dropdowns can
// be populated per-tenant instead of hardcoded against the Toolwiki shape.
// When the registry returns null (project's targetNiche missing OR DomainSpec
// not shipped), the response falls back to the same hardcoded taxonomy the
// POST endpoint accepts — preserves zero-regression for any legacy project.
//
// Note: `"cluster"` is a planner pseudo-collection (Spec 62.4) and not in any
// DomainSpec's `collections` allow-list. It's always appended to the
// `collectionHints` response so the planner-routed `create_new` cluster brief
// path stays available regardless of which DomainSpec is registered. Same for
// the legacy fallback list.

scopedBriefRoutes.get("/:slug/brief-options", async (c) => {
  const slug = c.req.param("slug");
  const project = await resolveProject(slug);
  if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

  const domainCtx = await getDomainRegistry().forProject(project.id);
  if (domainCtx) {
    const registryCollections = domainCtx.getAllowedCollections();
    // De-dupe in case a future DomainSpec ever registers "cluster" explicitly.
    const collectionHints = registryCollections.includes("cluster")
      ? [...registryCollections]
      : [...registryCollections, "cluster"];
    return c.json({
      ok: true,
      data: {
        source: "registry" as const,
        niche: domainCtx.niche,
        collectionHints,
        intentTypes: [...domainCtx.getIntentTaxonomy()],
        // Spec multi-domain-evolution Phase-C — surface the registered
        // collection→intent map so the frontend's auto-derive logic stays
        // a single source of truth with the backend. Empty map signals
        // "no per-tenant default, frontend should use its own fallback".
        collectionToIntentMap: { ...domainCtx.getCollectionToIntentMap() },
      },
    });
  }

  return c.json({
    ok: true,
    data: {
      source: "fallback" as const,
      niche: null,
      collectionHints: [...COLLECTION_HINTS],
      intentTypes: [...INTENT_TYPES],
      // Mirrors the legacy hardcoded `deriveIntentFromCollection` switch in
      // this same file. Frontend consumes this to auto-derive the intent
      // when the user changes collection. Kept in sync with the switch
      // statement by code review (no auto-import — the switch lives in a
      // separate function and TS can't widen from one to the other).
      collectionToIntentMap: {
        comparison: "comparison",
        "ki-wissen": "knowledge",
        blog: "use_case",
        cluster: "use_case",
      },
    },
  });
});

// ─── POST /:slug/briefs (Spec 64.14 Phase C — manual brief creation) ────────
//
// Marcel curates ki-wissen / blog topics that the LLM synthesizer doesn't find
// (e.g. "Was ist RAG?"). Brief lands as approval_status='pending' + source='manual'
// and shows up in the regular /briefs/pending list for approve via the existing
// plan-or-immediate dispatch flow. No pipeline is enqueued here — the brief
// goes through the same routing path as gap_analysis/trend_discovery briefs.
//
// Spec multi-domain-evolution Domain-Registry follow-up — the POST schema
// stays hardcoded to the historical Toolwiki shape so the contract is stable.
// The registry-gate below runs AFTER schema validation and rejects values that
// aren't in the project's DomainSpec allow-list (e.g. a BK frontend submitting
// `"ki-wissen"` against a project whose DomainSpec doesn't register that
// collection). `"cluster"` always passes the gate (planner pseudo-collection).

const manualBriefCreateSchema = z.object({
  topicTitle: z.string().min(10).max(200),
  primaryKeyword: z.string().min(2).max(80),
  collectionHint: z.enum(COLLECTION_HINTS),
  intentType: z.enum(INTENT_TYPES).optional(),
  description: z.string().max(500).optional(),
  locale: z.enum(["de", "en"]).default("de"),
});

/**
 * Derive intent_type from collection_hint when the user didn't pick one
 * explicitly. ki-wissen → knowledge is the load-bearing default (the spec's
 * primary use-case is curating knowledge briefs the synthesizer missed).
 *
 * Spec multi-domain-evolution Phase-C — accepts an optional registry-supplied
 * map (from `DomainContext.getCollectionToIntentMap()`). When a value exists
 * for the given collection, the registry wins. Otherwise we fall back to the
 * hardcoded 4-value Toolwiki switch — preserves zero-regression for legacy
 * projects (null registry) AND for tenants whose DomainSpec doesn't register
 * a map (the inline switch matches Toolwiki's registered map verbatim).
 */
function deriveIntentFromCollection(
  collection: CollectionHint,
  registryMap?: Readonly<Record<string, string>>,
): (typeof INTENT_TYPES)[number] {
  if (registryMap) {
    const mapped = registryMap[collection];
    // Cast is justified: the map's values are constrained to the tenant's
    // intentTaxonomy at registry-validation time (intent_not_in_registry
    // gate). Toolwiki's registered map uses only values from INTENT_TYPES,
    // so the cast is sound for it; other tenants take responsibility for
    // their own taxonomy alignment.
    if (mapped) return mapped as (typeof INTENT_TYPES)[number];
  }
  switch (collection) {
    case "comparison":
      return "comparison";
    case "ki-wissen":
      return "knowledge";
    case "blog":
    case "cluster":
      return "use_case";
  }
}

/**
 * cluster_action depends on the routing target (Spec 54.3 decideRoute is the
 * SSoT once the brief is approved). Manual briefs don't carry a clusterId, so:
 *   - "cluster" hint = "create_new" (planner will spawn a new cluster)
 *   - "comparison" hint = "comparison" (router enqueues article:blog comparison variant)
 *   - everything else = "standalone" (article lands without a cluster anchor)
 */
function deriveClusterAction(
  collection: CollectionHint,
): "create_new" | "comparison" | "standalone" {
  if (collection === "cluster") return "create_new";
  if (collection === "comparison") return "comparison";
  return "standalone";
}

scopedBriefRoutes.post(
  "/:slug/briefs",
  zValidator("json", manualBriefCreateSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const input = c.req.valid("json");

    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    // Spec multi-domain-evolution Domain-Registry follow-up — when the
    // project resolves to a registered DomainSpec, gate the submitted
    // collectionHint against its allow-list. "cluster" is the planner
    // pseudo-collection (Spec 62.4) and is always allowed. Legacy projects
    // (null registry) skip the gate entirely — back-compat.
    const domainCtx = await getDomainRegistry().forProject(project.id);
    if (domainCtx && input.collectionHint !== "cluster") {
      const allowed = domainCtx.getAllowedCollections();
      if (!allowed.includes(input.collectionHint)) {
        return c.json(
          {
            ok: false,
            error: "collection_not_in_registry",
            niche: domainCtx.niche,
            allowedCollections: [...allowed, "cluster"],
          },
          422,
        );
      }
      // Intent gate — only when caller supplied one explicitly. The derived
      // intent path uses `deriveIntentFromCollection` which is structurally
      // fine because all four derived values are in TOOLWIKI_BLOG_INTENT_TYPES.
      // A future DomainSpec that wants a different default for, say,
      // collectionHint="news" would extend `deriveIntentFromCollection` in
      // tandem with adding the value to its intentTaxonomy.
      if (input.intentType !== undefined) {
        const intents = domainCtx.getIntentTaxonomy();
        if (!intents.includes(input.intentType)) {
          return c.json(
            {
              ok: false,
              error: "intent_not_in_registry",
              niche: domainCtx.niche,
              allowedIntentTypes: [...intents],
            },
            422,
          );
        }
      }
    }

    // Spec multi-domain-evolution Phase-C — pass the registry-supplied map
    // (or undefined when the registry returned null). The helper falls back
    // to its own hardcoded switch when the map is undefined OR doesn't have
    // a key for the given collection.
    const intentType =
      input.intentType ??
      deriveIntentFromCollection(
        input.collectionHint,
        domainCtx?.getCollectionToIntentMap(),
      );
    const clusterAction = deriveClusterAction(input.collectionHint);

    const [brief] = await db
      .insert(topicBriefs)
      .values({
        projectId: project.id,
        source: "manual",
        topicTitle: input.topicTitle,
        primaryKeyword: input.primaryKeyword,
        secondaryKeywords: [],
        locale: input.locale,
        intentType,
        clusterAction,
        approvalStatus: "pending",
        approvalRequired: true,
        // Spec 64.14: surface the optional description as the suggested meta so
        // BriefDetailPage can render Marcel's intent context without a new column.
        ...(input.description !== undefined ? { suggestedMeta: input.description } : {}),
      })
      .returning();

    if (!brief) {
      log.error({ slug, topicTitle: input.topicTitle }, "manual brief insert returned no row");
      return c.json({ ok: false, error: "insert_failed" }, 500);
    }

    log.info(
      {
        slug,
        briefId: brief.id,
        collectionHint: input.collectionHint,
        intentType,
        clusterAction,
      },
      "manual brief created",
    );

    return c.json({ ok: true, data: { brief } }, 201);
  },
);

// ─── POST /:slug/briefs/bulk-dismiss ─────────────────────────────────────────
//
// Spec 64.17: selector widened to bulkBriefSelectorSchema (same shape as
// bulk-approve). Deliberate constraint: only flips approvalStatus='pending'
// rows — plan_pending briefs are Marcel-vouched (Spec 63.6) and must go
// through per-brief dismiss from the detail view to avoid misclick loss.
// A filter-shape selector with readiness=plan_ready will resolve plan_pending
// briefs that the UPDATE then refuses to touch; the response surfaces them
// as `skipped`.

scopedBriefRoutes.post(
  "/:slug/briefs/bulk-dismiss",
  zValidator("json", bulkBriefSelectorSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const project = await resolveProject(slug);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const { briefIds, reQueried } = await resolveBulkBriefIds(project.id, c.req.valid("json"));

    if (briefIds.length === 0) {
      return c.json({
        ok: true,
        data: { reQueried, totalMatched: 0, requested: 0, dismissed: 0, skipped: 0 },
      });
    }

    const updated = await db
      .update(topicBriefs)
      .set({ approvalStatus: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(topicBriefs.projectId, project.id),
          inArray(topicBriefs.id, briefIds),
          eq(topicBriefs.approvalStatus, "pending"),
        ),
      )
      .returning({ id: topicBriefs.id });

    log.info(
      { slug, reQueried, requested: briefIds.length, dismissed: updated.length },
      "bulk brief dismiss complete",
    );

    return c.json({
      ok: true,
      data: {
        reQueried,
        totalMatched: briefIds.length,
        requested: briefIds.length,
        dismissed: updated.length,
        skipped: briefIds.length - updated.length,
      },
    });
  },
);
