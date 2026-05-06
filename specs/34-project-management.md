# Spec 34: Project Management

**Phase:** 4 (Web App Wave 2)
**Estimated Effort:** 2 days (2-3 sessions)
**Dependencies:** Spec 30 (shell), Spec 31 (auth), Spec 33 (settings — for AdapterCard styles to reuse)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (UI composition + CodeMirror integration)

---

## Goal

Build the **project management UI**:
- `/projects` — list of all projects with status indicators
- `/projects/:slug` — Hub-page with tabs: Overview, Cold-Start, Articles, Clusters, Settings
- Project-Create dialog with marketing-context.md CodeMirror editor
- Project-Settings tab with cost limits, astro_repo config, pagespeed thresholds

After this spec:
- Marcel can create new projects via UI (replacing the `add-project` CLI)
- Edit any project's marketing_context.md with Markdown syntax highlighting + live preview
- See per-project stats (cluster count, article count by status, total cost spent)
- Configure project-specific settings without Drizzle Studio

The Cold-Start, Articles, and Clusters tabs are **stubs** in this spec — Spec 35 fills Cold-Start, Welle 3 fills the others.

## Architecture Decisions

**Decision 1: Hub-page with URL-driven tabs.**
`/projects/:slug` is one page. Active tab via `?tab=` query param. Default `overview`. Direct linkable.

**Decision 2: CodeMirror v6 for marketing_context.md.**
Modern, modular, Vue-3-friendly via `vue-codemirror` package (~70KB gzipped). Markdown syntax highlighting via `@codemirror/lang-markdown`. Side-by-side preview rendered with `marked` (already simple to add). Alternative considered: Monaco — too heavy (1.5MB), too much VS-Code-specific behavior.

**Decision 3: Project list shows cards, not a table.**
Each card has: name, slug, industry, cluster count, article count by status (small chips), last activity timestamp, status indicator. Tables work for 50+ entries; we'll have 3-10 projects. Cards convey richer info per row.

**Decision 4: Project Create is a dialog, not a separate page.**
Multi-step dialog: basic info → marketing context. After create, redirects to the new project's hub page.

**Decision 5: marketing_context.md is the canonical document.**
Stored in `projects.marketingContextMd` (existing column). Some projects may have a Cold-Start-Phase-1 generated context that already exists; the editor surfaces this verbatim. Marcel can hand-edit anytime.

**Decision 6: Project Settings tab edits non-content fields.**
Cost limits, astro_repo config, pagespeed thresholds, link rebuild budget. NOT marketing_context.md (that's in Overview tab where it logically belongs as the "what is this project" content).

**Decision 7: No project deletion in this spec.**
Destructive action with cascading effects (clusters, articles, pipeline runs all FK-cascade). Defer to a separate spec or stay manual via Drizzle Studio. Projects are rarely deleted.

**Decision 8: CodeMirror editor saves on blur + explicit "Save" button.**
Auto-save on every keystroke is too aggressive (network spam, version conflicts). Auto-save on blur catches forget-to-save cases. Explicit Save button for confidence. Show "unsaved changes" indicator.

## Non-Goals

- **No project deletion UI**
- **No project archiving / soft-delete**
- **No bulk import of projects** (e.g., from CSV)
- **No project cloning / duplication**
- **No real-time collaborative editing** of marketing_context.md (single-user system)
- **No version history** of marketing_context.md changes (DB has updatedAt; that's it)
- **No project visibility/permissions** (every authenticated user sees all projects today)
- **No filling Cold-Start / Articles / Clusters tabs** — those are stubs in this spec

## Detailed Implementation

### Backend: Project Endpoints

The existing `projectRoutes` (from Spec 14 / earlier specs) likely has CRUD endpoints. Verify they exist; if not, add:

```typescript
// apps/api/src/routes/projects.ts (extend existing)

// List all projects with summary stats
projectRoutes.get('/', requireAuth, async (c) => {
  const allProjects = await db.select().from(projects);

  // For each, fetch cluster count + article counts by status
  const enriched = await Promise.all(allProjects.map(async (proj) => {
    const [clusterCountRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clusters)
      .where(eq(clusters.projectId, proj.id));

    const articleCountsByStatus = await db
      .select({
        status: articles.status,
        count: sql<number>`count(*)::int`,
      })
      .from(articles)
      .where(eq(articles.projectId, proj.id))
      .groupBy(articles.status);

    const articleCounts: Record<string, number> = {};
    for (const row of articleCountsByStatus) {
      articleCounts[row.status] = row.count;
    }

    return {
      id: proj.id,
      slug: proj.slug,
      name: proj.name,
      industry: proj.industry,
      pipelineTemplate: proj.pipelineTemplate,
      createdAt: proj.createdAt,
      updatedAt: proj.updatedAt,
      stats: {
        clusterCount: clusterCountRow?.count ?? 0,
        articleCounts,
        totalArticles: Object.values(articleCounts).reduce((a, b) => a + b, 0),
      },
    };
  }));

  return c.json({ ok: true, data: enriched });
});

// Get one project with full details
projectRoutes.get('/:slug', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const [proj] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!proj) return c.json({ ok: false, error: 'Project not found' }, 404);

  // Same stats as list endpoint
  // ... (inline or extract to helper)

  return c.json({ ok: true, data: { ...proj, stats: { /* ... */ } } });
});

// Create project
const createProjectSchema = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(120),
  industry: z.enum(['saas', 'ecommerce', 'finance', 'health', 'education', 'media', 'other']),
  pipelineTemplate: z.enum(['educational', 'commercial', 'editorial']),
  marketingContextMd: z.string().max(50_000).optional(),
});

projectRoutes.post('/', requireAuth, zValidator('json', createProjectSchema), async (c) => {
  const input = c.req.valid('json');

  // Check slug uniqueness
  const [existing] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, input.slug)).limit(1);
  if (existing) return c.json({ ok: false, error: 'Slug already in use' }, 409);

  const [created] = await db.insert(projects).values({
    slug: input.slug,
    name: input.name,
    industry: input.industry,
    pipelineTemplate: input.pipelineTemplate,
    marketingContextMd: input.marketingContextMd ?? '',
    costLimits: { daily: {}, monthly: {} },
  }).returning();

  return c.json({ ok: true, data: created }, 201);
});

// Update project
const updateProjectSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  industry: z.enum(['saas', 'ecommerce', 'finance', 'health', 'education', 'media', 'other']).optional(),
  pipelineTemplate: z.enum(['educational', 'commercial', 'editorial']).optional(),
  marketingContextMd: z.string().max(50_000).optional(),
  costLimits: z.object({
    daily: z.record(z.number().nonnegative()).optional(),
    monthly: z.record(z.number().nonnegative()).optional(),
  }).optional(),
  astroRepo: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    installationId: z.number().int().positive(),
    defaultBranch: z.string().default('main'),
    contentRoot: z.string().default('src/content'),
    assetsRoot: z.string().default('src/assets'),
  }).nullable().optional(),
  publishDomain: z.string().nullable().optional(),
  pagespeedThresholds: z.object({
    performance: z.number().min(0).max(100),
    accessibility: z.number().min(0).max(100),
    bestPractices: z.number().min(0).max(100),
    seo: z.number().min(0).max(100),
  }).optional(),
  linkRebuildBudgetMonthly: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
});

projectRoutes.patch('/:slug', requireAuth, zValidator('json', updateProjectSchema), async (c) => {
  const slug = c.req.param('slug');
  const input = c.req.valid('json');

  const [existing] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, slug)).limit(1);
  if (!existing) return c.json({ ok: false, error: 'Project not found' }, 404);

  await db.update(projects)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(projects.id, existing.id));

  const [updated] = await db.select().from(projects).where(eq(projects.id, existing.id)).limit(1);
  return c.json({ ok: true, data: updated });
});
```

### Frontend: Project Store

`apps/web/src/stores/projects.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

export interface Project {
  id: string;
  slug: string;
  name: string;
  industry: string;
  pipelineTemplate: string;
  marketingContextMd: string | null;
  publishDomain: string | null;
  costLimits: {
    daily: Record<string, number>;
    monthly: Record<string, number>;
  };
  astroRepo: {
    owner: string;
    name: string;
    installationId: number;
    defaultBranch: string;
    contentRoot: string;
    assetsRoot: string;
  } | null;
  pagespeedThresholds: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
  };
  linkRebuildBudgetMonthly: string;
  createdAt: string;
  updatedAt: string;
  stats?: {
    clusterCount: number;
    articleCounts: Record<string, number>;
    totalArticles: number;
  };
}

interface ProjectsState {
  list: Project[];
  current: Project | null;
  loading: boolean;
}

export const useProjectsStore = defineStore('projects', {
  state: (): ProjectsState => ({
    list: [],
    current: null,
    loading: false,
  }),

  actions: {
    async fetchList(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: Project[] }>('/projects');
        this.list = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(slug: string): Promise<Project | null> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: Project }>(`/projects/${slug}`);
        this.current = res.data.data;
        return this.current;
      } finally {
        this.loading = false;
      }
    },

    async create(input: {
      slug: string;
      name: string;
      industry: string;
      pipelineTemplate: string;
      marketingContextMd?: string;
    }): Promise<Project> {
      const res = await api.post<{ ok: boolean; data: Project }>('/projects', input);
      const created = res.data.data;
      this.list.push(created);
      return created;
    },

    async update(slug: string, patch: Partial<Project>): Promise<Project> {
      const res = await api.patch<{ ok: boolean; data: Project }>(`/projects/${slug}`, patch);
      const updated = res.data.data;
      // Sync list
      const idx = this.list.findIndex((p) => p.slug === slug);
      if (idx >= 0) this.list[idx] = updated;
      if (this.current?.slug === slug) this.current = updated;
      return updated;
    },
  },
});
```

### Frontend: ProjectsPage (List)

`apps/web/src/pages/ProjectsPage.vue`:

```vue
<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('projects.title') }}</h1>
      </div>
      <div class="col-auto">
        <q-btn
          color="primary"
          icon="add"
          :label="$t('projects.createButton')"
          @click="createDialogOpen = true"
        />
      </div>
    </div>

    <div v-if="projectsStore.loading && projectsStore.list.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="projectsStore.list.length === 0" class="text-center q-pa-xl">
      <q-icon name="folder_open" size="64px" color="grey-5" />
      <p class="text-body1 q-mt-md text-grey-7">{{ $t('projects.empty') }}</p>
      <q-btn
        color="primary"
        icon="add"
        :label="$t('projects.createButton')"
        class="q-mt-md"
        @click="createDialogOpen = true"
      />
    </div>

    <div v-else class="project-grid">
      <ProjectListCard
        v-for="proj in projectsStore.list"
        :key="proj.id"
        :project="proj"
        @click="goToProject(proj.slug)"
      />
    </div>

    <ProjectCreateDialog
      v-model="createDialogOpen"
      @created="onProjectCreated"
    />
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import ProjectListCard from 'src/components/projects/ProjectListCard.vue';
import ProjectCreateDialog from 'src/components/projects/ProjectCreateDialog.vue';

export default defineComponent({
  name: 'ProjectsPage',

  components: {
    ProjectListCard,
    ProjectCreateDialog,
  },

  setup() {
    return { projectsStore: useProjectsStore() };
  },

  data: () => ({
    createDialogOpen: false,
  }),

  async created() {
    await this.projectsStore.fetchList();
  },

  methods: {
    goToProject(slug: string): void {
      void this.$router.push({ name: 'project-detail', params: { slug } });
    },

    onProjectCreated(slug: string): void {
      this.createDialogOpen = false;
      this.goToProject(slug);
    },
  },
});
</script>

<style lang="scss" scoped>
.project-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 1280px) {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
```

### Frontend: ProjectListCard

`apps/web/src/components/projects/ProjectListCard.vue`:

```vue
<template>
  <div class="project-card" @click="$emit('click')">
    <div class="project-card__header">
      <div class="project-card__icon" :style="{ background: iconBg }">
        <q-icon :name="industryIcon" size="20px" />
      </div>
      <div class="project-card__main">
        <div class="project-card__name">{{ project.name }}</div>
        <div class="project-card__slug">/{{ project.slug }}</div>
      </div>
    </div>

    <div class="project-card__meta">
      <span class="meta-pill">{{ $t(`industries.${project.industry}`) }}</span>
      <span class="meta-pill">{{ $t(`pipelineTemplates.${project.pipelineTemplate}`) }}</span>
    </div>

    <div v-if="project.stats" class="project-card__stats">
      <div class="stat">
        <div class="stat__value">{{ project.stats.clusterCount }}</div>
        <div class="stat__label">{{ $t('projects.stats.clusters') }}</div>
      </div>
      <div class="stat">
        <div class="stat__value">{{ project.stats.totalArticles }}</div>
        <div class="stat__label">{{ $t('projects.stats.articles') }}</div>
      </div>
      <div class="stat">
        <div class="stat__value">{{ publishedCount }}</div>
        <div class="stat__label">{{ $t('projects.stats.published') }}</div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { Project } from 'src/stores/projects';

const INDUSTRY_ICONS: Record<string, string> = {
  saas: 'cloud',
  ecommerce: 'shopping_bag',
  finance: 'account_balance',
  health: 'favorite',
  education: 'school',
  media: 'article',
  other: 'business',
};

const INDUSTRY_COLORS: Record<string, string> = {
  saas: 'rgba(63, 81, 181, 0.12)',
  ecommerce: 'rgba(255, 152, 0, 0.12)',
  finance: 'rgba(76, 175, 80, 0.12)',
  health: 'rgba(244, 67, 54, 0.12)',
  education: 'rgba(0, 188, 212, 0.12)',
  media: 'rgba(124, 77, 255, 0.12)',
  other: 'rgba(158, 158, 158, 0.18)',
};

export default defineComponent({
  name: 'ProjectListCard',

  props: {
    project: { type: Object as PropType<Project>, required: true },
  },

  emits: ['click'],

  computed: {
    industryIcon(): string {
      return INDUSTRY_ICONS[this.project.industry] ?? 'business';
    },
    iconBg(): string {
      return INDUSTRY_COLORS[this.project.industry] ?? INDUSTRY_COLORS.other!;
    },
    publishedCount(): number {
      return this.project.stats?.articleCounts.published ?? 0;
    },
  },
});
</script>

<style lang="scss" scoped>
.project-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }

  &:hover {
    border-color: var(--q-primary, #3f51b5);
    transform: translateY(-2px);
  }
}

.project-card__header {
  display: flex;
  align-items: flex-start;
  margin-bottom: 12px;
}

.project-card__icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: var(--q-primary, #3f51b5);
}

.project-card__main {
  margin-left: 12px;
  min-width: 0;
}

.project-card__name {
  font-weight: 600;
  font-size: 16px;
}

.project-card__slug {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-family: monospace;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}

.project-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.meta-pill {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.05);
  color: rgba(0, 0, 0, 0.7);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.7);
  }
}

.project-card__stats {
  display: flex;
  gap: 24px;
  border-top: 1px solid var(--q-grey-2, #f0f0f0);
  padding-top: 12px;

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}

.stat {
  text-align: left;
}

.stat__value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
}

.stat__label {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}
</style>
```

### Frontend: ProjectCreateDialog

`apps/web/src/components/projects/ProjectCreateDialog.vue`:

```vue
<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" persistent>
    <q-card style="width: 720px; max-width: 95vw;">
      <q-card-section class="row items-center">
        <div class="text-h6">{{ $t('projects.create.title') }}</div>
        <q-space />
        <q-btn icon="close" flat round dense v-close-popup @click="reset" />
      </q-card-section>

      <q-card-section>
        <q-stepper
          v-model="step"
          color="primary"
          animated
          flat
          header-nav
        >
          <q-step
            :name="1"
            :title="$t('projects.create.basicsStep')"
            icon="info"
            :done="step > 1"
          >
            <div class="q-gutter-md">
              <q-input
                v-model="form.name"
                :label="$t('projects.create.name')"
                outlined
                :rules="[(v: string) => !!v || $t('common.required')]"
              />
              <q-input
                v-model="form.slug"
                :label="$t('projects.create.slug')"
                outlined
                :rules="[
                  (v: string) => !!v || $t('common.required'),
                  (v: string) => /^[a-z0-9-]+$/.test(v) || $t('projects.create.slugInvalid'),
                ]"
              >
                <template v-slot:hint>
                  {{ $t('projects.create.slugHint') }}
                </template>
              </q-input>
              <q-select
                v-model="form.industry"
                :label="$t('projects.create.industry')"
                outlined
                :options="industryOptions"
                emit-value
                map-options
              />
              <q-select
                v-model="form.pipelineTemplate"
                :label="$t('projects.create.pipelineTemplate')"
                outlined
                :options="templateOptions"
                emit-value
                map-options
              />
            </div>
          </q-step>

          <q-step
            :name="2"
            :title="$t('projects.create.contextStep')"
            icon="description"
          >
            <p class="text-body2 q-mb-md">{{ $t('projects.create.contextIntro') }}</p>
            <MarkdownEditor
              v-model="form.marketingContextMd"
              :height="320"
            />
          </q-step>
        </q-stepper>
      </q-card-section>

      <q-card-actions align="right" class="q-pa-md">
        <q-btn
          v-if="step > 1"
          flat
          :label="$t('common.back')"
          @click="step--"
        />
        <q-btn
          v-if="step < 2"
          color="primary"
          :label="$t('common.next')"
          :disable="!canProceedToContext"
          @click="step++"
        />
        <q-btn
          v-if="step === 2"
          color="primary"
          :label="$t('projects.create.createButton')"
          :loading="creating"
          @click="onCreate"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import MarkdownEditor from 'src/components/common/MarkdownEditor.vue';

export default defineComponent({
  name: 'ProjectCreateDialog',

  components: { MarkdownEditor },

  props: {
    modelValue: { type: Boolean, default: false },
  },

  emits: ['update:modelValue', 'created'],

  setup() {
    return {
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data: () => ({
    step: 1,
    creating: false,
    form: {
      name: '',
      slug: '',
      industry: 'saas',
      pipelineTemplate: 'educational',
      marketingContextMd: '',
    },
  }),

  computed: {
    industryOptions() {
      return ['saas', 'ecommerce', 'finance', 'health', 'education', 'media', 'other'].map((v) => ({
        label: this.$t(`industries.${v}`),
        value: v,
      }));
    },
    templateOptions() {
      return ['educational', 'commercial', 'editorial'].map((v) => ({
        label: this.$t(`pipelineTemplates.${v}`),
        value: v,
      }));
    },
    canProceedToContext(): boolean {
      return !!this.form.name &&
             !!this.form.slug &&
             /^[a-z0-9-]+$/.test(this.form.slug);
    },
  },

  watch: {
    'form.name'(newName: string): void {
      // Auto-suggest slug from name (only if user hasn't manually edited slug yet)
      if (!this.form.slug || this.form.slug === this.lastAutoSlug) {
        const suggested = newName
          .toLowerCase()
          .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
        this.form.slug = suggested;
        this.lastAutoSlug = suggested;
      }
    },
  },

  data() {
    return {
      step: 1,
      creating: false,
      lastAutoSlug: '',
      form: {
        name: '',
        slug: '',
        industry: 'saas',
        pipelineTemplate: 'educational',
        marketingContextMd: '',
      },
    };
  },

  methods: {
    reset(): void {
      this.step = 1;
      this.creating = false;
      this.lastAutoSlug = '';
      this.form = {
        name: '',
        slug: '',
        industry: 'saas',
        pipelineTemplate: 'educational',
        marketingContextMd: '',
      };
    },

    async onCreate(): Promise<void> {
      this.creating = true;
      try {
        const created = await this.projectsStore.create({
          slug: this.form.slug,
          name: this.form.name,
          industry: this.form.industry,
          pipelineTemplate: this.form.pipelineTemplate,
          marketingContextMd: this.form.marketingContextMd || undefined,
        });
        this.notify.success(this.$t('projects.create.success', { name: created.name }));
        this.$emit('created', created.slug);
        this.reset();
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.creating = false;
      }
    },
  },
});
</script>
```

### Frontend: MarkdownEditor (CodeMirror)

Install dependencies:

```bash
cd apps/web
bun add codemirror @codemirror/lang-markdown @codemirror/theme-one-dark vue-codemirror marked
```

`apps/web/src/components/common/MarkdownEditor.vue`:

```vue
<template>
  <div class="markdown-editor">
    <div class="markdown-editor__tabs">
      <button
        :class="['tab-btn', { 'tab-btn--active': mode === 'edit' }]"
        @click="mode = 'edit'"
        type="button"
      >
        <q-icon name="edit" size="14px" class="q-mr-xs" />
        {{ $t('markdownEditor.editTab') }}
      </button>
      <button
        :class="['tab-btn', { 'tab-btn--active': mode === 'preview' }]"
        @click="mode = 'preview'"
        type="button"
      >
        <q-icon name="visibility" size="14px" class="q-mr-xs" />
        {{ $t('markdownEditor.previewTab') }}
      </button>
      <button
        :class="['tab-btn', { 'tab-btn--active': mode === 'split' }]"
        @click="mode = 'split'"
        type="button"
      >
        <q-icon name="splitscreen" size="14px" class="q-mr-xs" />
        {{ $t('markdownEditor.splitTab') }}
      </button>
    </div>

    <div :class="['markdown-editor__body', `markdown-editor__body--${mode}`]" :style="{ height: `${height}px` }">
      <Codemirror
        v-if="mode === 'edit' || mode === 'split'"
        v-model="localValue"
        :extensions="extensions"
        :style="{ height: '100%' }"
        @ready="onCmReady"
        @change="onChange"
      />
      <div
        v-if="mode === 'preview' || mode === 'split'"
        class="markdown-editor__preview markdown-body"
        v-html="rendered"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, markRaw } from 'vue';
import { Codemirror } from 'vue-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { marked } from 'marked';

export default defineComponent({
  name: 'MarkdownEditor',

  components: { Codemirror },

  props: {
    modelValue: { type: String, default: '' },
    height: { type: Number, default: 320 },
  },

  emits: ['update:modelValue', 'blur'],

  data() {
    const baseTheme = EditorView.theme({
      '&': {
        fontSize: '14px',
      },
      '.cm-content': {
        fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      },
      '.cm-scroller': {
        lineHeight: '1.55',
      },
    });

    return {
      mode: 'edit' as 'edit' | 'preview' | 'split',
      localValue: this.modelValue,
      extensions: markRaw([
        markdown(),
        baseTheme,
        EditorView.lineWrapping,
        // Apply dark theme based on Quasar's dark mode
        // Note: this is read once at mount; live theme switching requires extension reconfiguration
        ...(document.body.classList.contains('body--dark') ? [oneDark] : []),
      ]),
    };
  },

  computed: {
    rendered(): string {
      // marked is sync by default for our use case
      return marked.parse(this.localValue, { async: false }) as string;
    },
  },

  watch: {
    modelValue(newVal: string): void {
      if (newVal !== this.localValue) {
        this.localValue = newVal;
      }
    },
  },

  methods: {
    onChange(value: string): void {
      this.localValue = value;
      this.$emit('update:modelValue', value);
    },

    onCmReady(payload: { view: EditorView }): void {
      payload.view.dom.addEventListener('blur', () => {
        this.$emit('blur');
      }, true);
    },
  },
});
</script>

<style lang="scss" scoped>
.markdown-editor {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.markdown-editor__tabs {
  display: flex;
  border-bottom: 1px solid var(--q-grey-3, #e0e0e0);
  background: var(--q-grey-1, #fafafa);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
  }
}

.tab-btn {
  background: none;
  border: none;
  padding: 10px 16px;
  font-size: 13px;
  cursor: pointer;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
  border-bottom: 2px solid transparent;
  transition: all 0.15s;

  &:hover {
    color: var(--q-primary);
  }

  &--active {
    color: var(--q-primary);
    border-bottom-color: var(--q-primary);
  }
}

.markdown-editor__body {
  display: grid;

  &--edit, &--preview {
    grid-template-columns: 1fr;
  }
  &--split {
    grid-template-columns: 1fr 1fr;
  }
}

.markdown-editor__preview {
  padding: 16px 24px;
  overflow-y: auto;
  border-left: 1px solid var(--q-grey-3, #e0e0e0);

  body.body--dark & {
    border-left-color: rgba(255, 255, 255, 0.06);
  }

  .markdown-editor__body--preview & {
    border-left: none;
  }
}

// Markdown body styling
.markdown-body {
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;

  :deep(h1) { font-size: 22px; font-weight: 600; margin: 16px 0 8px; }
  :deep(h2) { font-size: 18px; font-weight: 600; margin: 14px 0 8px; }
  :deep(h3) { font-size: 16px; font-weight: 600; margin: 12px 0 6px; }
  :deep(p) { margin: 0 0 12px; }
  :deep(ul), :deep(ol) { margin: 0 0 12px; padding-left: 24px; }
  :deep(code) {
    background: rgba(0, 0, 0, 0.06);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 13px;
    font-family: monospace;
  }
  :deep(pre) {
    background: rgba(0, 0, 0, 0.04);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
  }
  :deep(blockquote) {
    border-left: 3px solid var(--q-primary);
    padding-left: 12px;
    color: var(--q-text-secondary, rgba(0, 0, 0, 0.7));
    margin: 0 0 12px;
  }
}
</style>
```

### Frontend: ProjectDetailPage (Hub)

`apps/web/src/pages/ProjectDetailPage.vue`:

```vue
<template>
  <q-page padding>
    <div v-if="!project && projectsStore.loading" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="!project" class="text-center q-pa-xl">
      <q-icon name="error_outline" size="64px" color="negative" />
      <p class="text-body1 q-mt-md">{{ $t('projects.detail.notFound') }}</p>
      <q-btn :label="$t('projects.detail.backToList')" :to="{ name: 'projects' }" outline color="primary" />
    </div>

    <template v-else>
      <div class="row items-center q-mb-md">
        <q-btn flat round icon="arrow_back" :to="{ name: 'projects' }" class="q-mr-sm" />
        <div class="col">
          <h1 class="text-h5 q-my-none">{{ project.name }}</h1>
          <div class="text-caption text-grey-7" style="font-family: monospace;">/{{ project.slug }}</div>
        </div>
      </div>

      <q-tabs
        v-model="activeTab"
        align="left"
        class="text-grey-8 q-mb-lg"
        indicator-color="primary"
        active-color="primary"
        narrow-indicator
        @update:model-value="onTabChange"
      >
        <q-tab name="overview" :label="$t('projects.detail.tabs.overview')" icon="info" />
        <q-tab name="cold-start" :label="$t('projects.detail.tabs.coldStart')" icon="rocket_launch" />
        <q-tab name="articles" :label="$t('projects.detail.tabs.articles')" icon="article" />
        <q-tab name="clusters" :label="$t('projects.detail.tabs.clusters')" icon="hub" />
        <q-tab name="settings" :label="$t('projects.detail.tabs.settings')" icon="settings" />
      </q-tabs>

      <q-tab-panels v-model="activeTab" animated class="bg-transparent">
        <q-tab-panel name="overview" class="q-px-none">
          <ProjectOverviewPanel :project="project" @updated="onProjectUpdated" />
        </q-tab-panel>
        <q-tab-panel name="cold-start" class="q-px-none">
          <q-banner class="bg-info text-white">
            <template v-slot:avatar><q-icon name="construction" /></template>
            {{ $t('projects.detail.coldStartStub') }}
          </q-banner>
        </q-tab-panel>
        <q-tab-panel name="articles" class="q-px-none">
          <q-banner class="bg-info text-white">
            <template v-slot:avatar><q-icon name="construction" /></template>
            {{ $t('projects.detail.articlesStub') }}
          </q-banner>
        </q-tab-panel>
        <q-tab-panel name="clusters" class="q-px-none">
          <q-banner class="bg-info text-white">
            <template v-slot:avatar><q-icon name="construction" /></template>
            {{ $t('projects.detail.clustersStub') }}
          </q-banner>
        </q-tab-panel>
        <q-tab-panel name="settings" class="q-px-none">
          <ProjectSettingsPanel :project="project" @updated="onProjectUpdated" />
        </q-tab-panel>
      </q-tab-panels>
    </template>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import ProjectOverviewPanel from 'src/components/projects/ProjectOverviewPanel.vue';
import ProjectSettingsPanel from 'src/components/projects/ProjectSettingsPanel.vue';

type TabName = 'overview' | 'cold-start' | 'articles' | 'clusters' | 'settings';

export default defineComponent({
  name: 'ProjectDetailPage',

  components: {
    ProjectOverviewPanel,
    ProjectSettingsPanel,
  },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { projectsStore: useProjectsStore() };
  },

  data: () => ({
    activeTab: 'overview' as TabName,
  }),

  computed: {
    project() {
      return this.projectsStore.current;
    },
  },

  async created() {
    const tabFromQuery = this.$route.query.tab;
    if (typeof tabFromQuery === 'string' && ['overview', 'cold-start', 'articles', 'clusters', 'settings'].includes(tabFromQuery)) {
      this.activeTab = tabFromQuery as TabName;
    }
    await this.projectsStore.fetchOne(this.slug);
  },

  methods: {
    onTabChange(newTab: string | number | null): void {
      if (typeof newTab !== 'string') return;
      void this.$router.replace({ query: { ...this.$route.query, tab: newTab } });
    },

    async onProjectUpdated(): Promise<void> {
      await this.projectsStore.fetchOne(this.slug);
    },
  },
});
</script>
```

### Frontend: ProjectOverviewPanel

`apps/web/src/components/projects/ProjectOverviewPanel.vue`:

```vue
<template>
  <div>
    <div class="row q-col-gutter-md q-mb-lg">
      <div class="col-12 col-md-8">
        <div class="overview-card">
          <div class="overview-card__header">
            <div class="overview-card__title">{{ $t('projects.overview.contextTitle') }}</div>
            <div class="overview-card__actions">
              <span v-if="hasUnsavedChanges" class="unsaved-indicator">{{ $t('common.unsavedChanges') }}</span>
              <q-btn
                v-if="hasUnsavedChanges"
                color="primary"
                size="sm"
                :label="$t('common.save')"
                :loading="saving"
                @click="onSave"
              />
            </div>
          </div>
          <p class="text-caption text-grey-7 q-mb-md">{{ $t('projects.overview.contextHint') }}</p>
          <MarkdownEditor
            v-model="contextDraft"
            :height="500"
            @blur="onAutoSave"
          />
        </div>
      </div>

      <div class="col-12 col-md-4">
        <div class="overview-card">
          <div class="overview-card__title q-mb-md">{{ $t('projects.overview.statsTitle') }}</div>
          <div class="stat-list">
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.stats.clusters') }}</span>
              <span class="stat-row__value">{{ project.stats?.clusterCount ?? 0 }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.stats.totalArticles') }}</span>
              <span class="stat-row__value">{{ project.stats?.totalArticles ?? 0 }}</span>
            </div>
            <div class="stat-row" v-for="(count, status) in articleCounts" :key="status">
              <span class="stat-row__label">{{ $t(`articleStatus.${status}`, status) }}</span>
              <span class="stat-row__value">{{ count }}</span>
            </div>
          </div>
        </div>

        <div class="overview-card q-mt-md">
          <div class="overview-card__title q-mb-md">{{ $t('projects.overview.metaTitle') }}</div>
          <div class="stat-list">
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.industry') }}</span>
              <span class="stat-row__value">{{ $t(`industries.${project.industry}`) }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.pipelineTemplate') }}</span>
              <span class="stat-row__value">{{ $t(`pipelineTemplates.${project.pipelineTemplate}`) }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-row__label">{{ $t('projects.overview.created') }}</span>
              <span class="stat-row__value">{{ formatDate(project.createdAt) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import MarkdownEditor from 'src/components/common/MarkdownEditor.vue';
import type { Project } from 'src/stores/projects';

export default defineComponent({
  name: 'ProjectOverviewPanel',

  components: { MarkdownEditor },

  props: {
    project: { type: Object as PropType<Project>, required: true },
  },

  emits: ['updated'],

  setup() {
    return {
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data() {
    return {
      contextDraft: this.project.marketingContextMd ?? '',
      lastSaved: this.project.marketingContextMd ?? '',
      saving: false,
    };
  },

  computed: {
    hasUnsavedChanges(): boolean {
      return this.contextDraft !== this.lastSaved;
    },
    articleCounts(): Record<string, number> {
      return this.project.stats?.articleCounts ?? {};
    },
  },

  watch: {
    'project.marketingContextMd'(newVal: string | null): void {
      // Resync if project re-loaded externally
      if (newVal !== this.lastSaved) {
        this.contextDraft = newVal ?? '';
        this.lastSaved = newVal ?? '';
      }
    },
  },

  methods: {
    async onSave(): Promise<void> {
      if (!this.hasUnsavedChanges) return;
      this.saving = true;
      try {
        await this.projectsStore.update(this.project.slug, {
          marketingContextMd: this.contextDraft,
        });
        this.lastSaved = this.contextDraft;
        this.notify.success(this.$t('projects.overview.saveSuccess'));
        this.$emit('updated');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },

    async onAutoSave(): Promise<void> {
      // Auto-save on blur if there are unsaved changes
      if (this.hasUnsavedChanges) {
        await this.onSave();
      }
    },

    formatDate(iso: string): string {
      return new Date(iso).toLocaleDateString(this.$i18n.locale);
    },
  },
});
</script>

<style lang="scss" scoped>
.overview-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.overview-card__header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.overview-card__title {
  font-size: 16px;
  font-weight: 600;
  flex-grow: 1;
}

.overview-card__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.unsaved-indicator {
  font-size: 12px;
  color: var(--q-warning, #f2c037);
}

.stat-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.stat-row__label {
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
}

.stat-row__value {
  font-weight: 500;
}
</style>
```

### Frontend: ProjectSettingsPanel

`apps/web/src/components/projects/ProjectSettingsPanel.vue`:

```vue
<template>
  <div>
    <p class="text-body2 q-mb-lg">{{ $t('projects.settings.intro') }}</p>

    <!-- Astro Repo Section -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.astroRepo.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.astroRepo.description') }}</p>

      <div class="row q-col-gutter-md">
        <q-input
          v-model="astroRepo.owner"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.owner')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model="astroRepo.name"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.name')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model.number="astroRepo.installationId"
          outlined
          dense
          type="number"
          :label="$t('projects.settings.astroRepo.installationId')"
          class="col-12 col-md-6"
        >
          <template v-slot:hint>
            {{ $t('projects.settings.astroRepo.installationIdHint') }}
          </template>
        </q-input>
        <q-input
          v-model="astroRepo.defaultBranch"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.defaultBranch')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model="astroRepo.contentRoot"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.contentRoot')"
          class="col-12 col-md-6"
        />
        <q-input
          v-model="astroRepo.assetsRoot"
          outlined
          dense
          :label="$t('projects.settings.astroRepo.assetsRoot')"
          class="col-12 col-md-6"
        />
      </div>
    </div>

    <!-- Publish Domain Section -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.publishDomain.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.publishDomain.description') }}</p>
      <q-input
        v-model="publishDomain"
        outlined
        dense
        :label="$t('projects.settings.publishDomain.field')"
        placeholder="kiwissenraum.de"
      />
    </div>

    <!-- PageSpeed Thresholds Section -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.pagespeed.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.pagespeed.description') }}</p>

      <div class="row q-col-gutter-md">
        <div class="col-12 col-sm-6 col-md-3" v-for="metric in ['performance', 'accessibility', 'bestPractices', 'seo']" :key="metric">
          <q-input
            v-model.number="pagespeedThresholds[metric]"
            outlined
            dense
            type="number"
            :min="0"
            :max="100"
            :label="$t(`projects.settings.pagespeed.${metric}`)"
            suffix="/ 100"
          />
        </div>
      </div>
    </div>

    <!-- Link Rebuild Budget Section -->
    <div class="settings-section">
      <div class="settings-section__title">{{ $t('projects.settings.linkRebuild.title') }}</div>
      <p class="text-caption q-mb-md">{{ $t('projects.settings.linkRebuild.description') }}</p>
      <q-input
        v-model="linkRebuildBudgetMonthly"
        outlined
        dense
        type="text"
        :label="$t('projects.settings.linkRebuild.field')"
        suffix="EUR/Monat"
        :rules="[(v: string) => /^\d+(\.\d{1,2})?$/.test(v) || $t('projects.settings.linkRebuild.invalid')]"
      />
    </div>

    <div class="row q-mt-lg">
      <q-space />
      <q-btn
        color="primary"
        :label="$t('common.save')"
        :loading="saving"
        :disable="!hasChanges"
        @click="onSave"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import type { Project } from 'src/stores/projects';

const DEFAULT_ASTRO_REPO = {
  owner: '',
  name: '',
  installationId: 0,
  defaultBranch: 'main',
  contentRoot: 'src/content',
  assetsRoot: 'src/assets',
};

const DEFAULT_PAGESPEED = {
  performance: 85,
  accessibility: 90,
  bestPractices: 90,
  seo: 95,
};

export default defineComponent({
  name: 'ProjectSettingsPanel',

  props: {
    project: { type: Object as PropType<Project>, required: true },
  },

  emits: ['updated'],

  setup() {
    return {
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data() {
    return {
      saving: false,
      astroRepo: { ...DEFAULT_ASTRO_REPO, ...(this.project.astroRepo ?? {}) },
      publishDomain: this.project.publishDomain ?? '',
      pagespeedThresholds: { ...DEFAULT_PAGESPEED, ...(this.project.pagespeedThresholds ?? {}) },
      linkRebuildBudgetMonthly: this.project.linkRebuildBudgetMonthly ?? '30.00',
      _initialSnapshot: '',
    };
  },

  created() {
    this._initialSnapshot = this.snapshot();
  },

  computed: {
    hasChanges(): boolean {
      return this.snapshot() !== this._initialSnapshot;
    },
  },

  methods: {
    snapshot(): string {
      return JSON.stringify({
        astroRepo: this.astroRepo,
        publishDomain: this.publishDomain,
        pagespeedThresholds: this.pagespeedThresholds,
        linkRebuildBudgetMonthly: this.linkRebuildBudgetMonthly,
      });
    },

    async onSave(): Promise<void> {
      this.saving = true;
      try {
        // Only send astroRepo if owner+name+installationId all set
        const repoComplete = !!this.astroRepo.owner && !!this.astroRepo.name && this.astroRepo.installationId > 0;

        await this.projectsStore.update(this.project.slug, {
          astroRepo: repoComplete ? this.astroRepo : null,
          publishDomain: this.publishDomain || null,
          pagespeedThresholds: this.pagespeedThresholds,
          linkRebuildBudgetMonthly: this.linkRebuildBudgetMonthly,
        } as Partial<Project>);

        this._initialSnapshot = this.snapshot();
        this.notify.success(this.$t('projects.settings.saveSuccess'));
        this.$emit('updated');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.settings-section {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

  &:last-of-type {
    border-bottom: none;
  }

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
}

.settings-section__title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 4px;
}
</style>
```

### i18n: project keys

`apps/web/src/i18n/de/projects.ts`:

```typescript
export default {
  title: 'Projekte',
  empty: 'Noch keine Projekte. Erstelle dein erstes Projekt um loszulegen.',
  createButton: 'Neues Projekt',

  stats: {
    clusters: 'Cluster',
    articles: 'Artikel',
    totalArticles: 'Artikel insgesamt',
    published: 'Veröffentlicht',
  },

  create: {
    title: 'Neues Projekt erstellen',
    basicsStep: 'Grunddaten',
    contextStep: 'Marketing-Context',
    name: 'Name',
    slug: 'Slug',
    slugInvalid: 'Nur Kleinbuchstaben, Zahlen und Bindestriche',
    slugHint: 'URL-freundlicher Bezeichner — wird automatisch aus dem Namen vorgeschlagen',
    industry: 'Branche',
    pipelineTemplate: 'Pipeline-Template',
    contextIntro: 'Optional: Beschreibe Brand-Voice, Zielgruppe, Inhalts-Strategie. Du kannst dies auch nachträglich im Cold-Start automatisch generieren lassen.',
    createButton: 'Projekt erstellen',
    success: 'Projekt "{name}" erstellt',
  },

  detail: {
    notFound: 'Projekt nicht gefunden',
    backToList: 'Zurück zur Übersicht',
    coldStartStub: 'Cold-Start UI wird in Spec 35 implementiert.',
    articlesStub: 'Article Pipeline UI wird in Spec 36 implementiert.',
    clustersStub: 'Cluster Management UI wird in Spec 37 implementiert.',
    tabs: {
      overview: 'Übersicht',
      coldStart: 'Cold-Start',
      articles: 'Artikel',
      clusters: 'Cluster',
      settings: 'Einstellungen',
    },
  },

  overview: {
    contextTitle: 'Marketing-Context',
    contextHint: 'Beschreibung der Marke, Zielgruppe, und Content-Strategie. Wird in Cold-Start und Article-Generation als System-Prompt verwendet.',
    saveSuccess: 'Marketing-Context gespeichert',
    statsTitle: 'Statistiken',
    metaTitle: 'Metadaten',
    industry: 'Branche',
    pipelineTemplate: 'Template',
    created: 'Erstellt',
  },

  settings: {
    intro: 'Projekt-spezifische Einstellungen für Astro-Sync, PageSpeed-Validierung und Cost-Limits.',
    saveSuccess: 'Einstellungen gespeichert',
    astroRepo: {
      title: 'Astro Repository',
      description: 'GitHub-Repository in das Articles per Astro-Sync gepusht werden.',
      owner: 'Owner (Username/Org)',
      name: 'Repo Name',
      installationId: 'GitHub App Installation ID',
      installationIdHint: 'Numerische ID. Verfügbar via "bun --filter @marketing-auto/adapter-astro-sync list-installations".',
      defaultBranch: 'Default Branch',
      contentRoot: 'Content Root',
      assetsRoot: 'Assets Root',
    },
    publishDomain: {
      title: 'Publish Domain',
      description: 'Domain auf der die Astro-Site deployed ist (ohne Protokoll).',
      field: 'Domain',
    },
    pagespeed: {
      title: 'PageSpeed Schwellenwerte',
      description: 'Lighthouse-Scores die ein Article mindestens erreichen muss um als "published" zu gelten.',
      performance: 'Performance',
      accessibility: 'Accessibility',
      bestPractices: 'Best Practices',
      seo: 'SEO',
    },
    linkRebuild: {
      title: 'Internal-Linking-Budget',
      description: 'Maximales Budget pro Monat für Cluster-weite Internal-Linking-Rebuilds.',
      field: 'Budget',
      invalid: 'Ungültiger Betrag (z.B. 30 oder 30.00)',
    },
  },
};
```

`apps/web/src/i18n/de/markdownEditor.ts`:

```typescript
export default {
  editTab: 'Bearbeiten',
  previewTab: 'Vorschau',
  splitTab: 'Geteilt',
};
```

`apps/web/src/i18n/de/industries.ts`:

```typescript
export default {
  saas: 'SaaS',
  ecommerce: 'E-Commerce',
  finance: 'Finanzen',
  health: 'Gesundheit',
  education: 'Bildung',
  media: 'Medien',
  other: 'Sonstige',
};
```

`apps/web/src/i18n/de/pipelineTemplates.ts`:

```typescript
export default {
  educational: 'Educational',
  commercial: 'Commercial',
  editorial: 'Editorial',
};
```

`apps/web/src/i18n/de/articleStatus.ts` — covers all status enum values:

```typescript
export default {
  proposed: 'Vorgeschlagen',
  approved: 'Genehmigt',
  outlining: 'Outline läuft',
  outline_review: 'Outline-Review',
  drafting: 'Draft läuft',
  final_review: 'Final-Review',
  schema_extending: 'Schema-Erweiterung',
  ready_to_publish: 'Bereit zur Veröffentlichung',
  validating: 'PageSpeed-Validierung',
  blocked_by_pagespeed: 'PageSpeed-Block',
  published: 'Veröffentlicht',
  failed: 'Fehlgeschlagen',
  rejected: 'Abgelehnt',
};
```

Add common keys for "back", "next", "unsavedChanges", "required":

`apps/web/src/i18n/de/common.ts` — extend:

```typescript
export default {
  cancel: 'Abbrechen',
  save: 'Speichern',
  edit: 'Bearbeiten',
  delete: 'Löschen',
  confirm: 'Bestätigen',
  back: 'Zurück',
  next: 'Weiter',
  required: 'Pflichtfeld',
  unsavedChanges: 'Ungespeicherte Änderungen',
};
```

Wire all in `apps/web/src/i18n/de/index.ts`. Mirror in `en/`.

## Acceptance Criteria

### Backend
- [ ] `GET /api/projects` returns list with stats
- [ ] `GET /api/projects/:slug` returns single project with stats
- [ ] `POST /api/projects` creates project, validates slug uniqueness
- [ ] `PATCH /api/projects/:slug` updates project (partial)
- [ ] All require auth

### Project list (`/projects`)
- [ ] Shows all projects as cards
- [ ] Each card displays: name, slug, industry, template, cluster count, total articles, published count
- [ ] Click on card navigates to `/projects/:slug`
- [ ] "Neues Projekt" button opens create dialog
- [ ] Empty state shown when no projects exist

### Create Dialog
- [ ] 2-step stepper: basics + context
- [ ] Slug auto-suggested from name with German umlaut handling
- [ ] Slug validation: only `[a-z0-9-]+`, uniqueness checked server-side
- [ ] Cancel discards form
- [ ] Create succeeds → dialog closes, redirects to new project's hub

### Project Detail Hub (`/projects/:slug`)
- [ ] Shows 5 tabs: Overview, Cold-Start, Articles, Clusters, Settings
- [ ] URL reflects active tab via `?tab=`
- [ ] Direct links work (`/projects/foo?tab=settings`)
- [ ] Back button returns to project list
- [ ] 404 state shown for unknown slug

### Overview Tab
- [ ] Shows MarkdownEditor with project's marketing_context.md
- [ ] Edit/Preview/Split tabs work
- [ ] Auto-save on blur
- [ ] Manual save button (visible when changes pending)
- [ ] "Unsaved changes" indicator shows correctly
- [ ] Stats panel shows cluster count + article counts by status

### Settings Tab
- [ ] Astro repo fields (owner, name, installation ID, branch, content root, assets root) editable
- [ ] Publish domain editable
- [ ] PageSpeed thresholds editable (4 number fields, range 0-100)
- [ ] Link rebuild budget editable (decimal validation)
- [ ] Save button only enabled when changes pending
- [ ] Save persists and re-fetches project

### MarkdownEditor
- [ ] CodeMirror v6 renders Markdown with syntax highlighting
- [ ] Edit/Preview/Split tabs switch correctly
- [ ] Preview renders Markdown (h1, h2, p, ul, code, blockquote, etc.)
- [ ] Dark mode applies oneDark theme
- [ ] v-model binding works (parent updates when content changes)
- [ ] @blur emits when CodeMirror loses focus

## Testing Strategy

Manual smoke tests:

1. **Empty state**: Drop all projects from DB. Visit `/projects`. See empty state.
2. **Create flow**: Click create → fill basics → next → fill context → create. Verify redirect to hub.
3. **Hub navigation**: Click each tab, verify URL updates and panel changes.
4. **Markdown editing**: Edit context, see preview update. Blur → auto-save. Verify content persists on refresh.
5. **Settings save**: Edit astro repo + thresholds. Save. Refresh. Verify persisted.
6. **404 handling**: Visit `/projects/nonexistent`. Verify 404 state.
7. **Slug validation**: Try creating with slug `Foo Bar` — verify error. Try `existing-slug` (use existing one) — verify 409.

## Open Questions / Decisions Made

**Decision 1: CodeMirror v6, not v5 or Monaco.**
Modern, modular, ~70KB gzipped. Vue integration via `vue-codemirror` is officially maintained.

**Decision 2: Dark theme applied on mount, not reactively.**
CodeMirror's theme system requires extension reconfiguration for runtime theme changes. We accept that toggling app theme requires a page refresh for the editor's theme to update. Acceptable trade-off for an editor that's rarely used while toggling themes.

**Decision 3: Project deletion is out of scope.**
Cascading deletes are dangerous. Manual via Drizzle Studio for now.

**Decision 4: Auto-save on blur, not on every keystroke.**
Balance: catches forget-to-save, doesn't spam network.

**Decision 5: Stats are computed on every list/get request.**
GROUP BY queries are fast on small data. If we ever have 10,000+ articles per project, we'd cache stats in a materialized view or denormalize counts. Not now.

**Decision 6: Industry/template values are hardcoded enums on backend + frontend.**
Adding new ones is a coordinated DB migration + frontend i18n update. Acceptable since these change rarely.

**Decision 7: Auto-suggest slug from name uses German umlaut conversion.**
Same algorithm as Spec 20 (umlaut→ae before NFD normalize). Marcel can override.

**Decision 8: `Project.astroRepo` as null when incomplete.**
If owner/name/installationId aren't all set, the field stays null. Spec 21 (astro-sync) refuses to run on null astroRepo.

## Implementation Order

**Recommend 3 sessions.**

**Session 1: Backend + List + Create (~5h)**
1. Add or verify `GET /projects` with stats, `GET /projects/:slug`, `POST /projects`, `PATCH /projects/:slug`
2. Create `apps/web/src/stores/projects.ts`
3. Replace `ProjectsPage.vue` stub
4. Create `ProjectListCard.vue`
5. Install CodeMirror dependencies
6. Create `MarkdownEditor.vue` component (used in dialog AND overview)
7. Create `ProjectCreateDialog.vue`
8. Add basic i18n keys (projects.title, projects.create.*, industries, pipelineTemplates)
9. Manual test: create project, see it in list
10. Commit: `feat(web): project list + create dialog (spec 34)`

**Session 2: Detail Hub + Overview (~4-5h)**
1. Replace `ProjectDetailPage.vue` stub with hub layout
2. Create `ProjectOverviewPanel.vue` with MarkdownEditor + stats
3. Add stub banners for Cold-Start, Articles, Clusters tabs
4. Add i18n keys (projects.detail.*, projects.overview.*, articleStatus.*, markdownEditor.*)
5. Manual test: navigate to hub, edit context, verify auto-save
6. Commit: `feat(web): project hub + overview panel (spec 34)`

**Session 3: Settings Tab (~3h)**
1. Create `ProjectSettingsPanel.vue`
2. Add i18n keys (projects.settings.*)
3. Manual test: edit settings, save, verify persistence
4. Commit: `feat(web): project settings panel (spec 34)`

Total: 12-14 hours.

## Splitting Plan

See "Implementation Order" — 3 sessions with `/clear` between.

## Discovered During Implementation

- **`marked` v18 API**: `marked.parse()` is synchronous by default and returns `string` — no `{ async: false }` option or `as string` cast needed. Noted in `apps/web/CLAUDE.md`.
- **Industry/pipeline enums differ from spec**: The spec used generic SaaS-style values (`saas`, `ecommerce`, `educational`, `commercial`). The actual DB enums in `packages/db/src/schema/_enums.ts` are domain-specific (`ai_education`, `automotive_dealer`, `renewable_affiliate`, `music_school`, `other` for industry; `educational`, `affiliate_review`, `local_business`, `programmatic_seo` for pipeline). Always derive enum options from the DB schema, not the spec.
- **`publishDomain` does not exist as a column**: The spec refers to `publishDomain` throughout, but the DB column is `domain` (plain). The update schema and frontend store use `domain`.
- **Article status `outlining` does not exist**: The spec's `articleStatus` i18n included `outlining` but the DB enum has `generating` instead. Used the DB value.

## Deviations

- **Industry enum values** (`ai_education` / `automotive_dealer` / `renewable_affiliate` / `music_school` / `other` instead of spec's `saas` / `ecommerce` / `finance` / `health` / `education` / `media` / `other`): spec values were illustrative placeholders; actual DB enum was already defined in Spec 01.
- **Pipeline template values** (`affiliate_review` / `local_business` / `programmatic_seo` instead of spec's `commercial` / `editorial`): same reason — DB enum from Spec 01 is authoritative.
- **`publishDomain` → `domain`**: spec used `publishDomain` but the DB column is `domain`; backend schema, update endpoint, and frontend store all use `domain`.
- **Article status `generating` not `outlining`**: DB enum value is `generating`; spec's i18n example used `outlining` which doesn't exist.
