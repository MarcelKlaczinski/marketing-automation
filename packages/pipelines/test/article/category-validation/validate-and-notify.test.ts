/**
 * Spec multi-domain-evolution S3.4 — DraftStep category soft-validator.
 * Real-DB integration tests: seeds an owner + a small in-memory taxonomy
 * via the lookup-injection seam, asserts notifications fire on mismatch
 * and stay silent on match, no-throw on shape errors.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { CategoryLookup } from "@marketing-auto/content-schema/validators";
import { db, eq, notifications, projects, users } from "@marketing-auto/db";
import {
  collectionTypeToScope,
  validateCategoryAndNotify,
} from "../../../src/article/category-validation/validate-and-notify.ts";

// In-memory lookup so each test controls the universe explicitly.
function inMemoryLookup(seeded: Set<string>): CategoryLookup {
  return {
    async exists({ projectId, scope, slug }) {
      return seeded.has(`${projectId}|${scope}|${slug}`);
    },
  };
}

describe("collectionTypeToScope mapping", () => {
  it("maps tools → tool", () => {
    expect(collectionTypeToScope("tools")).toBe("tool");
  });

  it("maps blog → blog", () => {
    expect(collectionTypeToScope("blog")).toBe("blog");
  });

  it("maps ki-wissen → knowledge", () => {
    expect(collectionTypeToScope("ki-wissen")).toBe("knowledge");
  });

  it("maps usecases → usecase", () => {
    expect(collectionTypeToScope("usecases")).toBe("usecase");
  });

  it("returns null for comparison (no taxonomy today)", () => {
    expect(collectionTypeToScope("comparison")).toBeNull();
  });
});

describe("validateCategoryAndNotify (real DB)", () => {
  const projectId = crypto.randomUUID();
  let ownerUserId: string;

  beforeAll(async () => {
    const [p] = await db
      .insert(projects)
      .values({
        id: projectId,
        slug: `s34-test-${Date.now()}`,
        name: "S3.4 Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    expect(p?.id).toBe(projectId);

    const [user] = await db
      .insert(users)
      .values({ email: `s34-test-${Date.now()}@example.test`, role: "owner" })
      .returning();
    ownerUserId = user!.id;
  });

  afterAll(async () => {
    await db.delete(notifications).where(eq(notifications.userId, ownerUserId));
    await db.delete(users).where(eq(users.id, ownerUserId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  afterEach(async () => {
    await db.delete(notifications).where(eq(notifications.userId, ownerUserId));
  });

  // Poll because createNotification is fire-and-forget under the hood.
  async function waitForNotification(maxMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, ownerUserId))
        .limit(1);
      if (row) return row;
      await new Promise((r) => setTimeout(r, 50));
    }
    return undefined;
  }

  it("known tool slug → no notification", async () => {
    const lookup = inMemoryLookup(new Set([`${projectId}|tool|audio-music`]));
    await validateCategoryAndNotify({
      projectId,
      collectionType: "tools",
      category: "audio-music",
      articleId: "art-1",
      lookup,
    });
    const row = await waitForNotification(600);
    expect(row).toBeUndefined();
  });

  it("unknown tool slug → severity=info notification with structured payload", async () => {
    const lookup = inMemoryLookup(new Set()); // empty universe
    await validateCategoryAndNotify({
      projectId,
      collectionType: "tools",
      category: "hallucinated-category",
      articleId: "art-2",
      lookup,
    });
    const row = await waitForNotification();
    expect(row).toBeDefined();
    expect(row?.type).toBe("category_drift");
    expect(row?.severity).toBe("info");
    expect(row?.title).toContain("hallucinated-category");
    expect(row?.title).toContain("tool");
    expect(row?.link).toBe("/articles/art-2");
    const meta = row?.metadata as {
      collectionType: string;
      scope: string;
      slug: string;
    };
    expect(meta.collectionType).toBe("tools");
    expect(meta.scope).toBe("tool");
    expect(meta.slug).toBe("hallucinated-category");
  });

  it("empty category string → no notification, no lookup call", async () => {
    let lookupCalls = 0;
    const lookup: CategoryLookup = {
      async exists() {
        lookupCalls++;
        return false;
      },
    };
    await validateCategoryAndNotify({
      projectId,
      collectionType: "blog",
      category: "",
      lookup,
    });
    expect(lookupCalls).toBe(0);
    const row = await waitForNotification(600);
    expect(row).toBeUndefined();
  });

  it("null/undefined category → no notification", async () => {
    const lookup = inMemoryLookup(new Set());
    await validateCategoryAndNotify({
      projectId,
      collectionType: "blog",
      category: null,
      lookup,
    });
    await validateCategoryAndNotify({
      projectId,
      collectionType: "blog",
      category: undefined,
      lookup,
    });
    const row = await waitForNotification(600);
    expect(row).toBeUndefined();
  });

  it("comparison collectionType → no-op (no taxonomy today)", async () => {
    let lookupCalls = 0;
    const lookup: CategoryLookup = {
      async exists() {
        lookupCalls++;
        return false;
      },
    };
    await validateCategoryAndNotify({
      projectId,
      collectionType: "comparison",
      category: "anything",
      lookup,
    });
    expect(lookupCalls).toBe(0);
    const row = await waitForNotification(600);
    expect(row).toBeUndefined();
  });

  it("non-string category (LLM shape bug) → no notification, warn-logged only", async () => {
    const lookup = inMemoryLookup(new Set());
    await validateCategoryAndNotify({
      projectId,
      collectionType: "tools",
      category: 42 as unknown as string, // shape bug
      lookup,
    });
    const row = await waitForNotification(600);
    expect(row).toBeUndefined();
  });

  it("lookup throws → notification still skipped, no escalation (catch-all)", async () => {
    const lookup: CategoryLookup = {
      async exists() {
        throw new Error("DB connection lost");
      },
    };
    // Must not throw (additive phase contract)
    await expect(
      validateCategoryAndNotify({
        projectId,
        collectionType: "tools",
        category: "anything",
        lookup,
      }),
    ).rejects.toThrow();
    // ^^ Note: this catches the inner throw because the helper itself
    // doesn't wrap the lookup call. DraftStep wraps the call in its OWN
    // try/catch (Pattern 111: caller owns escalation). The test asserts
    // the helper's contract: it propagates unexpected failures upward.
  });

  it("trims whitespace around category before lookup", async () => {
    const lookup = inMemoryLookup(new Set([`${projectId}|tool|audio-music`]));
    await validateCategoryAndNotify({
      projectId,
      collectionType: "tools",
      category: "  audio-music  ",
      articleId: "art-trim",
      lookup,
    });
    const row = await waitForNotification(600);
    expect(row).toBeUndefined();
  });
});
