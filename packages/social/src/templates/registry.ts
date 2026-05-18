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
      const extras = (article.frontmatterExtras ?? {}) as { pros?: unknown[] };
      const prosCount = Array.isArray(extras.pros) ? extras.pros.length : 0;
      const { minProsCount, maxProsCount } = (resolved as { eligibility: { minProsCount: number; maxProsCount: number } }).eligibility;
      if (prosCount < minProsCount) {
        return { eligible: false, reason: `Too few pros (override min: ${minProsCount})` };
      }
      if (prosCount > maxProsCount) {
        return { eligible: false, reason: `Too many pros (override max: ${maxProsCount})` };
      }
    }

    if (key === "use-case-verdict-per-tool") {
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
