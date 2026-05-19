#!/usr/bin/env bun
/**
 * LLM Quality Audit — read-only. No DB writes.
 * Usage: bun --env-file .env apps/api/src/scripts/audit-runner.ts
 */
import { db, sql } from "@marketing-auto/db";
import { messages } from "@marketing-auto/adapter-anthropic";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const PROJECT_ID = "3fad7929-b06d-47ce-b6a1-8ac134362c42";
const PROJECT_NAME = "toolwiki.ai";
const AUDIT_DATE = "2026-05-19";
const OUTPUT_DIR = join(process.cwd(), "audit-output");
const ARTICLE_SAMPLE = 20;
const SOCIAL_SAMPLE = 20;

mkdirSync(OUTPUT_DIR, { recursive: true });

interface Issue {
  criterion: string;
  severity: "critical" | "warning" | "info";
  finding: string;
}

interface ArticleFinding {
  id: string;
  title: string;
  locale: string | null;
  status: string;
  score: number;
  issues: Issue[];
}

interface SocialFinding {
  id: string;
  article_title: string;
  template_key: string | null;
  locale: string | null;
  score: number;
  issues: Issue[];
}

function checkArticle(row: Record<string, unknown>): { score: number; issues: Issue[] } {
  const issues: Issue[] = [];
  let deductions = 0;

  const meta = row.meta_description as string | null;
  if (!meta || meta.trim().length === 0) {
    issues.push({ criterion: "meta_description", severity: "critical", finding: "Missing meta_description" });
    deductions += 20;
  } else if (meta.length < 80) {
    issues.push({ criterion: "meta_description", severity: "warning", finding: `meta_description too short: ${meta.length} chars (ideal 120-160)` });
    deductions += 5;
  } else if (meta.length > 200) {
    issues.push({ criterion: "meta_description", severity: "warning", finding: `meta_description too long: ${meta.length} chars` });
    deductions += 5;
  }

  const wc = row.word_count as number | null;
  if (wc === null || wc === undefined) {
    issues.push({ criterion: "word_count", severity: "warning", finding: "word_count not tracked (pipeline didn't record it)" });
    deductions += 5;
  } else if (wc < 400) {
    issues.push({ criterion: "word_count", severity: "critical", finding: `word_count very low: ${wc} words` });
    deductions += 15;
  } else if (wc < 800) {
    issues.push({ criterion: "word_count", severity: "warning", finding: `word_count below target: ${wc} words (target: 800+)` });
    deductions += 5;
  }

  const heroUrl = row.hero_image_public_url as string | null;
  if (!heroUrl || heroUrl.trim().length === 0) {
    issues.push({ criterion: "hero_image", severity: "critical", finding: "No hero image (hero_image_public_url is null)" });
    deductions += 15;
  }

  if (!row.intent_type) {
    issues.push({ criterion: "intent_type", severity: "warning", finding: "intent_type not set — template eligibility checks may fail" });
    deductions += 5;
  }

  const srScore = row.self_review_score as number | null;
  if (srScore === null || srScore === undefined) {
    issues.push({ criterion: "self_review", severity: "info", finding: "No self-review score (self-review step may not have run)" });
    deductions += 5;
  } else if (srScore < 60) {
    issues.push({ criterion: "self_review", severity: "critical", finding: `Self-review score low: ${srScore}/100` });
    deductions += 10;
  } else if (srScore < 75) {
    issues.push({ criterion: "self_review", severity: "warning", finding: `Self-review score below threshold: ${srScore}/100 (target: 75+)` });
    deductions += 5;
  }

  const tags = row.tags as string[] | null;
  if (!tags || tags.length === 0) {
    issues.push({ criterion: "tags", severity: "warning", finding: "No tags set" });
    deductions += 5;
  }

  if (!row.category) {
    issues.push({ criterion: "category", severity: "warning", finding: "No category set" });
    deductions += 5;
  }

  const fe = row.frontmatter_extras as Record<string, unknown> | null;
  if (!fe || !fe.faq) {
    issues.push({ criterion: "faq", severity: "info", finding: "No FAQ in frontmatter_extras — missed SEO opportunity" });
    deductions += 3;
  } else {
    const faq = fe.faq as Array<unknown>;
    if (faq.length < 3) {
      issues.push({ criterion: "faq", severity: "info", finding: `FAQ only has ${faq.length} entries (ideal: 4+)` });
      deductions += 2;
    }
  }

  const body = row.body_md as string | null;
  if (!body || body.trim().length < 200) {
    issues.push({ criterion: "body_md", severity: "critical", finding: "body_md missing or too short" });
    deductions += 20;
  }

  return { score: Math.max(0, 100 - deductions), issues };
}

function checkSocialPost(row: Record<string, unknown>): { score: number; issues: Issue[] } {
  const issues: Issue[] = [];
  let deductions = 0;

  const content = row.content as Record<string, unknown> | null;

  if (!row.template_key) {
    issues.push({ criterion: "template_key", severity: "warning", finding: "template_key is null — post predates Spec 54k template metadata" });
    deductions += 10;
  }

  const slides = (content?.slides as Array<unknown>) ?? [];
  if (!slides.length) {
    issues.push({ criterion: "slides", severity: "critical", finding: "No slides in content" });
    deductions += 25;
  } else if (slides.length < 4) {
    issues.push({ criterion: "slides", severity: "warning", finding: `Only ${slides.length} slides (minimum recommended: 4)` });
    deductions += 10;
  }

  const hasLocalhost = slides.some((s) => {
    const slide = s as Record<string, unknown>;
    return typeof slide.imageUrl === "string" && slide.imageUrl.includes("localhost");
  });
  if (hasLocalhost) {
    issues.push({ criterion: "slide_urls", severity: "critical", finding: "Slide imageUrls point to localhost — dev renders, not production R2 URLs" });
    deductions += 20;
  }

  const caption = content?.caption as string | null;
  if (!caption || caption.trim().length === 0) {
    issues.push({ criterion: "caption", severity: "critical", finding: "Missing caption" });
    deductions += 20;
  } else {
    if (!caption.includes("Link in Bio")) {
      issues.push({ criterion: "caption_cta", severity: "warning", finding: "Caption missing 'Link in Bio' CTA" });
      deductions += 5;
    }
    if (caption.length < 50) {
      issues.push({ criterion: "caption_length", severity: "warning", finding: `Caption too short: ${caption.length} chars` });
      deductions += 5;
    }
    if (caption.length > 600) {
      issues.push({ criterion: "caption_length", severity: "info", finding: `Caption long: ${caption.length} chars (Instagram optimal: ~300)` });
      deductions += 2;
    }

    const locale = row.locale as string | null;
    const isEnLocale = locale && (locale.startsWith("en") || locale === "en-US");
    if (isEnLocale) {
      const germanMarkers = ["welches", "welcher", "haben", "für", "und", "nicht", "wir", "das", "die", "der"];
      const captionLower = caption.toLowerCase();
      const hits = germanMarkers.filter(w => captionLower.includes(` ${w} `) || captionLower.startsWith(`${w} `)).length;
      if (hits >= 3) {
        issues.push({ criterion: "locale_mismatch", severity: "critical", finding: `Caption is in German but locale is ${locale} — locale not forwarded to caption generation` });
        deductions += 20;
      }
    }
  }

  const hashtags = content?.hashtags as string[] | null;
  if (!hashtags || hashtags.length === 0) {
    issues.push({ criterion: "hashtags", severity: "warning", finding: "No hashtags" });
    deductions += 10;
  } else if (hashtags.length < 5) {
    issues.push({ criterion: "hashtags", severity: "warning", finding: `Only ${hashtags.length} hashtags (recommended: 7-20)` });
    deductions += 5;
  } else if (hashtags.length > 30) {
    issues.push({ criterion: "hashtags", severity: "info", finding: `${hashtags.length} hashtags — trim to ≤20 for Instagram` });
    deductions += 2;
  }

  const costEur = parseFloat((row.cost_eur as string) ?? "0");
  if (costEur === 0) {
    issues.push({ criterion: "cost_tracking", severity: "warning", finding: "cost_eur = 0.00 — caption generation cost not tracked in social render worker" });
    deductions += 5;
  }

  return { score: Math.max(0, 100 - deductions), issues };
}

async function evalArticleBodyQuality(title: string, bodyMd: string): Promise<{ score: number; finding: string }> {
  const excerpt = bodyMd.slice(0, 2000);
  try {
    const result = await messages({
      projectId: PROJECT_ID,
      operation: "audit:article-body-eval",
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "You are an LLM output quality auditor. Evaluate the given article excerpt and respond with ONLY a valid JSON object. No markdown, no explanation.",
      userMessage: `Article title: "${title}"\n\nArticle body (first 2000 chars):\n${excerpt}\n\nEvaluate on dimensions (0-100 each):\n1. Content depth: specific, non-generic claims?\n2. Structure: logical flow, clear headings?\n3. Tone: informative, avoids marketing fluff?\n4. Language quality: natural, fluent (German if applicable)?\n\nJSON: {"overall": 0, "depth": 0, "structure": 0, "tone": 0, "language": 0, "top_issue": "one sentence max"}`,
      maxTokens: 256,
      jsonMode: true,
      estimatedCostEur: 0.001,
    });
    const parsed = result.json as Record<string, unknown>;
    return {
      score: (parsed.overall as number) ?? 50,
      finding: (parsed.top_issue as string) ?? "",
    };
  } catch (err) {
    return { score: 50, finding: `LLM eval failed: ${String(err).slice(0, 60)}` };
  }
}

async function evalCaptionQuality(caption: string, articleTitle: string, locale: string | null): Promise<{ score: number; finding: string }> {
  const lang = locale?.startsWith("en") ? "English" : locale?.startsWith("de") ? "German" : "unknown";
  try {
    const result = await messages({
      projectId: PROJECT_ID,
      operation: "audit:caption-eval",
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "You are a social media content quality auditor. Respond with ONLY a valid JSON object. No markdown, no explanation.",
      userMessage: `Article: "${articleTitle}"\nExpected language: ${lang}\nCaption:\n"""\n${caption}\n"""\n\nEvaluate (0-100 each): hook quality, clarity, CTA effectiveness, language match.\nJSON: {"overall": 0, "hooks": 0, "clarity": 0, "cta": 0, "language_match": 0, "top_issue": "one sentence max"}`,
      maxTokens: 200,
      jsonMode: true,
      estimatedCostEur: 0.001,
    });
    const parsed = result.json as Record<string, unknown>;
    return {
      score: (parsed.overall as number) ?? 50,
      finding: (parsed.top_issue as string) ?? "",
    };
  } catch (err) {
    return { score: 50, finding: `LLM eval failed: ${String(err).slice(0, 60)}` };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log("Fetching articles...");
const articleRows = await db.execute(sql`
  SELECT id, title, locale, status, intent_type, meta_description, word_count,
         self_review_score, self_review_issues, hero_image_public_url,
         frontmatter_extras, tags, category, body_md, cluster_key
  FROM articles
  WHERE project_id = ${PROJECT_ID}
    AND status = ANY(ARRAY['published','final_review']::article_status[])
  ORDER BY RANDOM()
  LIMIT ${ARTICLE_SAMPLE}
`);

console.log("Fetching social posts...");
const socialRows = await db.execute(sql`
  SELECT sp.id, sp.template_key, sp.locale, sp.status, sp.render_status,
         sp.total_slides, sp.content, sp.cost_eur,
         a.title AS article_title, a.intent_type, a.cluster_key
  FROM social_posts sp
  JOIN articles a ON a.id = sp.article_id
  WHERE sp.project_id = ${PROJECT_ID}
    AND sp.render_status = 'rendered'
  ORDER BY RANDOM()
  LIMIT ${SOCIAL_SAMPLE}
`);

const startMs = Date.now();
console.log(`Evaluating ${articleRows.length} articles...`);

const articleFindings: ArticleFinding[] = [];
for (const rawRow of articleRows) {
  const row = rawRow as Record<string, unknown>;
  const { score: structScore, issues } = checkArticle(row);

  let llmScore = 70;
  const body = row.body_md as string | null;
  if (body && body.length > 200) {
    const ev = await evalArticleBodyQuality(row.title as string, body);
    llmScore = ev.score;
    if (llmScore < 60) {
      issues.push({ criterion: "content_quality", severity: "critical", finding: `LLM eval (${llmScore}/100): ${ev.finding}` });
    } else if (llmScore < 75) {
      issues.push({ criterion: "content_quality", severity: "warning", finding: `LLM eval (${llmScore}/100): ${ev.finding}` });
    }
  }

  articleFindings.push({
    id: row.id as string,
    title: row.title as string,
    locale: row.locale as string | null,
    status: row.status as string,
    score: Math.round(structScore * 0.6 + llmScore * 0.4),
    issues,
  });
  process.stdout.write(".");
}
console.log();

console.log(`Evaluating ${socialRows.length} social posts...`);
const socialFindings: SocialFinding[] = [];
for (const rawRow of socialRows) {
  const row = rawRow as Record<string, unknown>;
  const { score: structScore, issues } = checkSocialPost(row);

  const content = row.content as Record<string, unknown> | null;
  const caption = content?.caption as string | null;
  let llmScore = 70;
  if (caption && caption.length > 20) {
    const ev = await evalCaptionQuality(caption, row.article_title as string, row.locale as string | null);
    llmScore = ev.score;
    if (llmScore < 60) {
      issues.push({ criterion: "caption_quality", severity: "warning", finding: `LLM eval (${llmScore}/100): ${ev.finding}` });
    }
  }

  socialFindings.push({
    id: row.id as string,
    article_title: row.article_title as string,
    template_key: row.template_key as string | null,
    locale: row.locale as string | null,
    score: Math.round(structScore * 0.7 + llmScore * 0.3),
    issues,
  });
  process.stdout.write(".");
}
console.log();

// ── Aggregate ────────────────────────────────────────────────────────────────

const artAvg = Math.round(articleFindings.reduce((s, f) => s + f.score, 0) / articleFindings.length);
const artPass = articleFindings.filter(f => f.score >= 70).length;
const artCritical = articleFindings.reduce((s, f) => s + f.issues.filter(i => i.severity === "critical").length, 0);
const artWarnings = articleFindings.reduce((s, f) => s + f.issues.filter(i => i.severity === "warning").length, 0);

const spAvg = Math.round(socialFindings.reduce((s, f) => s + f.score, 0) / socialFindings.length);
const spPass = socialFindings.filter(f => f.score >= 70).length;
const spCritical = socialFindings.reduce((s, f) => s + f.issues.filter(i => i.severity === "critical").length, 0);
const spWarnings = socialFindings.reduce((s, f) => s + f.issues.filter(i => i.severity === "warning").length, 0);

const artIssueCounts: Record<string, number> = {};
for (const f of articleFindings) for (const i of f.issues) artIssueCounts[i.criterion] = (artIssueCounts[i.criterion] ?? 0) + 1;
const artTopIssues = Object.entries(artIssueCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v}x)`);

const spIssueCounts: Record<string, number> = {};
for (const f of socialFindings) for (const i of f.issues) spIssueCounts[i.criterion] = (spIssueCounts[i.criterion] ?? 0) + 1;
const spTopIssues = Object.entries(spIssueCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} (${v}x)`);

// ── JSON output ──────────────────────────────────────────────────────────────

const jsonOutput = {
  meta: { auditDate: AUDIT_DATE, projectId: PROJECT_ID, projectName: PROJECT_NAME, articlesSampled: articleFindings.length, socialPostsSampled: socialFindings.length, durationMs: Date.now() - startMs },
  summary: {
    articles: { avgScore: artAvg, passRate: artPass / articleFindings.length, passCount: artPass, totalCount: articleFindings.length, criticalFailures: artCritical, warnings: artWarnings, topIssues: artTopIssues },
    socialPosts: { avgScore: spAvg, passRate: spPass / socialFindings.length, passCount: spPass, totalCount: socialFindings.length, criticalFailures: spCritical, warnings: spWarnings, topIssues: spTopIssues },
  },
  articles: articleFindings,
  socialPosts: socialFindings,
};

const jsonPath = join(OUTPUT_DIR, `audit-${AUDIT_DATE}.json`);
writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
console.log(`Written: ${jsonPath}`);

// ── Markdown output ──────────────────────────────────────────────────────────

const lowArticles = articleFindings.filter(f => f.score < 70).sort((a, b) => a.score - b.score);
const lowSocial = socialFindings.filter(f => f.score < 70).sort((a, b) => a.score - b.score);

const allIssueCounts: Record<string, number> = {};
for (const f of [...articleFindings, ...socialFindings]) for (const i of f.issues) allIssueCounts[i.criterion] = (allIssueCounts[i.criterion] ?? 0) + 1;
const topRecs = Object.entries(allIssueCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

const md = `# LLM Quality Audit — ${PROJECT_NAME}

**Date:** ${AUDIT_DATE}
**Project ID:** \`${PROJECT_ID}\`
**Sample:** ${articleFindings.length} articles, ${socialFindings.length} social posts
**Duration:** ${((Date.now() - startMs) / 1000).toFixed(1)}s

---

## Executive Summary

| | Articles | Social Posts |
|---|---|---|
| **Avg Score** | ${artAvg}/100 | ${spAvg}/100 |
| **Pass Rate (≥70)** | ${artPass}/${articleFindings.length} (${Math.round(artPass / articleFindings.length * 100)}%) | ${spPass}/${socialFindings.length} (${Math.round(spPass / socialFindings.length * 100)}%) |
| **Critical Issues** | ${artCritical} | ${spCritical} |
| **Warnings** | ${artWarnings} | ${spWarnings} |

### Top Issues — Articles
${artTopIssues.map(i => `- \`${i}\``).join("\n")}

### Top Issues — Social Posts
${spTopIssues.map(i => `- \`${i}\``).join("\n")}

---

## Articles

### All Sampled Articles

| Title | Locale | Status | Score | Top Issue |
|---|---|---|---|---|
${articleFindings.map(f => {
  const top = f.issues.find(i => i.severity === "critical") ?? f.issues.find(i => i.severity === "warning") ?? f.issues[0];
  const t = f.title.length > 48 ? f.title.slice(0, 45) + "..." : f.title;
  const icon = f.score >= 80 ? "✅" : f.score >= 70 ? "🟡" : "🔴";
  return `| ${t} | ${f.locale ?? "—"} | ${f.status} | ${icon} **${f.score}** | ${top?.finding?.slice(0, 60) ?? "OK"} |`;
}).join("\n")}

### Articles Scoring Below 70 — Detail

${lowArticles.length === 0 ? "_All articles scored ≥70._" : lowArticles.map(f => `
#### ${f.title.slice(0, 80)}
**Score:** ${f.score}/100 | **ID:** \`${f.id}\` | **Locale:** ${f.locale ?? "—"} | **Status:** ${f.status}

${f.issues.map(i => `- **[${i.severity.toUpperCase()}]** \`${i.criterion}\`: ${i.finding}`).join("\n")}
`).join("\n")}

---

## Social Posts

### All Sampled Social Posts

| Article | Template | Locale | Score | Top Issue |
|---|---|---|---|---|
${socialFindings.map(f => {
  const top = f.issues.find(i => i.severity === "critical") ?? f.issues.find(i => i.severity === "warning") ?? f.issues[0];
  const t = f.article_title.length > 38 ? f.article_title.slice(0, 35) + "..." : f.article_title;
  const icon = f.score >= 80 ? "✅" : f.score >= 70 ? "🟡" : "🔴";
  return `| ${t} | ${f.template_key ?? "*(null)*"} | ${f.locale ?? "—"} | ${icon} **${f.score}** | ${top?.finding?.slice(0, 60) ?? "OK"} |`;
}).join("\n")}

### Social Posts Scoring Below 70 — Detail

${lowSocial.length === 0 ? "_All social posts scored ≥70._" : lowSocial.map(f => `
#### ${f.article_title}
**Score:** ${f.score}/100 | **ID:** \`${f.id}\` | **Template:** ${f.template_key ?? "null"} | **Locale:** ${f.locale ?? "—"}

${f.issues.map(i => `- **[${i.severity.toUpperCase()}]** \`${i.criterion}\`: ${i.finding}`).join("\n")}
`).join("\n")}

---

## Recommendations

Top issues by frequency across both content types:

${topRecs.map(([criterion, count], idx) => `${idx + 1}. **\`${criterion}\`** — ${count} occurrence(s)`).join("\n")}

### Specific Fixes

| Issue | Fix |
|---|---|
| \`hero_image\` missing | Ensure image generation step populates \`hero_image_public_url\` for all articles |
| \`slide_urls\` localhost | Social render worker uploads to dev server, not R2. Check \`STORAGE_BASE_URL\` env or R2 upload step in render worker. |
| \`cost_tracking\` zero | Caption LLM cost not forwarded to \`social_posts.cost_eur\`. Update render worker to sum step costs on completion. |
| \`template_key\` null | Legacy posts pre-Spec 54k. Consider one-time backfill based on slide count / content shape. |
| \`locale_mismatch\` | \`locale\` not passed to \`GenerateCaptionStep\` for EN-locale posts. Check pipeline step wiring in social render worker. |

---
*Generated by LLM Quality Audit — read-only, no DB writes.*
`;

const mdPath = join(OUTPUT_DIR, `audit-${AUDIT_DATE}.md`);
writeFileSync(mdPath, md);
console.log(`Written: ${mdPath}`);

process.exit(0);
