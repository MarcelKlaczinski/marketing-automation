import { zValidator } from "@hono/zod-validator";
import { clusters, contentPillars, db, projects } from "@marketing-auto/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";

export const pillarRoutes = new Hono();
pillarRoutes.use(requireAuth);

// GET /api/pillars?projectSlug=foo
pillarRoutes.get("/", async (c) => {
  const projectSlug = c.req.query("projectSlug");
  if (!projectSlug) return c.json({ ok: false, error: "projectSlug required" }, 400);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const rows = await db
    .select({
      id: contentPillars.id,
      name: contentPillars.name,
      description: contentPillars.description,
      position: contentPillars.position,
      createdAt: contentPillars.createdAt,
      clusterCount: sql<number>`coalesce(count(${clusters.id}), 0)::int`,
    })
    .from(contentPillars)
    .leftJoin(clusters, eq(clusters.pillarId, contentPillars.id))
    .where(eq(contentPillars.projectId, project.id))
    .groupBy(contentPillars.id)
    .orderBy(asc(contentPillars.position), asc(contentPillars.createdAt));

  return c.json({ ok: true, data: rows });
});

// POST /api/pillars
const createPillarSchema = z.object({
  projectSlug: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
});

pillarRoutes.post("/", zValidator("json", createPillarSchema), async (c) => {
  const input = c.req.valid("json");

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, input.projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const [maxPos] = await db
    .select({ max: sql<number>`coalesce(max(${contentPillars.position}), -1)::int` })
    .from(contentPillars)
    .where(eq(contentPillars.projectId, project.id));

  const insertValues: typeof contentPillars.$inferInsert = {
    projectId: project.id,
    name: input.name.trim(),
    position: (maxPos?.max ?? -1) + 1,
  };
  if (input.description !== undefined) insertValues.description = input.description?.trim() || null;

  const [created] = await db.insert(contentPillars).values(insertValues).returning();

  return c.json({ ok: true, data: created }, 201);
});

// PATCH /api/pillars/:id
const updatePillarSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
});

pillarRoutes.patch("/:id", zValidator("json", updatePillarSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const [existing] = await db
    .select({ id: contentPillars.id })
    .from(contentPillars)
    .where(eq(contentPillars.id, id))
    .limit(1);
  if (!existing) return c.json({ ok: false, error: "Pillar not found" }, 404);

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.description !== undefined) updates.description = input.description?.trim() || null;

  if (Object.keys(updates).length > 0) {
    await db.update(contentPillars).set(updates).where(eq(contentPillars.id, id));
  }

  const [updated] = await db
    .select()
    .from(contentPillars)
    .where(eq(contentPillars.id, id))
    .limit(1);
  return c.json({ ok: true, data: updated });
});

// DELETE /api/pillars/:id — returns 409 if pillar has clusters
pillarRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const [pillar] = await db
    .select({ id: contentPillars.id, name: contentPillars.name })
    .from(contentPillars)
    .where(eq(contentPillars.id, id))
    .limit(1);
  if (!pillar) return c.json({ ok: false, error: "Pillar not found" }, 404);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clusters)
    .where(eq(clusters.pillarId, id));
  const count = countResult[0]?.count ?? 0;

  if (count > 0) {
    return c.json({ ok: false, error: "pillar_has_clusters", data: { clusterCount: count } }, 409);
  }

  await db.delete(contentPillars).where(eq(contentPillars.id, id));
  return c.json({ ok: true, data: { id } });
});

// POST /api/pillars/:id/move — swap position with neighbour
const movePillarSchema = z.object({
  direction: z.enum(["up", "down"]),
});

pillarRoutes.post("/:id/move", zValidator("json", movePillarSchema), async (c) => {
  const id = c.req.param("id");
  const { direction } = c.req.valid("json");

  const [pillar] = await db.select().from(contentPillars).where(eq(contentPillars.id, id)).limit(1);
  if (!pillar) return c.json({ ok: false, error: "Pillar not found" }, 404);

  const neighbour =
    direction === "up"
      ? await db
          .select()
          .from(contentPillars)
          .where(
            and(
              eq(contentPillars.projectId, pillar.projectId),
              sql`${contentPillars.position} < ${pillar.position}`
            )
          )
          .orderBy(desc(contentPillars.position))
          .limit(1)
      : await db
          .select()
          .from(contentPillars)
          .where(
            and(
              eq(contentPillars.projectId, pillar.projectId),
              sql`${contentPillars.position} > ${pillar.position}`
            )
          )
          .orderBy(asc(contentPillars.position))
          .limit(1);

  if (neighbour.length === 0) {
    return c.json({ ok: true, data: { changed: false } });
  }

  const targetPos = neighbour[0]!.position;
  const sourcePos = pillar.position;

  await db.transaction(async (tx) => {
    await tx.update(contentPillars).set({ position: -1 }).where(eq(contentPillars.id, pillar.id));
    await tx
      .update(contentPillars)
      .set({ position: sourcePos })
      .where(eq(contentPillars.id, neighbour[0]!.id));
    await tx
      .update(contentPillars)
      .set({ position: targetPos })
      .where(eq(contentPillars.id, pillar.id));
  });

  return c.json({ ok: true, data: { changed: true } });
});
