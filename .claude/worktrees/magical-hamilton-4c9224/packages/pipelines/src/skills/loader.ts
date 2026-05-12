import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { db, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";

const log = createLogger("skills");

/**
 * Skills are markdown files under packages/skills/skills/<name>/SKILL.md.
 * That folder is a git submodule of coreyhaines31/marketingskills.
 *
 * loadSkill returns the raw markdown content. Pipeline steps inject this
 * into LLM system prompts (with prompt caching, the same skill content is
 * cheap to send repeatedly).
 */

// import.meta.dir = packages/pipelines/src/skills/
const skillsRoot = resolve(import.meta.dir, "../../../skills/skills");
const skillCache = new Map<string, string>();

export async function loadSkill(name: string): Promise<string> {
  if (skillCache.has(name)) return skillCache.get(name)!;

  const path = join(skillsRoot, name, "SKILL.md");
  try {
    const content = await readFile(path, "utf-8");
    skillCache.set(name, content);
    log.debug({ name, sizeBytes: content.length }, "Skill loaded");
    return content;
  } catch (e) {
    log.error({ name, path, error: e }, "Failed to load skill");
    throw new Error(`Skill not found: ${name} (looked in ${path})`);
  }
}

/**
 * Loads multiple skills and returns them concatenated with separator headers.
 * Useful for steps that need multiple domains (e.g., copywriting + ai-seo).
 */
export async function loadSkills(names: string[]): Promise<string> {
  const contents = await Promise.all(names.map(loadSkill));
  return contents.map((c, i) => `# Skill: ${names[i]}\n\n${c}`).join("\n\n---\n\n");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTEXT_CACHE_TTL_MS = 60_000;

type ContextCacheEntry = { md: string; cachedAt: number };
const projectContextCache = new Map<string, ContextCacheEntry>();

export async function loadProjectContext(projectIdOrSlug: string): Promise<string | null> {
  const cached = projectContextCache.get(projectIdOrSlug);
  if (cached && Date.now() - cached.cachedAt < CONTEXT_CACHE_TTL_MS) {
    return cached.md;
  }

  const isUuid = UUID_RE.test(projectIdOrSlug);
  const rows = await db
    .select({ md: projects.marketingContextMd, updatedAt: projects.marketingContextUpdatedAt })
    .from(projects)
    .where(isUuid ? eq(projects.id, projectIdOrSlug) : eq(projects.slug, projectIdOrSlug))
    .limit(1);

  const row = rows[0];
  if (!row?.md) {
    return null;
  }

  projectContextCache.set(projectIdOrSlug, { md: row.md, cachedAt: Date.now() });
  return row.md;
}

/** For tests: clear the in-memory caches */
export function _resetSkillCache(): void {
  skillCache.clear();
}

export function _resetProjectContextCache(): void {
  projectContextCache.clear();
}
