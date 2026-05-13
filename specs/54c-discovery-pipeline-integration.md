# Spec 54c — Discovery-Pipeline-Integration + UI-Gate + Gap-Generation-Hook

**Type:** Pipeline + UI Integration
**Estimate:** 3-4h, 4 commits
**Depends on:** Spec 54a (TemplateRegistry), Spec 54b (article_discovery populated)
**Goal:** Future-proof Discovery-Updates für Imports und Gap-Generated Articles

---

## Context & Three Lifecycles

Diese Spec adressiert drei Article-Lifecycles wo Discovery-Updates automatisch passieren müssen:

```
Lifecycle 1: Astro-Re-Import (periodisch)
  → User triggert Import im Admin
  → Articles werden imported/updated
  → UI-Gate-Modal: "X new + Y updated articles. Discovery jetzt laufen lassen? (Cost: ~$Z)"
  → Bei Approval: BullMQ-Job pro Article, async

Lifecycle 2: Manuelle Gap-Generation (User clickt "Gap fixen")
  → Existing Pipeline (Spec 49c) generiert Article
  → Discovery-Step direkt im Anschluss (sync, weil neuer Content garantiert Discovery braucht)
  → Suggestions im Result-Modal angezeigt
  → User kann direkt Template-Generation triggern oder später im Admin

Lifecycle 3: Auto-Pipeline-Gap-Generation (Cron-getriggert)
  → Auto-Pipeline detektiert Gap, generiert Article
  → Discovery-Step direkt im Anschluss
  → Suggestions persistiert in article_discovery.suggested_templates
  → KEINE auto-generierten Templates (per Decision: nur suggestions, kein auto-publish)
  → Notification-Counter im Admin-Header inkrementiert
```

**Wichtig — entschieden:**
- Auto-Pipeline = nur Suggestions, KEINE Auto-Template-Generation
- Suggestions-Review-UI = neuer Tab im SocialPostsPanel ("Suggestions")
- Kein zusätzlicher LLM-Call für Suggestions (wiederverwendet aus Discovery)

---

## Sub-Section 1: DiscoveryStep als wiederverwendbarer Pipeline-Step

**Estimate:** 1.5h, 1 commit
**Files:**
- `packages/pipelines/src/article/discovery/discoverArticleStep.ts` (new)
- `packages/pipelines/src/article/discovery/llmEnrichment.ts` (new)
- `packages/pipelines/src/article/discovery/deterministicEnrichment.ts` (new)
- `packages/pipelines/src/article/discovery/index.ts` (barrel)

### discoverArticleStep.ts

```typescript
import { db } from '@/db';
import { articleDiscovery } from '@/db/schema/article-discovery';
import { articles } from '@/db/schema/articles';
import { eq } from 'drizzle-orm';
import { runDeterministicEnrichment } from './deterministicEnrichment';
import { runLlmEnrichment } from './llmEnrichment';
import { computeContentHash } from './contentHash';

export interface DiscoverArticleStepInput {
  articleId: string;
  mode: 'deterministic_only' | 'full';
  forceRefresh?: boolean;
}

export interface DiscoverArticleStepResult {
  articleId: string;
  status: 'enriched' | 'skipped_unchanged' | 'failed';
  enrichmentMode: 'deterministic' | 'llm_enriched';
  durationMs: number;
  costUsd: number;
  error?: string;
}

export async function discoverArticleStep(
  input: DiscoverArticleStepInput,
): Promise<DiscoverArticleStepResult> {
  const startedAt = Date.now();
  
  try {
    // 1. Load article
    const [article] = await db.select().from(articles)
      .where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new Error(`Article ${input.articleId} not found`);
    
    // 2. Compute current content hash
    const currentHash = computeContentHash(article.body_md, article.frontmatter);
    
    // 3. Load existing discovery (if any)
    const [existing] = await db.select().from(articleDiscovery)
      .where(eq(articleDiscovery.articleId, input.articleId)).limit(1);
    
    // 4. Skip check: same hash + already llm_enriched + not force-refresh
    if (
      !input.forceRefresh
      && existing?.content_hash === currentHash
      && existing?.enrichment_mode === 'llm_enriched'
    ) {
      return {
        articleId: input.articleId,
        status: 'skipped_unchanged',
        enrichmentMode: 'llm_enriched',
        durationMs: Date.now() - startedAt,
        costUsd: 0,
      };
    }
    
    // 5. Run deterministic enrichment (always)
    const deterministic = await runDeterministicEnrichment(article);
    
    // 6. Run LLM enrichment if mode === 'full'
    let llmFields = {};
    let llmCost = 0;
    if (input.mode === 'full') {
      const llmResult = await runLlmEnrichment(article, deterministic);
      llmFields = llmResult.fields;
      llmCost = llmResult.costUsd;
    }
    
    // 7. Upsert
    const enrichmentMode = input.mode === 'full' ? 'llm_enriched' : 'deterministic';
    await db.insert(articleDiscovery).values({
      article_id: input.articleId,
      ...deterministic,
      ...llmFields,
      content_hash: currentHash,
      enrichment_run_at: new Date(),
      enrichment_mode: enrichmentMode,
    }).onConflictDoUpdate({
      target: articleDiscovery.articleId,
      set: {
        ...deterministic,
        ...llmFields,
        content_hash: currentHash,
        enrichment_run_at: new Date(),
        enrichment_mode: enrichmentMode,
        updated_at: new Date(),
      },
    });
    
    return {
      articleId: input.articleId,
      status: 'enriched',
      enrichmentMode,
      durationMs: Date.now() - startedAt,
      costUsd: llmCost,
    };
  } catch (err) {
    return {
      articleId: input.articleId,
      status: 'failed',
      enrichmentMode: 'deterministic',
      durationMs: Date.now() - startedAt,
      costUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

### contentHash.ts

```typescript
import { createHash } from 'crypto';

export function computeContentHash(bodyMd: string, frontmatter: unknown): string {
  return createHash('md5')
    .update(bodyMd)
    .update(JSON.stringify(frontmatter ?? {}))
    .digest('hex');
}
```

### Pricing-relevant: llmEnrichment.ts

Uses Anthropic SDK with Haiku for cost. Single-call per article (kein batch-API in dieser Sub-Section um Komplexität niedrig zu halten — Batch-API kann später als Performance-Spec ergänzt werden).

```typescript
const HAIKU_INPUT_COST_PER_1M = 0.80;  // USD per 1M input tokens
const HAIKU_OUTPUT_COST_PER_1M = 4.00;

export async function runLlmEnrichment(
  article: Article,
  deterministic: DeterministicResult,
): Promise<{ fields: LlmFields; costUsd: number }> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: buildEnrichmentPrompt(article, deterministic),
    }],
  });
  
  const parsed = parseEnrichmentResponse(response.content);
  const costUsd = 
    (response.usage.input_tokens / 1_000_000) * HAIKU_INPUT_COST_PER_1M +
    (response.usage.output_tokens / 1_000_000) * HAIKU_OUTPUT_COST_PER_1M;
  
  return { fields: parsed, costUsd };
}
```

**Acceptance:**
- Unit tests: skip-logic mit content_hash funktional
- Unit tests: deterministic-only vs full mode
- Integration test: full enrichment für 1 article
- Cost tracking ist accurate (compare with Anthropic dashboard)

**Commit message:** `feat(pipelines): add reusable discoverArticleStep with content-hash skip-logic`

---

## Sub-Section 2: Import-Pipeline-Hook + UI-Gate

**Estimate:** 1.5h, 1 commit
**Files:**
- `apps/api/src/routes/admin/articles/import.ts` (modify)
- `apps/web/src/pages/admin/articles/ArticleImportPage.vue` (modify)
- `apps/web/src/components/admin/DiscoveryGateModal.vue` (new)
- `packages/api/src/queues/discoveryQueue.ts` (new)

### Server-Side: Discovery-Queue

```typescript
// packages/api/src/queues/discoveryQueue.ts
import { Queue, Worker } from 'bullmq';
import { redisConnection } from '@/config/redis';
import { discoverArticleStep } from '@org/pipelines';

export const discoveryQueue = new Queue('discovery', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,  // paid LLM jobs: kein retry (per Lesson-Learned #7)
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 100 },
  },
});

export const discoveryWorker = new Worker(
  'discovery',
  async (job) => {
    return await discoverArticleStep({
      articleId: job.data.articleId,
      mode: job.data.mode,
      forceRefresh: job.data.forceRefresh,
    });
  },
  { connection: redisConnection, concurrency: 3 },
);
```

### Import-Endpoint mit Discovery-Trigger

Existing `POST /admin/articles/import` Endpoint wird erweitert:

```typescript
// Response shape erweitert:
interface ImportResult {
  imported: number;
  updated: number;
  unchanged: number;
  failed: number;
  articleIds: {
    new: string[];
    updated: string[];
  };
  discoveryRequired: boolean;
  discoveryCostEstimateUsd: number;
}

// Neuer Endpoint für approval:
// POST /admin/articles/import/:importBatchId/trigger-discovery
// Body: { mode: 'full' | 'deterministic_only' }
async function triggerDiscoveryAfterImport(req, res) {
  const { importBatchId } = req.params;
  const { mode } = req.body;
  const articleIds = await loadArticleIdsFromBatch(importBatchId);
  
  for (const articleId of articleIds) {
    await discoveryQueue.add('discover-article', { articleId, mode });
  }
  
  return res.json({ enqueued: articleIds.length });
}
```

### UI-Modal: DiscoveryGateModal.vue

```vue
<template>
  <q-dialog v-model="show" persistent>
    <q-card style="min-width: 480px">
      <q-card-section>
        <div class="text-h6">Discovery für neue Articles</div>
        <p class="text-body2 q-mt-sm">
          Import abgeschlossen. {{ stats.new + stats.updated }} Articles benötigen Discovery-Update.
        </p>
        
        <q-list dense>
          <q-item>
            <q-item-section>Neu importiert</q-item-section>
            <q-item-section side>{{ stats.new }}</q-item-section>
          </q-item>
          <q-item>
            <q-item-section>Updated</q-item-section>
            <q-item-section side>{{ stats.updated }}</q-item-section>
          </q-item>
          <q-item>
            <q-item-section>Unchanged (skip)</q-item-section>
            <q-item-section side>{{ stats.unchanged }}</q-item-section>
          </q-item>
        </q-list>
        
        <p class="text-caption q-mt-md text-grey-7">
          Geschätzter Cost: ~${{ costEstimate.toFixed(2) }} (Haiku LLM-Klassifikation)
        </p>
      </q-card-section>
      
      <q-card-actions align="right">
        <q-btn flat label="Später" v-close-popup @click="onSkip" />
        <q-btn flat label="Nur deterministisch" @click="onTriggerDeterministic" />
        <q-btn unelevated color="primary" label="Discovery starten" @click="onTriggerFull" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'DiscoveryGateModal',
  props: {
    modelValue: { type: Boolean, required: true },
    stats: { type: Object, required: true },
    importBatchId: { type: String, required: true },
  },
  emits: ['update:modelValue', 'triggered', 'skipped'],
  data: () => ({
    show: false,
  }),
  computed: {
    costEstimate(): number {
      return (this.stats.new + this.stats.updated) * 0.005;
    },
  },
  watch: {
    modelValue(v: boolean) { this.show = v; },
    show(v: boolean) { this.$emit('update:modelValue', v); },
  },
  methods: {
    async onTriggerFull() {
      await this.$api.post(`/admin/articles/import/${this.importBatchId}/trigger-discovery`, {
        mode: 'full',
      });
      this.$emit('triggered', { mode: 'full' });
      this.show = false;
    },
    async onTriggerDeterministic() {
      await this.$api.post(`/admin/articles/import/${this.importBatchId}/trigger-discovery`, {
        mode: 'deterministic_only',
      });
      this.$emit('triggered', { mode: 'deterministic_only' });
      this.show = false;
    },
    onSkip() {
      this.$emit('skipped');
      this.show = false;
    },
  },
});
</script>
```

### ArticleImportPage.vue Integration

```typescript
async onImport() {
  this.loading = true;
  try {
    const result = await this.$api.post('/admin/articles/import');
    this.importResult = result;
    
    if (result.discoveryRequired && result.imported + result.updated > 0) {
      this.showDiscoveryGate = true;
    }
  } finally {
    this.loading = false;
  }
}
```

**Acceptance:**
- Import-Run zeigt Modal nach Abschluss
- "Discovery starten" enqueued Jobs in discoveryQueue
- "Später" schließt Modal ohne Jobs
- "Nur deterministisch" kapiert mode-Parameter
- Worker verarbeitet Jobs erfolgreich
- Article-List zeigt Discovery-Status-Badge (siehe §3)

**Commit message:** `feat(admin): add discovery-gate modal after article import with cost-estimate`

---

## Sub-Section 3: Gap-Generation-Hook (Manual + Auto)

**Estimate:** 1h, 1 commit
**Files:**
- `packages/pipelines/src/article/gap-to-article/generationStep.ts` (modify)
- `packages/pipelines/src/article/gap-to-article/postGenerationDiscovery.ts` (new)

### Existing Gap-to-Article-Pipeline (Spec 49c)

Erweitere existing GenerationStep um Discovery-Trigger:

```typescript
// packages/pipelines/src/article/gap-to-article/generationStep.ts

import { discoverArticleStep } from '../discovery';

export async function generateArticleFromGap(input: GapToArticleInput): Promise<GapToArticleResult> {
  // ... existing generation logic ...
  const article = await persistArticle(generatedContent);
  
  // NEW: trigger discovery synchronously (we have the context fresh, LLM-call is justified)
  const discoveryResult = await discoverArticleStep({
    articleId: article.id,
    mode: 'full',
    forceRefresh: false,  // wird false sein da neuer article, kein hash existiert
  });
  
  // NEW: include suggestions in result
  const discovery = await loadDiscovery(article.id);
  
  return {
    article,
    discovery,
    suggestedTemplates: discovery.suggested_templates ?? [],
    discoveryStatus: discoveryResult.status,
  };
}
```

### Manual Trigger Flow (UI)

Modal nach Gap-Generation zeigt Suggestions:

```
Article generiert ✓

Vorgeschlagene Templates für diesen Article:

□ Comparison-Stunning (Confidence: 0.95)
  Primary Angle: "Welche KI macht die besten Logos?"
  Estimated Slides: 4
  Cost: $0.01

□ Use-Case-Verdict-per-Tool (Confidence: 0.88)
  Primary Angle: "5 Use-Cases im Direktvergleich"
  Estimated Slides: 8
  Cost: $0.008

[ Alle generieren ] [ Selektion generieren ] [ Später ]
```

User clickt entweder einzeln, "Alle generieren", oder "Später" (Suggestions bleiben in DB, im SocialPostsPanel reviewbar).

**Note:** Render-Trigger-Logic für "Alle generieren" via BullMQ-parallel ist in **separater Sub-Section §4** unten beschrieben.

### Auto-Pipeline Flow

Auto-Pipeline ruft `generateArticleFromGap` sowieso schon (Spec 49c). Diese Spec ändert NICHTS am Auto-Flow — Discovery wird automatisch durch §3-Code mit-aufgerufen. Suggestions landen in DB. KEINE Auto-Template-Generation.

**Notification-Counter** im Admin-Header:

```typescript
// API-Endpoint: GET /admin/notifications/counts
{
  pendingSuggestions: 12,  // articles mit suggested_templates[].length > 0 AND no template_renders
  recentImports: 0,
  // ...
}
```

UI poll'd alle 60s, zeigt Badge.

**Acceptance:**
- Manual gap-fix triggert Discovery sync
- Auto-pipeline-gap-generation triggert Discovery sync (im selben Step)
- Suggestions sind in article_discovery.suggested_templates persistiert
- Notification-Counter inkrementiert pro neuer Pending-Suggestion-Article

**Commit message:** `feat(pipelines): hook discovery into gap-to-article generation for both manual and auto flows`

---

## Sub-Section 4: Multi-Template-Generation UI ("Alle generieren")

**Estimate:** 1h, 1 commit
**Files:**
- `apps/api/src/routes/admin/articles/[id]/generate-templates.ts` (new)
- `apps/web/src/components/admin/social/TemplateSuggestionsPanel.vue` (new)
- `apps/web/src/components/admin/social/SocialPostsPanel.vue` (modify — add Suggestions tab)

### Backend: Multi-Template-Generation Endpoint

```typescript
// POST /admin/articles/:id/generate-templates
// Body: { templateKeys: TemplateKey[], locales?: Locale[], themes?: Theme[] }

async function generateTemplates(req, res) {
  const { id: articleId } = req.params;
  const { templateKeys, locales = ['de'], themes = ['dark'] } = req.body;
  
  const article = await loadArticle(articleId);
  const discovery = await loadDiscovery(articleId);
  
  const jobs = [];
  for (const templateKey of templateKeys) {
    const template = templateRegistry.getById(templateKey);
    const eligibility = template.eligibility(article, discovery);
    if (!eligibility.eligible) {
      jobs.push({
        templateKey,
        status: 'skipped',
        reason: eligibility.reason,
      });
      continue;
    }
    
    for (const locale of locales) {
      for (const theme of themes) {
        const job = await renderQueue.add('render-template', {
          articleId,
          templateKey,
          locale,
          theme,
        });
        jobs.push({
          templateKey,
          locale,
          theme,
          jobId: job.id,
          status: 'queued',
        });
      }
    }
  }
  
  return res.json({ jobs });
}
```

### UI: TemplateSuggestionsPanel.vue

Neuer Tab im SocialPostsPanel — listed alle pending Suggestions:

```vue
<template>
  <div>
    <div v-if="suggestions.length === 0" class="text-center q-pa-lg text-grey-7">
      Keine Suggestions pending. Article importieren oder Gap fixen.
    </div>
    
    <q-list separator>
      <q-item v-for="article in articlesWithSuggestions" :key="article.id">
        <q-item-section>
          <q-item-label>{{ article.title }}</q-item-label>
          <q-item-label caption>
            {{ article.collection }} · {{ article.locale }} · {{ article.suggestions.length }} Templates
          </q-item-label>
          
          <div class="q-mt-sm">
            <q-chip 
              v-for="s in article.suggestions" 
              :key="s.templateKey"
              :clickable="true"
              :outline="!isSelected(article.id, s.templateKey)"
              @click="toggleSelection(article.id, s.templateKey)"
            >
              {{ getTemplateName(s.templateKey) }}
              <q-badge color="info" class="q-ml-xs">
                {{ Math.round(s.confidence * 100) }}%
              </q-badge>
            </q-chip>
          </div>
        </q-item-section>
        
        <q-item-section side>
          <div class="row q-gutter-xs">
            <q-btn 
              dense 
              flat 
              icon="auto_awesome" 
              label="Alle"
              @click="generateAll(article.id)"
            />
            <q-btn 
              dense 
              flat 
              color="primary"
              :disable="getSelected(article.id).length === 0"
              label="Generieren"
              @click="generateSelected(article.id)"
            />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'TemplateSuggestionsPanel',
  data: () => ({
    articlesWithSuggestions: [],
    selections: {} as Record<string, Set<string>>,
  }),
  async mounted() {
    await this.loadSuggestions();
  },
  methods: {
    async loadSuggestions() {
      this.articlesWithSuggestions = await this.$api.get('/admin/social/suggestions');
    },
    isSelected(articleId: string, templateKey: string): boolean {
      return this.selections[articleId]?.has(templateKey) ?? false;
    },
    toggleSelection(articleId: string, templateKey: string) {
      if (!this.selections[articleId]) {
        this.selections[articleId] = new Set();
      }
      const set = this.selections[articleId];
      if (set.has(templateKey)) set.delete(templateKey);
      else set.add(templateKey);
      this.$forceUpdate();
    },
    getSelected(articleId: string): string[] {
      return Array.from(this.selections[articleId] ?? []);
    },
    async generateAll(articleId: string) {
      const article = this.articlesWithSuggestions.find(a => a.id === articleId);
      const allKeys = article.suggestions.map(s => s.templateKey);
      await this.triggerGeneration(articleId, allKeys);
    },
    async generateSelected(articleId: string) {
      const selected = this.getSelected(articleId);
      await this.triggerGeneration(articleId, selected);
    },
    async triggerGeneration(articleId: string, templateKeys: string[]) {
      const result = await this.$api.post(`/admin/articles/${articleId}/generate-templates`, {
        templateKeys,
        locales: ['de'],
        themes: ['dark'],
      });
      this.$q.notify({
        message: `${result.jobs.length} Render-Jobs gequeued`,
        color: 'positive',
      });
      await this.loadSuggestions();
    },
    getTemplateName(key: string): string {
      // map TemplateKey → displayName
      // could be loaded from API or hardcoded
      return key.replace(/-/g, ' ');
    },
  },
});
</script>
```

### SocialPostsPanel.vue Integration

```vue
<template>
  <q-tabs v-model="activeTab">
    <q-tab name="generate" label="Generieren" />
    <q-tab name="suggestions" label="Suggestions">
      <q-badge v-if="pendingCount > 0" color="warning" floating>{{ pendingCount }}</q-badge>
    </q-tab>
    <q-tab name="history" label="Verlauf" />
  </q-tabs>
  
  <q-tab-panels v-model="activeTab">
    <q-tab-panel name="generate"><!-- existing --></q-tab-panel>
    <q-tab-panel name="suggestions">
      <TemplateSuggestionsPanel />
    </q-tab-panel>
    <q-tab-panel name="history"><!-- existing --></q-tab-panel>
  </q-tab-panels>
</template>
```

**Acceptance:**
- Suggestions-Tab zeigt Articles mit pending suggestions
- Click auf Chip selektiert/deselektiert Template
- "Alle generieren" enqueued alle eligible Templates parallel
- "Generieren" mit Selektion enqueued nur ausgewählte
- Pending-Counter im Tab-Badge aktualisiert
- Render-Jobs laufen parallel via BullMQ (concurrency=3 oder höher je nach Worker-Setup)

**Commit message:** `feat(admin): add template suggestions panel with multi-template generation`

---

## Migration

Falls noch nicht durch Spec 54b passiert: `articles` Tabelle bekommt computed-column für Notification-Counter-Effizienz:

```sql
-- Optional: materialized index für schnelle pending-suggestions-Counts
CREATE INDEX article_discovery_pending_suggestions_idx
  ON article_discovery (article_id)
  WHERE jsonb_array_length(suggested_templates) > 0;

-- Wenn template_renders auch existiert (Spec 54a), kann man einen view bauen:
CREATE OR REPLACE VIEW articles_with_pending_suggestions AS
SELECT 
  a.id, a.slug, a.title, a.collection, a.locale,
  d.suggested_templates,
  jsonb_array_length(d.suggested_templates) AS suggestion_count
FROM articles a
JOIN article_discovery d ON d.article_id = a.id
WHERE jsonb_array_length(d.suggested_templates) > 0
  AND NOT EXISTS (
    SELECT 1 FROM template_renders tr
    WHERE tr.article_id = a.id
      AND tr.status IN ('ready', 'rendering')
  );
```

---

## Commit-Reihenfolge

```
1. §1   discoverArticleStep core             1.5h   commit 1
2. §2   Import-Hook + Discovery-Gate-Modal   1.5h   commit 2  
3. §3   Gap-Generation-Hook                  1h     commit 3
4. §4   Multi-Template-Generation UI         1h     commit 4
```

**Total: 5h disziplinierte Arbeit, 4 commits.** (Im Schätzwert leicht über 3-4h weil §4 nicht-trivial)

---

## Acceptance (final)

- ✅ Article-Import triggert Discovery-Gate-Modal
- ✅ Gap-Generation (manual + auto) triggert Discovery sync
- ✅ Suggestions in article_discovery.suggested_templates persistiert
- ✅ Suggestions-Tab in SocialPostsPanel zeigt pending Articles
- ✅ "Alle generieren" + selective generation funktional
- ✅ Multi-Template-Renders laufen parallel via BullMQ
- ✅ Notification-Counter im Admin-Header zeigt pending-Counts
- ✅ Content-Hash skip-logic verhindert unnötige LLM-Calls

---

## Out of Scope

- ⏸️ Batch-API für Bulk-Discovery (separate Performance-Spec)
- ⏸️ Auto-Template-Generation für High-Confidence-Suggestions (deferred, erst nach Engagement-Daten)
- ⏸️ Multi-Locale Multi-Theme bei Generieren-Button (UI hat aktuell hardcoded de+dark — Multi-Choice UI ist nice-to-have für später)
- ⏸️ Drift-Recovery für Failed-Discovery-Jobs (Notification-System eigene Spec)
