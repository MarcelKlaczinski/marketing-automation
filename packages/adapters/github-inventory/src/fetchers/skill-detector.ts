/**
 * Spec 64.20: skill detection.
 *
 * Skill rows use `source_identifier = "owner/repo"` for standalone skill repos
 * OR `source_identifier = "owner/repo:subdir"` for skills inside mono-repos
 * (e.g. `anthropics/skills:web-design`). This module reads the SKILL.md file
 * at the appropriate path and parses its YAML frontmatter into the
 * `skillFrontmatter` shape expected by `GithubInventoryMetadata`.
 *
 * Parser is intentionally minimal — handles only top-level scalar keys
 * (name, description, category, version). SKILL.md is a thin standard.
 */
import { fetchRepoContents } from "../client.ts";
import type { GitHubCredentials, RateLimitSnapshot } from "../types.ts";

export interface SkillFrontmatter {
  name: string;
  description: string;
  category?: string;
  version?: string;
}

export interface DetectSkillResult {
  /** Parsed frontmatter, or `null` if SKILL.md not found / unparseable. */
  frontmatter: SkillFrontmatter | null;
  rateLimit: RateLimitSnapshot | null;
}

/**
 * Detect SKILL.md for a given source identifier.
 *
 * Path resolution:
 * - bare `owner/repo` → `SKILL.md` in repo root
 * - `owner/repo:subdir` → `subdir/SKILL.md` (mono-repo case)
 * - subdir can be nested (`owner/repo:packages/foo`)
 */
export async function detectSkill(
  sourceIdentifier: string,
  creds: GitHubCredentials,
): Promise<DetectSkillResult> {
  const { fullName, subdir } = parseSourceIdentifier(sourceIdentifier);
  const path = subdir ? `${subdir}/SKILL.md` : `SKILL.md`;
  const result = await fetchRepoContents(fullName, path, creds);
  if (!result.body) {
    return { frontmatter: null, rateLimit: result.rateLimit };
  }
  const decoded = decodeBase64(result.body.content);
  const frontmatter = parseSkillFrontmatter(decoded);
  return { frontmatter, rateLimit: result.rateLimit };
}

/** Split `"owner/repo"` or `"owner/repo:subdir"` into the two parts. Exported for tests. */
export function parseSourceIdentifier(sourceIdentifier: string): {
  fullName: string;
  subdir: string | null;
} {
  const colonIdx = sourceIdentifier.indexOf(":");
  if (colonIdx === -1) {
    return { fullName: sourceIdentifier, subdir: null };
  }
  const fullName = sourceIdentifier.slice(0, colonIdx);
  const subdir = sourceIdentifier.slice(colonIdx + 1).trim();
  return { fullName, subdir: subdir.length === 0 ? null : subdir };
}

/**
 * Parse a SKILL.md file body for its frontmatter block.
 * Returns `null` if no frontmatter, or if `name` / `description` are missing
 * (those are the only required fields per the SKILL.md standard).
 *
 * Exported for tests.
 */
export function parseSkillFrontmatter(body: string): SkillFrontmatter | null {
  // Frontmatter block is delimited by `---` at the very top of the file
  // (allow leading whitespace / BOM).
  const trimmed = body.replace(/^﻿/, "").trimStart();
  if (!trimmed.startsWith("---")) return null;

  const afterOpen = trimmed.slice(3);
  // Tolerate either `\n` or `\r\n` after the opening `---`
  const closeIdx = afterOpen.search(/\n---\s*(\n|$)/);
  if (closeIdx === -1) return null;

  const block = afterOpen.slice(0, closeIdx);
  const fields: Record<string, string> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    // Strip wrapping quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0 && value.length > 0) {
      fields[key] = value;
    }
  }

  const name = fields.name;
  const description = fields.description;
  if (!name || !description) return null;

  const result: SkillFrontmatter = { name, description };
  if (fields.category) result.category = fields.category;
  if (fields.version) result.version = fields.version;
  return result;
}

/** Decode a base64 string with newlines (GitHub returns base64 + `\n` every 60 chars). */
function decodeBase64(b64: string): string {
  const cleaned = b64.replace(/\n/g, "");
  // Bun + Node both support `Buffer.from(..., "base64")` via the global Buffer
  return Buffer.from(cleaned, "base64").toString("utf-8");
}
