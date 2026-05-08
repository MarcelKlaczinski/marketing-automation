import matter from "gray-matter";
import { z } from "zod";

const FrontmatterSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    slug: z.string().optional(),
    locale: z.string().optional(),
    translationKey: z.string().optional(),
    publishedAt: z.union([z.string(), z.date()]).optional(),
    updatedAt: z.union([z.string(), z.date()]).optional(),
    author: z.string().optional(),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    tags: z.array(z.string()).optional(),
    noindex: z.boolean().optional(),
  })
  .passthrough();

export type ParsedFrontmatter = z.infer<typeof FrontmatterSchema>;

export type ParseResult = {
  filePath: string;
  frontmatter: ParsedFrontmatter;
  body: string;
  typed: {
    title: string | null;
    description: string | null;
    slug: string;
    locale: string | null;
    translationKey: string | null;
    publishedAt: Date | null;
    updatedAt: Date | null;
    author: string | null;
    category: string | null;
    subcategory: string | null;
    tags: string[];
    noindex: boolean;
  };
  extras: Record<string, unknown>;
  metadata: {
    wordCount: number;
    readingTimeMinutes: number;
    headings: Array<{ level: number; text: string }>;
    hasAffiliateLinks: boolean;
    imageCount: number;
    internalLinks: string[];
  };
};

const TYPED_FIELDS = new Set([
  "title",
  "description",
  "slug",
  "locale",
  "translationKey",
  "publishedAt",
  "updatedAt",
  "author",
  "category",
  "subcategory",
  "tags",
  "noindex",
]);

export function parseMdxContent(filePath: string, raw: string): ParseResult {
  const parsed = matter(raw);
  const fm = FrontmatterSchema.parse(parsed.data);
  const body = parsed.content;

  const filenameSlug = filePath.match(/([^/]+)\.mdx?$/)?.[1] ?? "";
  const slug = fm.slug ?? filenameSlug;

  let locale: string | null = fm.locale ?? null;
  if (!locale) {
    const pathLocale = filePath.match(/\/(de|en)\//)?.[1];
    if (pathLocale) locale = pathLocale;
  }

  const publishedAt = fm.publishedAt ? toDate(fm.publishedAt) : null;
  const updatedAt = fm.updatedAt ? toDate(fm.updatedAt) : null;

  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (!TYPED_FIELDS.has(k)) extras[k] = v;
  }

  const metadata = computeBodyMetadata(body);

  return {
    filePath,
    frontmatter: fm,
    body,
    typed: {
      title: fm.title ?? null,
      description: fm.description ?? null,
      slug,
      locale,
      translationKey: fm.translationKey ?? null,
      publishedAt,
      updatedAt,
      author: fm.author ?? null,
      category: fm.category ?? null,
      subcategory: fm.subcategory ?? null,
      tags: fm.tags ?? [],
      noindex: fm.noindex ?? false,
    },
    extras,
    metadata,
  };
}

function toDate(v: string | Date): Date | null {
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function computeBodyMetadata(body: string): ParseResult["metadata"] {
  const plain = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[.*?\]\(.*?\)/g, "")
    .replace(/[*_`#>]/g, "");
  const words = plain.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const readingTimeMinutes = Math.max(1, Math.round(wordCount / 200));

  const headings: Array<{ level: number; text: string }> = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(body)) !== null) {
    headings.push({ level: match[1]!.length, text: match[2]!.trim() });
  }

  const hasAffiliateLinks =
    /<AffiliateLink\b/.test(body) ||
    /<AffiliateCta\b/.test(body) ||
    /\]\(\/go\//.test(body);

  const imageCount =
    (body.match(/!\[[^\]]*\]\(/g)?.length ?? 0) +
    (body.match(/<(?:Image|img)\b/g)?.length ?? 0);

  const internalLinks: string[] = [];
  const linkRegex = /\]\((\/(?:de|en|go)\/[^)\s]+)\)/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRegex.exec(body)) !== null) {
    internalLinks.push(lm[1]!);
  }

  return { wordCount, readingTimeMinutes, headings, hasAffiliateLinks, imageCount, internalLinks };
}
