import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createLogger } from "@marketing-auto/shared";

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
  return contents
    .map((c, i) => `# Skill: ${names[i]}\n\n${c}`)
    .join("\n\n---\n\n");
}

/**
 * Loads project marketing context document.
 * Path: project-contexts/<project-slug>/.agents/product-marketing-context.md
 */
const projectContextsRoot = resolve(import.meta.dir, "../../../../project-contexts");

export async function loadProjectContext(projectSlug: string): Promise<string | null> {
  const path = join(projectContextsRoot, projectSlug, ".agents/product-marketing-context.md");
  try {
    return await readFile(path, "utf-8");
  } catch {
    log.warn({ projectSlug }, "No project marketing context found");
    return null;
  }
}

/** For tests: clear the in-memory cache */
export function _resetSkillCache(): void {
  skillCache.clear();
}
