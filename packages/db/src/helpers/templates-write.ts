/**
 * Spec 65.0 — Template Engine write helpers.
 *
 * Pure DB layer. Knows nothing about the filesystem watcher or Remotion;
 * callers (apps/api/src/lib/template-registry-sync.ts) hand it
 * pre-computed specs.
 */
import { db } from "../client.ts";
import { templates, type Template } from "../schema/templates.ts";
import { and, eq, isNull, sql } from "drizzle-orm";

/**
 * Specification for one template that the caller wants reflected in the DB.
 * Mirrors the columns the syncing code can know at registration time;
 * `lastSeenAt` / `usageCount` etc. are managed by the helpers themselves.
 */
export interface TemplateSyncSpec {
  templateKey: string;
  baseTemplateKey: string;
  variant: string | null;
  filePath: string;
  fileHash: string;
  formatTypes: string[];
  outputFormat: string;
  compatibleChannels: string[];
  generationClass: string;
  displayName: string;
  description: string;
  defaultSlideCount: number;
  estimatedCostUsd: number;
}

export interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
  deactivated: number;
}

/**
 * UPSERT one template row scoped to `projectId` (or global when null).
 *
 * Conflict-target uses the partial unique index
 * `templates_active_key_per_project_uniq` — must mirror its WHERE clause via
 * `targetWhere` so PostgreSQL picks the right index (Memory D108).
 *
 * Returns the row after upsert plus a `changed` flag indicating whether the
 * row's `file_hash` differs from what we just wrote (i.e. file content
 * actually moved). When the row was inserted fresh, `changed` is `true`.
 */
export async function upsertTemplate(
  spec: TemplateSyncSpec,
  projectId: string | null,
): Promise<{ row: Template; status: "added" | "updated" | "unchanged" }> {
  // Use a SELECT-then-INSERT/UPDATE transaction because Drizzle's
  // onConflictDoUpdate composite-key targets are awkward with a nullable
  // `project_id`. SELECT-then-write is cheap (single-row PK lookup) and lets
  // us classify add-vs-update precisely.
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(templates)
      .where(
        and(
          projectId === null
            ? isNull(templates.projectId)
            : eq(templates.projectId, projectId),
          eq(templates.templateKey, spec.templateKey),
          eq(templates.isActive, true),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      const [inserted] = await tx
        .insert(templates)
        .values({
          projectId,
          templateKey: spec.templateKey,
          baseTemplateKey: spec.baseTemplateKey,
          variant: spec.variant,
          filePath: spec.filePath,
          fileHash: spec.fileHash,
          formatTypes: spec.formatTypes,
          outputFormat: spec.outputFormat,
          compatibleChannels: spec.compatibleChannels,
          generationClass: spec.generationClass,
          displayName: spec.displayName,
          description: spec.description,
          defaultSlideCount: spec.defaultSlideCount,
          estimatedCostUsd: String(spec.estimatedCostUsd),
          lastSeenAt: new Date(),
        })
        .returning();
      if (!inserted) throw new Error(`Failed to insert template ${spec.templateKey}`);
      return { row: inserted, status: "added" as const };
    }

    const prior = existing[0];
    if (!prior) throw new Error("unreachable");
    const unchanged = prior.fileHash === spec.fileHash
      && prior.displayName === spec.displayName
      && prior.description === spec.description
      && prior.outputFormat === spec.outputFormat
      && prior.generationClass === spec.generationClass
      && prior.defaultSlideCount === spec.defaultSlideCount
      && prior.baseTemplateKey === spec.baseTemplateKey
      && prior.variant === spec.variant
      && prior.filePath === spec.filePath;

    if (unchanged) {
      // Touch last_seen_at only, leave content fields alone.
      const [touched] = await tx
        .update(templates)
        .set({ lastSeenAt: new Date() })
        .where(eq(templates.id, prior.id))
        .returning();
      return { row: touched ?? prior, status: "unchanged" as const };
    }

    const [updated] = await tx
      .update(templates)
      .set({
        baseTemplateKey: spec.baseTemplateKey,
        variant: spec.variant,
        filePath: spec.filePath,
        fileHash: spec.fileHash,
        formatTypes: spec.formatTypes,
        outputFormat: spec.outputFormat,
        compatibleChannels: spec.compatibleChannels,
        generationClass: spec.generationClass,
        displayName: spec.displayName,
        description: spec.description,
        defaultSlideCount: spec.defaultSlideCount,
        estimatedCostUsd: String(spec.estimatedCostUsd),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(templates.id, prior.id))
      .returning();
    if (!updated) throw new Error(`Failed to update template ${spec.templateKey}`);
    return { row: updated, status: "updated" as const };
  });
}

/**
 * Sweep: any active row scoped to `projectId` whose template_key is NOT in
 * `keptKeys` is marked `is_active=false`. Returns the count of rows
 * deactivated. Audit-trail rows survive — never DELETEd.
 */
export async function deactivateMissingTemplates(opts: {
  projectId: string | null;
  keptKeys: string[];
}): Promise<number> {
  const { projectId, keptKeys } = opts;
  // Empty keptKeys ⇒ deactivate everything in scope. Use ARRAY[]::text[] for
  // a defensive empty literal so the `<> ALL` predicate matches all rows.
  const keepLiteral = keptKeys.length === 0
    ? sql`ARRAY[]::text[]`
    : sql`ARRAY[${sql.join(keptKeys.map((k) => sql`${k}`), sql`, `)}]::text[]`;

  const rows = await db
    .update(templates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        projectId === null
          ? isNull(templates.projectId)
          : eq(templates.projectId, projectId),
        eq(templates.isActive, true),
        sql`${templates.templateKey} <> ALL(${keepLiteral})`,
      ),
    )
    .returning({ id: templates.id });
  return rows.length;
}

/**
 * High-level orchestrator: UPSERT every spec + deactivate any active rows in
 * scope that aren't in the spec list. Idempotent — safe to call on every API
 * startup tick.
 */
export async function syncTemplatesBatch(opts: {
  projectId: string | null;
  specs: TemplateSyncSpec[];
}): Promise<SyncResult> {
  const result: SyncResult = { added: 0, updated: 0, unchanged: 0, deactivated: 0 };
  for (const spec of opts.specs) {
    const { status } = await upsertTemplate(spec, opts.projectId);
    if (status === "added") result.added += 1;
    else if (status === "updated") result.updated += 1;
    else result.unchanged += 1;
  }
  result.deactivated = await deactivateMissingTemplates({
    projectId: opts.projectId,
    keptKeys: opts.specs.map((s) => s.templateKey),
  });
  return result;
}

/**
 * Atomic usage tracking: bump `usage_count`, stamp `last_used_at`. Fire-and-
 * forget from the render hot-path (Spec 65.6 LRU consumer).
 */
export async function incrementTemplateUsage(opts: {
  projectId: string | null;
  templateKey: string;
}): Promise<void> {
  await db
    .update(templates)
    .set({
      usageCount: sql`${templates.usageCount} + 1`,
      lastUsedAt: new Date(),
    })
    .where(
      and(
        opts.projectId === null
          ? isNull(templates.projectId)
          : eq(templates.projectId, opts.projectId),
        eq(templates.templateKey, opts.templateKey),
        eq(templates.isActive, true),
      ),
    );
}
