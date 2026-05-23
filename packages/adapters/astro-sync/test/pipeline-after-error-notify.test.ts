/**
 * Spec multi-domain-evolution S1.3 — notification fan-out for boundary
 * validation failures. Verifies that `ArticleSyncPipeline.afterError`
 * fires a notification with type `astro_sync_validation`, severity
 * `critical`, and the structured `failures[]` array preserved inside
 * `metadata.failures` so the future UI can render the per-field detail.
 *
 * Generic errors (non-validation) still fire the legacy `sync_failure`
 * notification type — covered by the third test.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, eq, notifications, users } from "@marketing-auto/db";
import { AstroSyncValidationError } from "../src/errors.ts";
import { ArticleSyncPipeline } from "../src/pipeline.ts";

// The pipeline fires createNotification() as `void` (fire-and-forget) — the DB
// INSERT happens off the await chain, so we poll a few times before asserting.
async function waitForNotification(userId: string, maxMs = 1500): Promise<typeof notifications.$inferSelect | undefined> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .limit(1);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return undefined;
}

describe("ArticleSyncPipeline.afterError notification fan-out (Spec multi-domain-evolution S1.3)", () => {
  const articleId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  let ownerUserId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: `s13-test-${Date.now()}@example.test`,
        role: "owner",
      })
      .returning();
    ownerUserId = user!.id;
  });

  afterAll(async () => {
    await db.delete(notifications).where(eq(notifications.userId, ownerUserId));
    await db.delete(users).where(eq(users.id, ownerUserId));
  });

  it("fires astro_sync_validation notification with structured failures payload", async () => {
    const pipeline = new ArticleSyncPipeline();
    const err = new AstroSyncValidationError({
      articleId,
      collection: "blog",
      failures: [
        {
          fieldPath: "category",
          expected: "one of ['Guides & Tutorials', 'Vergleiche']",
          actual: "Random-Bad-Value",
          reason: "enum_mismatch",
        },
        {
          fieldPath: "heroImage",
          expected: "string",
          actual: "",
          reason: "missing_required",
        },
      ],
    });

    await pipeline.afterError(err, { articleId, projectId });

    const row = await waitForNotification(ownerUserId);

    expect(row).toBeDefined();
    expect(row?.type).toBe("astro_sync_validation");
    expect(row?.severity).toBe("critical");
    expect(row?.title).toContain("Astro-Sync blocked");
    expect(row?.title).toContain("blog");
    expect(row?.message).toContain("category");
    expect(row?.message).toContain("enum_mismatch");
    expect(row?.message).toContain("heroImage");
    expect(row?.message).toContain("missing_required");
    expect(row?.link).toBe(`/articles/${articleId}`);
    const meta = row?.metadata as { articleId: string; collection: string; failures: unknown[] };
    expect(meta.articleId).toBe(articleId);
    expect(meta.collection).toBe("blog");
    expect(meta.failures).toHaveLength(2);
  });

  it("truncates very long failure lists to fit within 500-char message column", async () => {
    // Pre-clean prior test's notification rows for this user
    await db.delete(notifications).where(eq(notifications.userId, ownerUserId));

    const pipeline = new ArticleSyncPipeline();
    const manyFailures = Array.from({ length: 50 }, (_, i) => ({
      fieldPath: `field${i}`,
      expected: "string",
      actual: `value-${i}-${"x".repeat(40)}`,
      reason: "type_mismatch" as const,
    }));
    const err = new AstroSyncValidationError({
      articleId,
      collection: "tools",
      failures: manyFailures,
    });
    await pipeline.afterError(err, { articleId, projectId });

    const row = await waitForNotification(ownerUserId);

    expect(row).toBeDefined();
    expect(row?.message.length).toBeLessThanOrEqual(500);
    // Full failures array is preserved in metadata even when message is truncated
    const meta = row?.metadata as { failures: unknown[] };
    expect(meta.failures).toHaveLength(50);
  });

  it("falls through to legacy sync_failure notification for non-validation errors", async () => {
    await db.delete(notifications).where(eq(notifications.userId, ownerUserId));

    const pipeline = new ArticleSyncPipeline();
    const genericError = new Error("Github API returned 500");
    await pipeline.afterError(genericError, { articleId, projectId });

    const row = await waitForNotification(ownerUserId);

    expect(row).toBeDefined();
    expect(row?.type).toBe("sync_failure");
    expect(row?.title).toBe("Astro-Sync failed");
    expect(row?.message).toContain("Github API returned 500");
  });
});
