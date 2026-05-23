# New-Domain Onboarding Checklist

> **Audience:** anyone adding a 3rd / 4th / N-th tenant Astro site to the
> marketing-tool after Sprint multi-domain-evolution.
> **Status:** post-Sprints 1–5 of `feature/multi-domain-datamodel`.
> **Goal:** onboard a new domain end-to-end **without modifying tool code** —
> just config + per-domain extras module + DB seed.

This checklist is the canonical handover doc. Each step ends with a verify
SQL or test command so you know it actually landed.

---

## Pre-flight — repo state

- [ ] Working on a fresh feature branch (`feature/onboard-<domain-slug>`).
- [ ] `bun install` clean. `bun --filter '*' typecheck` returns **0 errors** across all packages.
- [ ] `bun --filter @marketing-auto/content-schema test` is **green** — this is the package the new domain registers into.

---

## Step 1 — Add the per-domain extras module

The new tenant gets its own folder under `packages/content-schema/src/domains/<niche-slug>/`. Mirror the Toolwiki layout exactly:

```
packages/content-schema/src/domains/<niche>/
├── index.ts                # barrel — re-exports all extras + spec
├── extras-blog.ts          # if the tenant has a blog collection
├── extras-comparison.ts    # if comparison articles
├── extras-tools.ts         # if tool catalogue
├── extras-usecases.ts      # if usecase articles
├── extras-<other>.ts       # any tenant-specific collection
└── spec.ts                 # DomainSpec — registers the niche
```

**Each extras file** exports:
- A Zod `<Collection>ExtrasSchema` covering ONLY the Bucket-C (per-domain) fields. Bucket-A/B fields are already in `baseFrontmatter()` Core.
- A `validate<Collection>Extras(raw)` function returning a tagged union (Pattern 111: never throws — the call site escalates).

Look at [`packages/content-schema/src/domains/toolwiki/extras-blog.ts`](../../packages/content-schema/src/domains/toolwiki/extras-blog.ts) for the canonical shape.

**`spec.ts`** exports a `DomainSpec` with:

```typescript
import type { DomainSpec } from "../../registry/domain-registry.ts";
import { BkBlogExtrasSchema } from "./extras-blog.ts";
import { BK_BLOG_INTENT_TYPES } from "./extras-blog.ts";

export const bkDomain: DomainSpec = {
  niche: "<niche-slug>",          // must match projects.target_niche
  domain: "<example-domain.de>",
  locales: ["de"] as const,        // or ["de","en"] for bilingual
  collections: [
    { name: "blog", extrasSchema: BkBlogExtrasSchema },
    // ...
  ],
  intentTaxonomy: BK_BLOG_INTENT_TYPES,
};
```

**Verify:**
```bash
bun --filter @marketing-auto/content-schema typecheck
# 0 errors
```

---

## Step 2 — Register the DomainSpec with the runtime

Two paths depending on where the boot-time registry construction lives in your environment. Today the production wiring is **deferred** (Sprint 5 ship); the registry contract is in place but not yet routed by RenderMdxStep / DraftStep / brief-route consumers.

When wiring is live:
- [ ] Add `<niche>Domain` to the array passed to `createDbBackedRegistry(...)` in the worker bootstrap.
- [ ] Or for an isolated test: `forNicheStatic([myDomain], "<niche>", "<domain>")` returns a `DomainContext` you can validate against directly.

**Verify:**
```typescript
// Smoke test (file: packages/content-schema/test/<niche>-domain.test.ts)
import { forNicheStatic } from "../src/registry/index.ts";
import { bkDomain } from "../src/domains/<niche>/spec.ts";

const ctx = forNicheStatic([bkDomain], "<niche-slug>", "<domain>");
expect(ctx?.getAllowedCollections()).toContain("blog");
```

---

## Step 3 — Create the project row

The runtime resolves tenant-specific behaviour off `projects.target_niche` + `projects.domain`. Both columns must be set BEFORE any pipeline runs for the new tenant.

```sql
INSERT INTO projects (slug, name, industry, pipeline_template, domain, target_niche, target_locales)
VALUES (
  '<project-slug>',
  '<display name>',
  'renewable_affiliate',         -- or pick from industryEnum
  'affiliate_review',            -- or another pipelineTemplateEnum value
  '<example-domain.de>',
  '<niche-slug>',                -- must match the DomainSpec.niche above
  '["de-DE"]'::jsonb             -- or '["de-DE","en-US"]' for bilingual
);
```

**Verify:**
```sql
SELECT slug, target_niche, domain, target_locales
FROM projects
WHERE slug = '<project-slug>';
-- target_niche must match the spec.ts niche field; domain must match
```

---

## Step 4 — Seed `content_categories` for the new tenant

The Toolwiki seed in [`packages/db/drizzle/0095_seed_toolwiki_categories.sql`](../../packages/db/drizzle/0095_seed_toolwiki_categories.sql) is the canonical pattern. Write a new SQL migration (idempotent via `ON CONFLICT (project_id, scope, slug) DO NOTHING`):

```sql
-- packages/db/drizzle/<next-idx>_seed_<niche>_categories.sql
DO $$
DECLARE
  v_project_id uuid;
BEGIN
  SELECT id INTO v_project_id FROM projects WHERE slug = '<project-slug>' LIMIT 1;
  IF v_project_id IS NULL THEN RETURN; END IF;

  INSERT INTO content_categories (project_id, slug, scope, translations) VALUES
    (v_project_id, 'mikrowechselrichter', 'product',
      '{"de":{"label":"Mikrowechselrichter","urlSlug":"mikrowechselrichter"}}'::jsonb)
    -- ... more rows
  ON CONFLICT (project_id, scope, slug) DO NOTHING;
END $$;
```

Don't forget to add the journal entry in `packages/db/drizzle/meta/_journal.json` (idx + when strictly greater than the last entry).

**Verify:**
```sql
SELECT scope, COUNT(*) FROM content_categories
WHERE project_id = (SELECT id FROM projects WHERE slug = '<project-slug>')
GROUP BY scope;
```

---

## Step 5 — Seed `classifier_examples` (optional but recommended)

The trend-synthesizer prompt picks up per-tenant classifier examples from `projects.classifier_examples` JSONB. Without them, the tenant falls back to the Toolwiki defaults — which produce wrong-domain classifications.

```sql
UPDATE projects SET classifier_examples = '{
  "knowledge": {
    "counterExamples": [
      {"title": "EcoFlow PowerStream review", "reasonExcluded": "tool-specific review", "correctIntent": "review"},
      ...
    ],
    "positiveExamples": [
      {"title": "Wie funktioniert ein MPPT-Tracker?", "reasonIncluded": "mechanism explainer"},
      ...
    ]
  }
}'::jsonb
WHERE slug = '<project-slug>';
```

3 counter + 3 positive examples is a minimum; 6 + 6 (matching Spec 64.14 Toolwiki shape) is recommended.

**Verify:**
```sql
SELECT jsonb_array_length(classifier_examples->'knowledge'->'counterExamples') AS n_counter,
       jsonb_array_length(classifier_examples->'knowledge'->'positiveExamples') AS n_positive
FROM projects WHERE slug = '<project-slug>';
```

---

## Step 6 — Register the niche prompt variables

Edit [`packages/pipelines/src/_lib/tenant-prompt-vars.ts`](../../packages/pipelines/src/_lib/tenant-prompt-vars.ts) and add an entry to `NICHE_PROMPT_VARS` keyed by your niche slug:

```typescript
"<niche-slug>": {
  domain: "<example-domain.de>",
  nicheArticle: "ein Balkonkraftwerk-Affiliate-Magazin",
  nicheContentScope: "Balkonkraftwerke, Solarmodule, Wechselrichter, Speicher",
  nicheScopeShort: "Balkonkraftwerk-Themen",
  nicheExampleEntities: "Anker SOLIX, EcoFlow PowerStream, Hoymiles HMS-800W",
  knowledgePillarLabel: "Ratgeber-Pillar",
  comparisonEntityLabel: "2-4 Produkte",
  socialEditorScope: "comparison-grid-4 Instagram slide",
  socialHookNiche: "balcony-solar niche",
  nicheGermanKeyword: "Balkonkraftwerke",
},
```

All 10 fields are required — TypeScript catches a missing one at the function-call site.

**Verify:**
```typescript
import { tenantPromptVarsForNiche } from "@marketing-auto/pipelines/_lib/tenant-prompt-vars";
const vars = tenantPromptVarsForNiche("<niche-slug>", "<example-domain.de>");
expect(vars.nicheArticle).toContain("Balkonkraftwerk");
```

---

## Step 7 — Configure signal sources (optional)

If the new tenant wants Hacker News / Reddit / vendor RSS signals, register the per-source config in `project_configurations.signal_sources`. See Spec 59.1c + the Toolwiki rows for the shape.

For a non-AI tenant, set HN + GitHub `enabled: false` (the canonical anti-pattern from Spec 64.14: AI-Themen-Signale für Balkonkraftwerk = noise).

---

## Step 8 — Run cold-start (optional)

Cold-start phases (competitor analysis, cluster generation, etc.) use the niche map in [`packages/pipelines/src/cold-start/_lib/niche-context.ts`](../../packages/pipelines/src/cold-start/_lib/niche-context.ts). Make sure the niche is registered there with:
- `exampleCompetitors` (international + DACH)
- `topicalKeywords`
- `contentTypes`

If the niche isn't registered, cold-start falls back to a generic LLM-inferred profile (acceptable but produces worse signal).

---

## Step 9 — Astro repo + GitHub App

The astro-sync adapter requires the new tenant's repo to be wired:
- [ ] GitHub App installed on the tenant's repo
- [ ] `projects.astro_repo` JSONB populated with `{owner, name, installationId, defaultBranch, contentRoot, assetsRoot}`
- [ ] `src/content/config.ts` in the tenant repo exports Zod schemas for every collection name registered in the `DomainSpec`
- [ ] `ExtractCollectionSchemasStep` (Spec 50) runs at first import; the result lands in `projects.astro_collection_schemas` JSONB

The Spec-50 path remains as a **fallback** for prompts that haven't yet been wired to the Domain-Registry (transitional state during Sprints 1–5).

---

## Step 10 — Smoke test the full pipeline

```bash
# 1. Generate one article (dry-run via the standalone wizard)
bun --filter @marketing-auto/api article:generate -- --project=<slug> --topic="..." --collection=blog

# 2. Verify the LLM-output has tenant-specific niche-label
psql "$DATABASE_URL" -c "SELECT body_md FROM articles WHERE project_id = (SELECT id FROM projects WHERE slug='<slug>') ORDER BY created_at DESC LIMIT 1;"

# 3. Verify the synthesizer prompt picks up classifier_examples
bun --filter @marketing-auto/api trends:synthesize <slug>
# Check: the brief titles classified as "knowledge" use niche-specific concept language,
# not Toolwiki AI concepts
```

---

## Known limitations (post-Sprint-5)

- **Production wiring of the Domain-Registry into RenderMdxStep / DraftStep / brief-route is deferred.** The registry contract is in place (Sprint 5 S5.2 ships the types + builders + Toolwiki spec), but the boundary validator at the Astro-write seam still reads from the Spec-50 JSONB (`projects.astroCollectionSchemas`). For new tenants this means: the Spec-50 path must be configured even though the Domain-Registry could replace it. Follow-up specs will route through the registry primarily and keep Spec-50 only for boot-time bootstrap.
- **`frontmatter_extras` column was NOT renamed to `domain_extras` in Sprint 5** (originally planned; 163 ref sites + cosmetic-only made it not worth the risk). The column keeps its name.
- **Cold-start prompts still have hardcoded "AI" wording in places** that aren't keyed by `projects.targetNiche`. A new tenant with a non-AI niche may see "AI tools" leak into a generated outline if it predates the cold-start prompt rewrite (post-Sprint-5 follow-up).

## See also

- [`docs/specs/multi-domain-evolution/spec.md`](../specs/multi-domain-evolution/spec.md) — the spec that built this onboarding path
- [`docs/discovery/content-schema-synthesis.md`](../discovery/content-schema-synthesis.md) — Phase-1 audit (Toolwiki Astro repo)
- [`docs/discovery/marketing-tool-datenmodell-synthese.md`](../discovery/marketing-tool-datenmodell-synthese.md) — Phase-2 audit (Tool repo)
- [`packages/content-schema/README.md`](../../packages/content-schema/README.md) — package shape + consumer list
