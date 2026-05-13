import type { Article, ArticleDiscovery } from "@marketing-auto/db";
import type { EligibilityResult, TemplateDefinition, TemplateKey } from "./types.ts";

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
}

export const templateRegistry = new TemplateRegistry();
