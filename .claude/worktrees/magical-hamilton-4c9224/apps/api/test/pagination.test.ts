import { describe, expect, test, beforeAll } from "bun:test";
import { db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

// Run only when RUN_PAGINATION_TESTS=1 is set (requires toolwiki project + running API).
const run = process.env.RUN_PAGINATION_TESTS === "1";
const describePagination = run ? describe : describe.skip;
const API_BASE = process.env.TEST_API_BASE ?? "http://localhost:3050/api";
const SESSION_COOKIE = process.env.TEST_SESSION_COOKIE ?? "";

describePagination("Pagination shape", () => {
  beforeAll(async () => {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, "toolwiki"))
      .limit(1);
    if (!p) throw new Error("toolwiki project not found — run setup first");
  });

  test("GET /articles returns paginated shape", async () => {
    const res = await fetch(
      `${API_BASE}/articles?projectSlug=toolwiki&limit=10&offset=0`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.ok).toBe(true);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    const data = json.data as Record<string, unknown>;
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(data.limit).toBe(10);
    expect(data.offset).toBe(0);
    expect((data.items as unknown[]).length).toBeLessThanOrEqual(10);
  });

  test("GET /articles/imported returns pair-level pagination", async () => {
    const res = await fetch(
      `${API_BASE}/articles/imported?projectSlug=toolwiki&collection=blog&limit=10&offset=0`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.ok).toBe(true);
    const json = await res.json() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    const data = json.data as Record<string, unknown>;
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe("number");
    expect(data.limit).toBe(10);
    expect((data.items as unknown[]).length).toBeLessThanOrEqual(10);
    // Each item should be a pair (translationKey, de, en)
    const items = data.items as Array<Record<string, unknown>>;
    if (items.length > 0) {
      expect(items[0]).toHaveProperty("translationKey");
      expect(items[0]).toHaveProperty("de");
      expect(items[0]).toHaveProperty("en");
    }
  });

  test("offset shifts results for /articles/imported", async () => {
    const [a, b] = await Promise.all([
      fetch(
        `${API_BASE}/articles/imported?projectSlug=toolwiki&collection=blog&limit=5&offset=0`,
        { headers: { cookie: SESSION_COOKIE } }
      ).then((r) => r.json() as Promise<Record<string, unknown>>),
      fetch(
        `${API_BASE}/articles/imported?projectSlug=toolwiki&collection=blog&limit=5&offset=5`,
        { headers: { cookie: SESSION_COOKIE } }
      ).then((r) => r.json() as Promise<Record<string, unknown>>),
    ]);

    const aKeys = ((a.data as Record<string, unknown>).items as Array<Record<string, unknown>>)
      .map((p) => p.translationKey);
    const bKeys = ((b.data as Record<string, unknown>).items as Array<Record<string, unknown>>)
      .map((p) => p.translationKey);

    if (aKeys.length > 0 && bKeys.length > 0) {
      expect(aKeys).not.toEqual(bKeys);
    }
  });

  test("GET /clusters returns paginated shape", async () => {
    const res = await fetch(
      `${API_BASE}/clusters?projectSlug=toolwiki&limit=10&offset=0`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.ok).toBe(true);
    const json = await res.json() as Record<string, unknown>;
    const data = json.data as Record<string, unknown>;
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe("number");
  });

  test("GET /notifications returns total", async () => {
    const res = await fetch(
      `${API_BASE}/notifications?limit=20&offset=0`,
      { headers: { cookie: SESSION_COOKIE } }
    );
    expect(res.ok).toBe(true);
    const json = await res.json() as Record<string, unknown>;
    const data = json.data as Record<string, unknown>;
    expect(typeof data.total).toBe("number");
    expect(typeof data.limit).toBe("number");
    expect(typeof data.offset).toBe("number");
    expect(Array.isArray(data.notifications)).toBe(true);
  });
});
