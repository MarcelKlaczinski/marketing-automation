import type { Article, ArticleDiscovery } from "@marketing-auto/db";
import type { EligibilityResult, TemplateDefinition, TemplateKey } from "./types.ts";
import {
  getOverrideSchema,
  isOverrideTemplateKey,
  mergeOverrides,
} from "./overrides/index.ts";

export interface EligibleTemplate {
  template: TemplateDefinition;
  result: EligibilityResult;
}

class TemplateRegistry {
  private readonly templates = new Map<TemplateKey, TemplateDefinition>();

  register<T>(template: TemplateDefinition<T>): void {
    if (this.templates.has(template.key)) {
      throw new Error(`Template "${template.key}" is already registered`);
    }
    this.templates.set(template.key, template as TemplateDefinition);
  }

  /**
   * Spec 65.0 Day 3 — hot-reload entry point. Replaces an existing entry by
   * key without the duplicate-registration guard of `register()`. Used by
   * the filesystem-watcher (API process) and the change-subscriber (worker
   * process) to swap in a fresh module after a definition file was edited.
   *
   * If the key was previously absent the call behaves like `register()`.
   * Returns `true` when an existing entry was overwritten, `false` when
   * the key was new.
   */
  replace<T>(template: TemplateDefinition<T>): boolean {
    const existed = this.templates.has(template.key);
    this.templates.set(template.key, template as TemplateDefinition);
    return existed;
  }

  /**
   * Spec 65.0 Day 3 — remove an entry by key. Used by tests for cleanup;
   * production code does NOT remove entries on file-unlink (renders in
   * flight could break), it only deactivates the DB row.
   *
   * Accepts a plain `string` rather than narrowing to `TemplateKey` so
   * test fixtures with synthetic keys (outside the published union) can
   * call it without `as TemplateKey` casts. Returns `true` if the key existed.
   */
  unregister(key: string): boolean {
    return this.templates.delete(key as TemplateKey);
  }

  getById(key: TemplateKey): TemplateDefinition {
    const t = this.templates.get(key);
    if (!t) throw new Error(`Template "${key}" is not registered`);
    return t;
  }

  list(): TemplateDefinition[] {
    return Array.from(this.templates.values());
  }

  /**
   * Returns all templates whose eligibility predicate returns true for this article.
   * Result is stable-sorted alphabetically by template key.
   */
  listEligibleFor(article: Article, discovery: ArticleDiscovery): EligibleTemplate[] {
    return this.list()
      .map((template) => ({ template, result: template.eligibility(article, discovery) }))
      .filter((x) => x.result.eligible)
      .sort((a, b) => a.template.key.localeCompare(b.template.key));
  }

  /**
   * Eligibility check with project-scoped override gates applied.
   * Callers that have already fetched overrides should use this to apply
   * override-specific min/max bounds (e.g. minProsCount for single-tool-spotlight).
   */
  checkEligibilityWithOverrides(
    key: TemplateKey,
    article: Article,
    discovery: ArticleDiscovery,
    storedOverrides: Record<string, unknown> | null,
  ): EligibilityResult {
    const template = this.templates.get(key);
    if (!template) return { eligible: false, reason: `Template "${key}" is not registered` };

    const base = template.eligibility(article, discovery);
    if (!base.eligible) return base;

    if (!isOverrideTemplateKey(key)) return base;

    const schema = getOverrideSchema(key);
    const resolved = mergeOverrides(schema, storedOverrides);

    if (key === "single-tool-spotlight") {
      const extras = (article.domainExtras ?? {}) as { pros?: unknown[] };
      const prosCount = Array.isArray(extras.pros) ? extras.pros.length : 0;
      const { minProsCount, maxProsCount } = (resolved as { eligibility: { minProsCount: number; maxProsCount: number } }).eligibility;
      if (prosCount < minProsCount) {
        return { eligible: false, reason: `Too few pros (override min: ${minProsCount})` };
      }
      if (prosCount > maxProsCount) {
        return { eligible: false, reason: `Too many pros (override max: ${maxProsCount})` };
      }
    }

    if (key === "verdict-per-use-case") {
      const { useCaseVerdicts } = discovery as { useCaseVerdicts?: unknown[] };
      const verdictsCount = Array.isArray(useCaseVerdicts) ? useCaseVerdicts.length : 0;
      const { minVerdictsCount } = (resolved as { eligibility: { minVerdictsCount: number } }).eligibility;
      if (verdictsCount < minVerdictsCount) {
        return { eligible: false, reason: `Too few verdicts (override min: ${minVerdictsCount})` };
      }
    }

    return base;
  }
}

export const templateRegistry = new TemplateRegistry();
