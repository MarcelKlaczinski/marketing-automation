# Spec 54d — Template Preview Gallery (Admin-UI)

**Type:** Internal Tooling (Admin-Only)
**Estimate:** 2.5-3h, 3 commits
**Depends on:** Spec 54a (TemplateRegistry + mockFixtures pro Template)
**Goal:** Visuelle Iteration beim Template-Bau ohne dauerhafte Live-Daten-Generation

---

## Context

Aktuell musst du um ein Template zu sehen einen vollen Article-Generation-Run starten (Cost, Wartezeit, Risk dass falsche Daten ausgewählt werden). Das macht Template-Polish ineffizient.

**Diese Spec:** Eigene Admin-Route `/admin/templates` mit Grid aller registrierten Templates × beide Themes, gerendert mit hardcoded Mock-Fixtures aus jedem Template. Plus optional: Sample-Article-Modus zum Vergleich mit echten Daten.

**Wichtig: hardcoded Fixtures** (deine Decision) — kein LLM, kein Random-Sample-Default. Fixtures sind in jedem Template-File (siehe Spec 54a §4) definiert, gallery rendert sie 1:1.

---

## Sub-Section 1: Backend-API für Template-Rendering

**Estimate:** 1h, 1 commit
**Files:**
- `apps/api/src/routes/admin/templates/index.ts` (new)
- `apps/api/src/routes/admin/templates/preview.ts` (new)

### GET /admin/templates

Lists alle registrierten Templates + deren Mock-Fixtures.

```typescript
async function listTemplates(req, res) {
  const templates = templateRegistry.list();
  return res.json({
    templates: templates.map(t => ({
      key: t.key,
      displayName: t.displayName,
      description: t.description,
      defaultSlideCount: t.defaultSlideCount,
      estimatedCostUsd: t.estimatedCostUsd,
      fixtures: Object.entries(t.mockFixtures).map(([key, f]) => ({
        key,
        name: f.name,
        description: f.description,
      })),
    })),
  });
}
```

### POST /admin/templates/:key/preview

Triggert Render mit Mock-Fixture oder Sample-Article.

```typescript
interface PreviewRequest {
  source: 'fixture' | 'sample-article';
  fixtureKey?: string;       // wenn source='fixture'
  sampleArticleId?: string;  // wenn source='sample-article'
  theme: 'dark' | 'light';
  locale: 'de' | 'en';
}

async function previewTemplate(req, res) {
  const { key } = req.params;
  const { source, fixtureKey, sampleArticleId, theme, locale }: PreviewRequest = req.body;
  
  const template = templateRegistry.getById(key);
  
  // Build input
  let renderContext;
  if (source === 'fixture') {
    const fixture = template.mockFixtures[fixtureKey];
    if (!fixture) throw new BadRequestError(`Fixture ${fixtureKey} not found`);
    renderContext = {
      article: createMockArticle(fixture),     // fake article for context
      discovery: createMockDiscovery(fixture),
      locale,
      theme,
      input: fixture.input,
    };
  } else {
    const article = await loadArticle(sampleArticleId);
    const discovery = await loadDiscovery(sampleArticleId);
    const eligibility = template.eligibility(article, discovery);
    if (!eligibility.eligible) {
      return res.status(400).json({ 
        error: 'Template not eligible for this article',
        reason: eligibility.reason,
      });
    }
    const input = await template.buildInput(article, discovery);
    renderContext = { article, discovery, locale, theme, input };
  }
  
  // Render (no persistence — straight to in-memory PNGs)
  const result = await template.render(renderContext);
  
  // Return URLs to preview-cached files (no DB persist)
  return res.json({
    slides: result.slides,
    caption: result.caption,
    hashtags: result.hashtags,
    metadata: result.metadata,
    cacheKey: hashRenderInput(renderContext),  // für client-side caching
  });
}
```

### Preview-Cache (Performance)

Render-Output für Mock-Fixtures changiert nur wenn Template-Code sich ändert. Server kann caching:

```typescript
// Cache-Key = templateKey + fixtureKey + theme + locale + git-commit-sha (optional)
// Cache lebt in Redis mit 1h TTL
// Bei "force-refresh" Button in UI: cache wird bypassed
```

**Acceptance:**
- GET /admin/templates returnt 2 templates (comparison-stunning, use-case-verdict-per-tool) mit fixtures
- POST /admin/templates/use-case-verdict-per-tool/preview mit fixture rendert in ~2-3s
- Eligibility-Check funktioniert bei sample-article
- Cache greift bei zweitem identischen Request

**Commit message:** `feat(admin): add template preview API with fixture and sample-article modes`

---

## Sub-Section 2: Gallery-UI Grid

**Estimate:** 1.5h, 1 commit
**Files:**
- `apps/web/src/router/admin.ts` (modify — add route)
- `apps/web/src/pages/admin/templates/TemplatesIndexPage.vue` (new)
- `apps/web/src/components/admin/templates/TemplateCard.vue` (new)
- `apps/web/src/components/admin/templates/TemplatePreviewModal.vue` (new — Spec §3)

### Route

```typescript
// apps/web/src/router/admin.ts
{
  path: '/admin/templates',
  component: () => import('@/pages/admin/templates/TemplatesIndexPage.vue'),
  meta: { requiresAdmin: true, title: 'Template Gallery' },
},
```

### TemplatesIndexPage.vue

```vue
<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-md">
      <div class="text-h5">Template Gallery</div>
      <q-space />
      <q-btn 
        flat 
        icon="refresh" 
        label="Reload"
        @click="loadTemplates"
      />
    </div>
    
    <div v-if="loading" class="text-center q-pa-xl">
      <q-spinner size="md" />
    </div>
    
    <div v-else>
      <div v-for="template in templates" :key="template.key" class="q-mb-xl">
        <div class="row items-baseline q-mb-sm">
          <div class="text-h6">{{ template.displayName }}</div>
          <q-chip dense size="sm" class="q-ml-sm">{{ template.key }}</q-chip>
          <q-space />
          <div class="text-caption text-grey-7">
            {{ template.defaultSlideCount }} slides · ~${{ template.estimatedCostUsd.toFixed(3) }}/render
          </div>
        </div>
        
        <div class="text-body2 q-mb-md text-grey-7">{{ template.description }}</div>
        
        <!-- Fixtures-Grid: pro Fixture eine Karte mit Dark+Light Preview -->
        <div class="row q-col-gutter-md">
          <div 
            v-for="fixture in template.fixtures" 
            :key="fixture.key"
            class="col-12 col-md-6"
          >
            <TemplateCard
              :template-key="template.key"
              :fixture="fixture"
              @open-preview="onOpenPreview"
            />
          </div>
        </div>
      </div>
    </div>
    
    <TemplatePreviewModal 
      v-model="previewOpen"
      :preview-data="currentPreview"
    />
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import TemplateCard from '@/components/admin/templates/TemplateCard.vue';
import TemplatePreviewModal from '@/components/admin/templates/TemplatePreviewModal.vue';

export default defineComponent({
  name: 'TemplatesIndexPage',
  components: { TemplateCard, TemplatePreviewModal },
  data: () => ({
    templates: [],
    loading: false,
    previewOpen: false,
    currentPreview: null,
  }),
  async mounted() {
    await this.loadTemplates();
  },
  methods: {
    async loadTemplates() {
      this.loading = true;
      try {
        const result = await this.$api.get('/admin/templates');
        this.templates = result.templates;
      } finally {
        this.loading = false;
      }
    },
    onOpenPreview(payload: { templateKey: string; fixtureKey: string }) {
      this.currentPreview = payload;
      this.previewOpen = true;
    },
  },
});
</script>
```

### TemplateCard.vue — Side-by-Side Theme Preview

```vue
<template>
  <q-card>
    <q-card-section>
      <div class="text-subtitle1">{{ fixture.name }}</div>
      <div class="text-caption text-grey-7">{{ fixture.description }}</div>
    </q-card-section>
    
    <q-separator />
    
    <q-card-section class="q-pa-sm">
      <div class="row q-col-gutter-sm">
        <!-- Dark Theme -->
        <div class="col-6">
          <div class="text-caption text-center q-mb-xs">Dark</div>
          <div 
            class="preview-thumb"
            :class="{ loading: loadingDark }"
            @click="openPreview('dark')"
          >
            <q-img 
              v-if="darkPreviewUrl" 
              :src="darkPreviewUrl" 
              ratio="0.8"
              spinner-color="white"
            />
            <q-btn 
              v-else 
              outline 
              dense 
              icon="play_arrow"
              label="Render"
              @click.stop="loadPreview('dark')"
            />
          </div>
        </div>
        
        <!-- Light Theme -->
        <div class="col-6">
          <div class="text-caption text-center q-mb-xs">Light</div>
          <div 
            class="preview-thumb"
            :class="{ loading: loadingLight }"
            @click="openPreview('light')"
          >
            <q-img 
              v-if="lightPreviewUrl" 
              :src="lightPreviewUrl" 
              ratio="0.8"
            />
            <q-btn 
              v-else 
              outline 
              dense 
              icon="play_arrow"
              label="Render"
              @click.stop="loadPreview('light')"
            />
          </div>
        </div>
      </div>
    </q-card-section>
    
    <q-card-actions>
      <q-btn 
        flat 
        dense
        icon="refresh"
        label="Beide neu"
        @click="reloadBoth"
      />
      <q-space />
      <q-btn 
        flat 
        dense
        icon="open_in_new"
        label="Detail"
        @click="openPreview('dark')"
      />
    </q-card-actions>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'TemplateCard',
  props: {
    templateKey: { type: String, required: true },
    fixture: { type: Object, required: true },
  },
  emits: ['open-preview'],
  data: () => ({
    darkPreviewUrl: null as string | null,
    lightPreviewUrl: null as string | null,
    loadingDark: false,
    loadingLight: false,
  }),
  async mounted() {
    // Lazy-load: erst render bei first interaction, oder auto-load wenn klein.
    // Default: nicht auto-load (User clickt "Render")
  },
  methods: {
    async loadPreview(theme: 'dark' | 'light') {
      const loadingProp = theme === 'dark' ? 'loadingDark' : 'loadingLight';
      this[loadingProp] = true;
      try {
        const result = await this.$api.post(`/admin/templates/${this.templateKey}/preview`, {
          source: 'fixture',
          fixtureKey: this.fixture.key,
          theme,
          locale: 'de',
        });
        const urlProp = theme === 'dark' ? 'darkPreviewUrl' : 'lightPreviewUrl';
        // first slide as thumbnail
        this[urlProp] = result.slides[0]?.filePath;
      } finally {
        this[loadingProp] = false;
      }
    },
    async reloadBoth() {
      this.darkPreviewUrl = null;
      this.lightPreviewUrl = null;
      await Promise.all([
        this.loadPreview('dark'),
        this.loadPreview('light'),
      ]);
    },
    openPreview(theme: 'dark' | 'light') {
      this.$emit('open-preview', {
        templateKey: this.templateKey,
        fixtureKey: this.fixture.key,
        theme,
      });
    },
  },
});
</script>

<style scoped>
.preview-thumb {
  aspect-ratio: 4/5;
  background: #1a1a1a;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.2s;
}
.preview-thumb.loading { opacity: 0.5; }
.preview-thumb:hover { opacity: 0.85; }
</style>
```

**Acceptance:**
- Route `/admin/templates` lädt
- Alle registrierten Templates angezeigt
- Pro Template: alle Fixtures als Card mit Dark+Light Slots
- "Render"-Button triggert Preview-API
- Thumbnail wird angezeigt nach Render
- "Beide neu" lädt beide Themes parallel
- Cache greift: 2. Render desselben Fixtures ist instant

**Commit message:** `feat(admin): add template gallery page with side-by-side theme previews`

---

## Sub-Section 3: Detail-Modal mit allen Slides + Sample-Article-Toggle

**Estimate:** 1h, 1 commit
**Files:**
- `apps/web/src/components/admin/templates/TemplatePreviewModal.vue` (new)

```vue
<template>
  <q-dialog v-model="show" maximized>
    <q-card>
      <q-toolbar class="bg-dark text-white">
        <q-toolbar-title>
          {{ previewData?.templateKey }}
          <span class="text-caption q-ml-md">{{ previewData?.fixtureKey }}</span>
        </q-toolbar-title>
        
        <q-btn-toggle
          v-model="currentTheme"
          :options="[
            { label: 'Dark', value: 'dark' },
            { label: 'Light', value: 'light' },
          ]"
          @update:model-value="reload"
        />
        
        <q-btn-toggle
          v-model="currentLocale"
          class="q-ml-sm"
          :options="[
            { label: 'DE', value: 'de' },
            { label: 'EN', value: 'en' },
          ]"
          @update:model-value="reload"
        />
        
        <q-btn-toggle
          v-model="dataSource"
          class="q-ml-sm"
          :options="[
            { label: 'Fixture', value: 'fixture' },
            { label: 'Sample Article', value: 'sample-article' },
          ]"
          @update:model-value="onSourceChange"
        />
        
        <q-btn flat icon="refresh" @click="reload" />
        <q-btn flat icon="close" v-close-popup />
      </q-toolbar>
      
      <q-card-section>
        <!-- Article-Picker wenn sample-article mode -->
        <div v-if="dataSource === 'sample-article'" class="q-mb-md">
          <q-select
            v-model="selectedArticleId"
            :options="eligibleArticles"
            label="Article auswählen"
            emit-value
            map-options
            @update:model-value="reload"
          />
        </div>
        
        <!-- Slides Grid -->
        <div v-if="loading" class="text-center q-pa-xl">
          <q-spinner size="md" />
        </div>
        
        <div v-else-if="renderResult" class="row q-col-gutter-md">
          <div 
            v-for="(slide, i) in renderResult.slides" 
            :key="i"
            class="col-12 col-sm-6 col-md-4 col-lg-3"
          >
            <q-img 
              :src="slide.filePath" 
              :ratio="slide.width / slide.height"
              spinner-color="white"
            />
            <div class="text-caption text-center q-mt-xs">
              Slide {{ i + 1 }}
            </div>
          </div>
        </div>
        
        <!-- Caption + Hashtags -->
        <div v-if="renderResult" class="q-mt-lg">
          <div class="text-subtitle2">Caption</div>
          <q-input 
            type="textarea" 
            :model-value="renderResult.caption" 
            readonly 
            outlined
            autogrow
          />
          
          <div class="text-subtitle2 q-mt-md">Hashtags ({{ renderResult.hashtags.length }})</div>
          <div class="q-mt-xs">
            <q-chip 
              v-for="tag in renderResult.hashtags" 
              :key="tag" 
              dense 
              size="sm"
            >
              #{{ tag }}
            </q-chip>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'TemplatePreviewModal',
  props: {
    modelValue: { type: Boolean, required: true },
    previewData: { type: Object, default: null },
  },
  emits: ['update:modelValue'],
  data: () => ({
    show: false,
    currentTheme: 'dark' as 'dark' | 'light',
    currentLocale: 'de' as 'de' | 'en',
    dataSource: 'fixture' as 'fixture' | 'sample-article',
    selectedArticleId: null as string | null,
    eligibleArticles: [],
    renderResult: null as any,
    loading: false,
  }),
  watch: {
    modelValue(v: boolean) { 
      this.show = v;
      if (v && this.previewData) {
        this.currentTheme = this.previewData.theme ?? 'dark';
        this.reload();
      }
    },
    show(v: boolean) { this.$emit('update:modelValue', v); },
  },
  methods: {
    async onSourceChange() {
      if (this.dataSource === 'sample-article') {
        await this.loadEligibleArticles();
      }
      await this.reload();
    },
    async loadEligibleArticles() {
      const result = await this.$api.get(
        `/admin/templates/${this.previewData.templateKey}/eligible-articles`,
        { params: { locale: this.currentLocale } }
      );
      this.eligibleArticles = result.articles.map(a => ({
        label: `${a.title} (${a.slug})`,
        value: a.id,
      }));
      if (this.eligibleArticles.length > 0 && !this.selectedArticleId) {
        this.selectedArticleId = this.eligibleArticles[0].value;
      }
    },
    async reload() {
      if (!this.previewData) return;
      this.loading = true;
      try {
        const body: any = {
          theme: this.currentTheme,
          locale: this.currentLocale,
          source: this.dataSource,
        };
        if (this.dataSource === 'fixture') {
          body.fixtureKey = this.previewData.fixtureKey;
        } else {
          if (!this.selectedArticleId) {
            await this.loadEligibleArticles();
          }
          body.sampleArticleId = this.selectedArticleId;
        }
        
        this.renderResult = await this.$api.post(
          `/admin/templates/${this.previewData.templateKey}/preview`,
          body,
        );
      } finally {
        this.loading = false;
      }
    },
  },
});
</script>
```

### Server Endpoint: GET /admin/templates/:key/eligible-articles

```typescript
async function listEligibleArticles(req, res) {
  const { key } = req.params;
  const { locale = 'de', limit = 50 } = req.query;
  
  const template = templateRegistry.getById(key);
  
  // Load all articles + discoveries (could be inefficient — paginate or filter for production)
  const allArticles = await db.select().from(articles)
    .where(eq(articles.locale, locale))
    .limit(limit);
  const discoveries = await db.select().from(articleDiscovery)
    .where(inArray(articleDiscovery.article_id, allArticles.map(a => a.id)));
  const discoveryMap = new Map(discoveries.map(d => [d.article_id, d]));
  
  const eligible = allArticles.filter(article => {
    const discovery = discoveryMap.get(article.id);
    if (!discovery) return false;
    return template.eligibility(article, discovery).eligible;
  });
  
  return res.json({
    articles: eligible.map(a => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      collection: a.collection,
    })),
  });
}
```

**Acceptance:**
- Modal öffnet sich nach Click auf Fixture-Card
- Theme + Locale + Source-Toggle funktional, triggert reload
- Sample-Article-Mode listed eligible articles
- Switch Fixture → Sample-Article zeigt Real-Data-Render
- Caption + Hashtags angezeigt
- Slides als Grid, klickbar zum vergrößern (via q-img-builtin)

**Commit message:** `feat(admin): add full-screen template preview modal with theme/locale/source toggles`

---

## Migration / Setup

Keine DB-Migration nötig — Gallery liest nur aus existing Tabellen.

Aber: render-output muss serve-bar sein. Wenn aktuell Render-Files nur in `/mnt/user-data/outputs/...` liegen (file-system), muss API einen statischen Serve-Endpoint haben:

```typescript
// apps/api/src/routes/admin/preview-assets/[...path].ts
// Serves files from RENDER_CACHE_DIR
```

Oder S3/CDN wenn das schon existiert.

---

## Commit-Reihenfolge

```
1. §1   Backend Preview-API              1h     commit 1
2. §2   Gallery Index-Page + TemplateCard 1.5h  commit 2
3. §3   Detail-Modal + Sample-Article    1h     commit 3
```

**Total: 3.5h, 3 commits.**

---

## Acceptance (final)

- ✅ `/admin/templates` listet alle registrierten Templates
- ✅ Pro Template: alle Fixtures als Cards
- ✅ Dark + Light Preview parallel triggerbar
- ✅ Detail-Modal mit allen Slides, Caption, Hashtags
- ✅ Fixture vs Sample-Article Toggle
- ✅ Sample-Article-Picker filtert nur eligible Articles
- ✅ Cache greift bei wiederholten Renders
- ✅ Force-Reload-Button bypassed Cache

---

## Out of Scope

- ⏸️ Hot-Reload bei Template-Code-Change (würde Vite-Dev-Server-Integration brauchen — manuell "Beide neu" reicht)
- ⏸️ Diff-View zwischen zwei Render-Versionen
- ⏸️ Export der Preview als ZIP
- ⏸️ A/B-Test-Setup zwischen Template-Varianten
- ⏸️ Performance-Metrics pro Render (sichtbar nur in BullMQ-Logs)

---

## How You Use This After Merge

**Beim Template-Bauen:**
1. Schreibst neue Template-Definition in `packages/social/src/templates/definitions/`
2. Definierst `mockFixtures` mit 2-3 charakteristischen Beispielen
3. Registrierst in `bootstrap.ts`
4. Restart API
5. Refresh `/admin/templates` — neues Template ist da
6. Click "Render" auf Fixture → siehst Dark + Light sofort
7. Code-Iteration → "Beide neu" für Refresh
8. Bei Real-Data-Test: "Sample Article" Toggle → wählst echten Article

**Beim Template-Review (z.B. nach LLM-Hook-Change):**
1. `/admin/templates` öffnen
2. Schnell-Durchgang aller Templates × beider Themes
3. Visual-Regressions sofort sichtbar
