import { describe, expect, it } from "bun:test";
import {
  AstroSyncValidationError,
  validateFrontmatterAgainstSchema,
} from "../src/index.ts";
import type { FrontmatterField } from "../src/types.ts";

const BLOG_FIELDS: FrontmatterField[] = [
  { name: "title", type: "string", required: true, hasDefault: false },
  { name: "description", type: "string", required: false, hasDefault: false },
  { name: "date", type: "date", required: true, hasDefault: false },
  { name: "tags", type: "string_array", required: false, hasDefault: true },
  {
    name: "category",
    type: "string",
    required: true,
    hasDefault: false,
    enumValues: ["Guides & Tutorials", "Vergleiche", "Praxis & Use Cases"],
  },
  { name: "featured", type: "boolean", required: false, hasDefault: true },
  { name: "wordCount", type: "number", required: false, hasDefault: false },
  { name: "heroImage", type: "image", required: true, hasDefault: false },
  {
    name: "faq",
    type: "object_array",
    required: false,
    hasDefault: false,
    objectShape: "{ question: string, answer: string }",
  },
];

describe("validateFrontmatterAgainstSchema", () => {
  it("returns success for empty schema (permissive fallback)", () => {
    const r = validateFrontmatterAgainstSchema({ anyKey: "anyValue" }, []);
    expect(r.success).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("passes a fully-valid frontmatter", () => {
    const fm = {
      title: "Test article",
      description: "desc",
      date: "2026-05-23",
      tags: ["ai", "ml"],
      category: "Guides & Tutorials",
      featured: true,
      wordCount: 1200,
      heroImage: "/gen/test-article/hero.webp",
      faq: [{ question: "q?", answer: "a." }],
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("flags missing_required when a required field with no default is absent", () => {
    const fm = { description: "no title or heroImage" };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(false);
    const names = r.failures.map((f) => f.fieldPath).sort();
    expect(names).toEqual(["category", "date", "heroImage", "title"]);
    for (const f of r.failures) {
      expect(f.reason).toBe("missing_required");
      expect(f.actual).toBe("");
    }
  });

  it("does NOT flag missing required when the field has a default (hasDefault=true)", () => {
    const fields: FrontmatterField[] = [
      { name: "draft", type: "boolean", required: true, hasDefault: true },
    ];
    const r = validateFrontmatterAgainstSchema({}, fields);
    expect(r.success).toBe(true);
  });

  it("does NOT flag missing optional fields", () => {
    const fm = {
      title: "x",
      date: "2026-05-23",
      category: "Vergleiche",
      heroImage: "/gen/x/hero.webp",
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(true);
  });

  it("flags type_mismatch: number where string expected", () => {
    const fm = {
      title: 123 as unknown as string,
      date: "2026-05-23",
      category: "Vergleiche",
      heroImage: "/gen/x/hero.webp",
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(false);
    const titleFail = r.failures.find((f) => f.fieldPath === "title");
    expect(titleFail?.reason).toBe("type_mismatch");
    expect(titleFail?.expected).toBe("string");
    expect(titleFail?.actual).toContain("number");
  });

  it("flags type_mismatch: string array with non-string element", () => {
    const fm = {
      title: "x",
      date: "2026-05-23",
      category: "Vergleiche",
      heroImage: "/gen/x/hero.webp",
      tags: ["ai", 42 as unknown as string],
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(false);
    const tagsFail = r.failures.find((f) => f.fieldPath === "tags");
    expect(tagsFail?.reason).toBe("type_mismatch");
    expect(tagsFail?.expected).toBe("string[]");
  });

  it("flags type_mismatch: bad date string", () => {
    const fm = {
      title: "x",
      date: "23-05-2026" as string,
      category: "Vergleiche",
      heroImage: "/gen/x/hero.webp",
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(false);
    const dateFail = r.failures.find((f) => f.fieldPath === "date");
    expect(dateFail?.reason).toBe("type_mismatch");
  });

  it("accepts ISO date with time + timezone", () => {
    const fm = {
      title: "x",
      date: "2026-05-23T14:30:00Z",
      category: "Vergleiche",
      heroImage: "/gen/x/hero.webp",
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(true);
  });

  it("flags enum_mismatch when string value is outside enumValues", () => {
    const fm = {
      title: "x",
      date: "2026-05-23",
      category: "Random Unknown Category",
      heroImage: "/gen/x/hero.webp",
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(false);
    const catFail = r.failures.find((f) => f.fieldPath === "category");
    expect(catFail?.reason).toBe("enum_mismatch");
    expect(catFail?.expected).toContain("Guides & Tutorials");
    expect(catFail?.actual).toBe("Random Unknown Category");
  });

  it("skips enum check when type already failed", () => {
    const fm = {
      title: "x",
      date: "2026-05-23",
      category: 999 as unknown as string,
      heroImage: "/gen/x/hero.webp",
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    const catFailures = r.failures.filter((f) => f.fieldPath === "category");
    expect(catFailures).toHaveLength(1);
    expect(catFailures[0]?.reason).toBe("type_mismatch");
  });

  it("treats null/undefined as missing — flags missing_required, ignores optional", () => {
    const fm = {
      title: null as unknown as string,
      description: undefined,
      date: "2026-05-23",
      category: "Vergleiche",
      heroImage: "/gen/x/hero.webp",
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(false);
    expect(r.failures.find((f) => f.fieldPath === "title")?.reason).toBe("missing_required");
    expect(r.failures.find((f) => f.fieldPath === "description")).toBeUndefined();
  });

  it("does NOT flag extra/unknown fields (passthrough — Astro tolerates)", () => {
    const fm = {
      title: "x",
      date: "2026-05-23",
      category: "Vergleiche",
      heroImage: "/gen/x/hero.webp",
      thisIsNotInTheSchema: "but should be silently ignored",
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(true);
  });

  it("accepts 'unknown' type field with any shape", () => {
    const fields: FrontmatterField[] = [
      { name: "speakable", type: "unknown", required: false, hasDefault: false },
    ];
    expect(validateFrontmatterAgainstSchema({ speakable: true }, fields).success).toBe(true);
    expect(validateFrontmatterAgainstSchema({ speakable: { selector: "p" } }, fields).success).toBe(true);
    expect(validateFrontmatterAgainstSchema({ speakable: "yes" }, fields).success).toBe(true);
  });

  it("accumulates multiple failures in a single pass", () => {
    const fm = {
      title: 1 as unknown as string,
      date: "bad",
      category: "wrong-enum",
      // heroImage missing
      tags: "not-an-array" as unknown as string[],
    };
    const r = validateFrontmatterAgainstSchema(fm, BLOG_FIELDS);
    expect(r.success).toBe(false);
    expect(r.failures.length).toBeGreaterThanOrEqual(5);
    const reasons = new Set(r.failures.map((f) => f.reason));
    expect(reasons.has("missing_required")).toBe(true);
    expect(reasons.has("type_mismatch")).toBe(true);
    expect(reasons.has("enum_mismatch")).toBe(true);
  });

  it("truncates extremely long actual values", () => {
    const fields: FrontmatterField[] = [
      { name: "data", type: "number", required: true, hasDefault: false },
    ];
    const longString = "x".repeat(200);
    const r = validateFrontmatterAgainstSchema({ data: longString }, fields);
    expect(r.success).toBe(false);
    expect(r.failures[0]?.actual.length).toBeLessThanOrEqual(120);
    expect(r.failures[0]?.actual).toContain("…");
  });
});

describe("AstroSyncValidationError", () => {
  it("carries articleId, collection, and failures on the instance", () => {
    const err = new AstroSyncValidationError({
      articleId: "00000000-0000-0000-0000-000000000001",
      collection: "blog",
      failures: [
        { fieldPath: "title", expected: "string", actual: "", reason: "missing_required" },
      ],
    });
    expect(err.name).toBe("AstroSyncValidationError");
    expect(err.articleId).toBe("00000000-0000-0000-0000-000000000001");
    expect(err.collection).toBe("blog");
    expect(err.failures).toHaveLength(1);
    expect(err.message).toContain("title");
    expect(err.message).toContain("missing_required");
  });

  it("is a real Error subclass (instanceof works)", () => {
    const err = new AstroSyncValidationError({
      articleId: "id",
      collection: "blog",
      failures: [],
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AstroSyncValidationError);
  });
});
