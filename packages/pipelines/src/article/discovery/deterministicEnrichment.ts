import type { Article } from "@marketing-auto/db";

export interface DeterministicFields {
  wordCount: number;
  imageCount: number;
  headerCountH2: number;
  headerCountH3: number;
  headerSlugs: string[];
  paragraphCount: number;
  linkCountInternal: number;
  linkCountExternal: number;
  codeBlockCount: number;
  tableCount: number;
  listCountUl: number;
  listCountOl: number;
  hasAffiliateLinks: boolean;
  referencedTools: string[];
  containerFormHint: string;
  completenessScore: string;
  estimatedAngles: number;
}

type ImportMetadata = {
  wordCount?: number;
  imageCount?: number;
  headings?: Array<{ level: number; text: string; id?: string }>;
  internalLinks?: string[];
  hasAffiliateLinks?: boolean;
};

function countParagraphs(body: string): number {
  const lines = body.split("\n");
  let count = 0;
  let inFence = false;
  let prevBlank = true;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```") || line.startsWith("~~~")) { inFence = !inFence; prevBlank = false; continue; }
    if (inFence) { prevBlank = false; continue; }
    if (line === "") { prevBlank = true; continue; }
    if (
      prevBlank &&
      !line.startsWith("#") &&
      !line.startsWith("|") &&
      !line.startsWith(">") &&
      !/^[-*+] /.test(line) &&
      !/^\d+\. /.test(line) &&
      !line.startsWith("---") &&
      !line.startsWith("===")
    ) {
      count++;
    }
    prevBlank = false;
  }
  return count;
}

function countCodeBlocks(body: string): number {
  return (body.match(/^```[\s\S]*?^```/gm) ?? []).length +
         (body.match(/^~~~[\s\S]*?^~~~/gm) ?? []).length;
}

function countTables(body: string): number {
  return (body.match(/^\|.+\|[\r\n]+\|[-| :]+\|/gm) ?? []).length;
}

function countLists(body: string): { ul: number; ol: number } {
  const lines = body.split("\n");
  let ul = 0; let ol = 0; let prevUl = false; let prevOl = false;
  for (const line of lines) {
    const isUl = /^(\s{0,3})[-*+] /.test(line);
    const isOl = /^(\s{0,3})\d+\. /.test(line);
    if (isUl && !prevUl) ul++;
    if (isOl && !prevOl) ol++;
    prevUl = isUl; prevOl = isOl;
  }
  return { ul, ol };
}

function countExternalLinks(body: string): number {
  const mdLinks = [...body.matchAll(/\[.*?\]\((https?:\/\/[^)]+)\)/g)];
  const bareLinks = [...body.matchAll(/(?<!\()(https?:\/\/\S+)/g)];
  const urls = new Set<string>([
    ...mdLinks.flatMap((m) => m[1] ? [m[1]] : []),
    ...bareLinks.flatMap((m) => m[1] ? [m[1]] : []),
  ]);
  return urls.size;
}

function deriveContainerFormHint(
  collection: string,
  fx: Record<string, unknown>,
  title: string | null,
  publishedAt: Date | null,
): string {
  switch (collection) {
    case "tools": return "single-tool-deep-dive";
    case "comparisons": {
      const n = Array.isArray(fx["toolSlugs"]) ? (fx["toolSlugs"] as string[]).length : 0;
      return n <= 2 ? "comparison-2" : "comparison-list";
    }
    case "ki-wissen": return "concept-explainer";
    case "usecases": return "application-scenario";
    case "blog": {
      const daysOld = publishedAt ? (Date.now() - publishedAt.getTime()) / 86_400_000 : Infinity;
      const t = (title ?? "").toLowerCase();
      if (daysOld < 60) return "news-update";
      if (/\b(how to|so |schritt|step|anleitung|guide)\b/.test(t)) return "howto-guide";
      return "opinion-piece";
    }
    case "tool-categories": return "category-hub";
    case "special-landings": return "landing-page";
    default: return "unknown";
  }
}

function deriveReferencedTools(collection: string, fx: Record<string, unknown>): string[] {
  if (collection === "comparisons") return Array.isArray(fx["toolSlugs"]) ? (fx["toolSlugs"] as string[]) : [];
  if (collection === "usecases") {
    const feats = Array.isArray(fx["featuredToolSlugs"]) ? (fx["featuredToolSlugs"] as string[]) : [];
    const primary = typeof fx["primaryTool"] === "string" ? [fx["primaryTool"]] : [];
    return [...new Set([...primary, ...feats])];
  }
  if (collection === "blog") return typeof fx["primaryTool"] === "string" ? [fx["primaryTool"]] : [];
  return [];
}

function deriveCompletenessScore(
  wordCount: number,
  imageCount: number,
  h2Count: number,
  hasFaq: boolean,
  hasAffiliate: boolean,
  collection: string,
): string {
  let score = 0;
  if (wordCount > 2000) score += 0.3;
  else if (wordCount > 1000) score += 0.2;
  else if (wordCount > 500) score += 0.1;
  if (h2Count >= 3) score += 0.2; else if (h2Count >= 1) score += 0.1;
  if (imageCount >= 2) score += 0.2; else if (imageCount >= 1) score += 0.1;
  if (hasFaq) score += 0.2;
  if (hasAffiliate && collection === "tools") score += 0.1;
  return String(Math.min(1, Math.round(score * 1000) / 1000));
}

export function runDeterministicEnrichment(article: Article): DeterministicFields {
  const body = article.bodyMd ?? "";
  const im = (article.importMetadata ?? {}) as ImportMetadata;
  const fx = (article.frontmatterExtras ?? {}) as Record<string, unknown>;

  const wordCount = im.wordCount ?? article.wordCount ?? 0;
  const headings = im.headings ?? [];
  const h2s = headings.filter((h) => h.level === 2);
  const h3s = headings.filter((h) => h.level === 3);
  const headerSlugs = headings.map((h) =>
    h.id ?? h.text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").trim()
  );

  const imageCount = im.imageCount ?? 0;
  const linkCountInternal = (im.internalLinks ?? []).length;
  const linkCountExternal = body ? countExternalLinks(body) : 0;
  const paragraphCount = body ? countParagraphs(body) : 0;
  const codeBlockCount = body ? countCodeBlocks(body) : 0;
  const tableCount = body ? countTables(body) : 0;
  const listCounts = body ? countLists(body) : { ul: 0, ol: 0 };
  const hasAffiliateLinks = im.hasAffiliateLinks ?? false;

  const tools = deriveReferencedTools(article.collection ?? "", fx);
  const hint = deriveContainerFormHint(
    article.collection ?? "",
    fx,
    article.title ?? null,
    article.publishedAt ? new Date(article.publishedAt) : null,
  );
  const score = deriveCompletenessScore(
    wordCount,
    imageCount,
    h2s.length,
    Boolean(fx["faq"]),
    hasAffiliateLinks,
    article.collection ?? "",
  );

  return {
    wordCount,
    imageCount,
    headerCountH2: h2s.length,
    headerCountH3: h3s.length,
    headerSlugs,
    paragraphCount,
    linkCountInternal,
    linkCountExternal,
    codeBlockCount,
    tableCount,
    listCountUl: listCounts.ul,
    listCountOl: listCounts.ol,
    hasAffiliateLinks,
    referencedTools: tools,
    containerFormHint: hint,
    completenessScore: score,
    estimatedAngles: h2s.length,
  };
}
