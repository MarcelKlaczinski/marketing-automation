import { describe, expect, test } from "bun:test";
import { parseBlogSchema } from "../src/steps/resolve-schema.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Standard Astro blog starter schema (Zod, no image helper) */
const STANDARD_BLOG_CONFIG = `
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    heroImage: z.string().optional(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()),
  }),
});

export const collections = { blog };
`;

/** Schema with Astro image() helper (requires ({ image }) => pattern) */
const IMAGE_HELPER_CONFIG = `
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    heroImage: image(),
    heroImageAlt: z.string().default(""),
    publishDate: z.date(),
    author: z.string().default("Marcel"),
    category: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
`;

/** Collections object style — blog is a value in the exported collections map */
const COLLECTIONS_OBJECT_STYLE = `
import { defineCollection, z } from "astro:content";

export const collections = {
  blog: defineCollection({
    schema: z.object({
      title: z.string(),
      slug: z.string(),
      excerpt: z.string().optional(),
      publishedAt: z.date(),
      wordCount: z.number(),
    }),
  }),
};
`;

/** KI-Wissensraum-style: richer schema with schema.org JSON-LD field */
const KI_WISSENSRAUM_STYLE = `
import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    heroImage: image(),
    heroImageAlt: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    cluster: z.string().optional(),
    pillar: z.string().optional(),
    cornerstoneKeyword: z.string(),
    wordCount: z.number().optional(),
    schemaJsonLd: z.object({}).optional(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
`;

/** Completely unparseable — no blog collection, no z.object */
const UNPARSEABLE_CONFIG = `
// This file uses a custom schema system, not Zod
export const collections = {
  posts: defineCollection({ loader: myCustomLoader }),
};
`;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("parseBlogSchema()", () => {
  describe("standard Astro blog starter", () => {
    test("returns non-empty field list", () => {
      const fields = parseBlogSchema(STANDARD_BLOG_CONFIG);
      expect(fields.length).toBeGreaterThan(0);
    });

    test("identifies title as required string", () => {
      const fields = parseBlogSchema(STANDARD_BLOG_CONFIG);
      const title = fields.find((f) => f.name === "title");
      expect(title).toBeDefined();
      expect(title?.type).toBe("string");
      expect(title?.required).toBe(true);
      expect(title?.hasDefault).toBe(false);
    });

    test("identifies updatedDate as optional date", () => {
      const fields = parseBlogSchema(STANDARD_BLOG_CONFIG);
      const f = fields.find((f) => f.name === "updatedDate");
      expect(f).toBeDefined();
      expect(f?.type).toBe("date");
      expect(f?.required).toBe(false);
    });

    test("identifies draft as non-required (has default)", () => {
      const fields = parseBlogSchema(STANDARD_BLOG_CONFIG);
      const f = fields.find((f) => f.name === "draft");
      expect(f).toBeDefined();
      expect(f?.type).toBe("boolean");
      expect(f?.required).toBe(false);
      expect(f?.hasDefault).toBe(true);
    });

    test("identifies tags as string_array", () => {
      const fields = parseBlogSchema(STANDARD_BLOG_CONFIG);
      const f = fields.find((f) => f.name === "tags");
      expect(f).toBeDefined();
      expect(f?.type).toBe("string_array");
    });
  });

  describe("image() helper schema", () => {
    test("identifies heroImage as image type", () => {
      const fields = parseBlogSchema(IMAGE_HELPER_CONFIG);
      const f = fields.find((f) => f.name === "heroImage");
      expect(f).toBeDefined();
      expect(f?.type).toBe("image");
    });

    test("identifies heroImageAlt with default as non-required", () => {
      const fields = parseBlogSchema(IMAGE_HELPER_CONFIG);
      const f = fields.find((f) => f.name === "heroImageAlt");
      expect(f).toBeDefined();
      expect(f?.required).toBe(false);
      expect(f?.hasDefault).toBe(true);
    });

    test("identifies category as optional string", () => {
      const fields = parseBlogSchema(IMAGE_HELPER_CONFIG);
      const f = fields.find((f) => f.name === "category");
      expect(f).toBeDefined();
      expect(f?.type).toBe("string");
      expect(f?.required).toBe(false);
    });
  });

  describe("collections object style", () => {
    test("still discovers the blog schema", () => {
      const fields = parseBlogSchema(COLLECTIONS_OBJECT_STYLE);
      expect(fields.length).toBeGreaterThan(0);
    });

    test("identifies title and slug as required strings", () => {
      const fields = parseBlogSchema(COLLECTIONS_OBJECT_STYLE);
      const title = fields.find((f) => f.name === "title");
      const slug = fields.find((f) => f.name === "slug");
      expect(title?.type).toBe("string");
      expect(title?.required).toBe(true);
      expect(slug?.type).toBe("string");
      expect(slug?.required).toBe(true);
    });

    test("identifies wordCount as number", () => {
      const fields = parseBlogSchema(COLLECTIONS_OBJECT_STYLE);
      const f = fields.find((f) => f.name === "wordCount");
      expect(f?.type).toBe("number");
    });
  });

  describe("KI-Wissensraum-style schema", () => {
    test("identifies all core required fields", () => {
      const fields = parseBlogSchema(KI_WISSENSRAUM_STYLE);
      const required = fields.filter((f) => f.required).map((f) => f.name);
      expect(required).toContain("title");
      expect(required).toContain("description");
      expect(required).toContain("cornerstoneKeyword");
    });

    test("identifies heroImage as image type and required", () => {
      const fields = parseBlogSchema(KI_WISSENSRAUM_STYLE);
      const f = fields.find((f) => f.name === "heroImage");
      expect(f?.type).toBe("image");
      expect(f?.required).toBe(true);
    });

    test("identifies draft and tags as non-required (have defaults)", () => {
      const fields = parseBlogSchema(KI_WISSENSRAUM_STYLE);
      const draft = fields.find((f) => f.name === "draft");
      const tags = fields.find((f) => f.name === "tags");
      expect(draft?.required).toBe(false);
      expect(draft?.hasDefault).toBe(true);
      expect(tags?.required).toBe(false);
      expect(tags?.hasDefault).toBe(true);
    });

    test("identifies schemaJsonLd as object type", () => {
      const fields = parseBlogSchema(KI_WISSENSRAUM_STYLE);
      const f = fields.find((f) => f.name === "schemaJsonLd");
      expect(f?.type).toBe("object");
      expect(f?.required).toBe(false);
    });

    test("identifies optional fields as not required", () => {
      const fields = parseBlogSchema(KI_WISSENSRAUM_STYLE);
      const optionals = ["updatedDate", "cluster", "pillar", "wordCount", "schemaJsonLd"];
      for (const name of optionals) {
        const f = fields.find((fi) => fi.name === name);
        expect(f?.required, `${name} should not be required`).toBe(false);
      }
    });
  });

  describe("unparseable config", () => {
    test("returns empty array (no throw)", () => {
      expect(() => parseBlogSchema(UNPARSEABLE_CONFIG)).not.toThrow();
      const fields = parseBlogSchema(UNPARSEABLE_CONFIG);
      expect(fields).toEqual([]);
    });
  });

  describe("computeRelative (re-export sanity)", () => {
    // computeRelative is private; test it indirectly via the image path in RenderMdxStep.
    // Direct unit tests live alongside RenderMdxStep tests (Session 3).
  });
});
