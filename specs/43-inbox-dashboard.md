# Spec 43: Inbox Dashboard

**Phase:** 4 (Welle 4 Followup — small UI-only spec)
**Estimated Effort:** 3-4 hours (1 session)
**Dependencies:** Spec 36 (articles), Spec 39 (active pipeline runs), Spec 40 (notifications)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (UI-composition only, no new backend)

---

## Goal

Replace the **Inbox stub page** with a usable hybrid dashboard. The Inbox is the first page Marcel sees after login (current default route). It should answer one question on a single screen:

> "What needs my attention right now?"

Three sections, top to bottom, in priority order:

1. **Aktuelle Aufgaben** (primary block): Articles in `proposed`, `outline_review`, or `final_review` status — these are the items waiting for Marcel's decision/review
2. **Was läuft gerade**: In-flight pipeline runs (queued + running) — same data as Activity Feed but heavily filtered (only currently-active, no terminated)
3. **Neu seit gestern**: Unread notifications from the last 24 hours

Each section is read-mostly with click-to-navigate. The Inbox is **not** a place for actions — it's a launchpad to the right detail pages.

After this spec:
- The "Diese Seite wird in Spec 39 + 40 inhaltlich gefüllt" stub disappears
- Marcel opens the app, sees what needs review, what's running, what's new — done in 5 seconds
- The existing setup-incomplete banner stays where it is (above the dashboard sections)

## Architecture Decisions

**Decision 1: No new backend endpoints.**
Reuse existing endpoints:
- `GET /api/articles?projectSlug=...` (Spec 36) — filter client-side for review-statuses across all projects
- `GET /api/pipeline-runs/active` (Spec 39) — already returns in-flight runs across all projects, filter client-side to status `running` + `queued`
- `GET /api/notifications?since=...&unreadOnly=true&limit=10` (Spec 40) — last 24h unread

This makes the dashboard zero-cost on the backend side.

**Decision 2: Cross-project view.**
The Inbox shows items from ALL projects, not just one. Project filter not in v1 — Marcel has 1-2 active projects at most. If he has 5+ projects later, add a filter dropdown.

**Decision 3: Three-section vertical stack.**
Not three columns, not tabs — vertical stack:

```
┌─ Setup-Banner (if incomplete) ─────────────┐
├─ Aktuelle Aufgaben ────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐                │
│  │Card 1│ │Card 2│ │Card 3│                │
│  └──────┘ └──────┘ └──────┘                │
├─ Was läuft gerade ─────────────────────────┤
│  • Pipeline X — running (5m elapsed)       │
│  • Pipeline Y — queued                     │
├─ Neu seit gestern ─────────────────────────┤
│  ▪ 14:23  Cost-Limit erreicht (KI-Wiss…)   │
│  ▪ 13:01  Outline fertig (article xyz)     │
└────────────────────────────────────────────┘
```

Section 1 is the most important and gets visual weight (cards). Sections 2+3 are compact lists.

**Decision 4: Articles-needing-review uses card grid.**
Each card shows: project name (small), title or cornerstone keyword (large), status pill, "Review →" button. Cards are 280px wide on desktop, full width on mobile. Click anywhere on card → article-detail-page.

**Decision 5: In-flight runs use compact list.**
One row per run with: pipeline-name pill, target (article title or project name), elapsed time, status spinner. Click → activity-feed page (since detail pages for runs don't exist).

**Decision 6: Notifications section reuses NotificationBell list-item-component.**
Don't reinvent. Extract `<NotificationItem>` from the bell-dropdown into its own reusable component. Inbox renders the same item, just unbounded by dropdown width.

**Decision 7: Empty states are informative, not decorative.**

When there's nothing in a section:
- Aktuelle Aufgaben empty: "Alle Artikel sind im Fluss — nichts wartet auf dich." (positive tone)
- Was läuft gerade empty: "Keine laufenden Pipelines."
- Neu seit gestern empty: "Keine neuen Benachrichtigungen seit gestern."

If ALL THREE sections are empty: render a single "Alles ruhig — nichts zu tun." message instead of three empty boxes.

**Decision 8: Loading states avoid layout shift.**
Each section has a fixed minimum height during loading (skeleton blocks). When data arrives, content slots in without scroll-jump.

**Decision 9: "Aktuelle Aufgaben" cards aggregate by status.**
Within Aktuelle Aufgaben, sub-group by status: "Outline-Review" first (most actionable), then "Final-Review" (almost-done), then "Proposed" (not yet started). Visual: section headers within the cards block.

**Decision 10: Section count badges show total/visible.**
Each section header: `Aktuelle Aufgaben (3)` — the number is the total count. If we ever cap visible items (e.g., 6 cards max in Aktuelle Aufgaben to avoid scroll-bombing), it becomes `Aktuelle Aufgaben (12, zeigt 6)`. For v1, no caps — show all.

**Decision 11: Refresh-on-mount, no live updates.**
The Inbox fetches once on mount. No polling, no SSE on this page (the data is already polling via Activity-Feed composable elsewhere; Inbox just snapshots). Add a "Aktualisieren" button in the header for manual refresh.

This is intentional: the Inbox is "pause and decide" — not a dashboard you keep open. If Marcel needs live, he goes to Activity-Feed.

**Decision 12: Inbox is the default route after login.**
Should already be the case (the existing stub indicates this). Verify in router config.

## Non-Goals

- **No actions/buttons in cards** — only navigation. "Approve outline directly from inbox" is tempting but slippery slope to a duplicate of the article-detail page.
- **No filters** (project, status, date) — overkill for 5-20 items.
- **No live updates** (SSE/polling) — Decision 11.
- **No notifications mark-as-read from Inbox** — mark-as-read happens on the bell or in the detail page when clicked. Inbox is read-only.
- **No "snooze" or "dismiss" mechanics for tasks** — articles in `proposed` status stay there until something happens to them.
- **No charts / metrics** (e.g., "this week's published count") — different page concept (analytics), out of scope.
- **No search** — for 5-20 items, just scroll.
- **No grouping by project** in Aktuelle Aufgaben — just by status. Project shown as small text on each card.

## Detailed Implementation

### Backend — Tiny extension only

The existing `GET /api/articles?projectSlug=foo` returns articles for one project. The Inbox needs articles across ALL projects. Two options:

**Option A**: New endpoint `GET /api/articles/across-projects?statuses=proposed,outline_review,final_review`
**Option B**: Frontend calls `GET /api/articles?projectSlug=X` once per project (after fetching project list)

Going with **Option A** — cleaner, single round-trip:

`apps/api/src/routes/articles.ts`:

```typescript
// New endpoint, mounted at /api/articles
articleRoutes.get('/across-projects', async (c) => {
  const statusesParam = c.req.query('statuses');
  if (!statusesParam) return c.json({ ok: false, error: 'statuses required' }, 400);

  const requested = statusesParam.split(',').map((s) => s.trim());
  const validStatuses = [
    'proposed', 'approved', 'generating', 'outline_review', 'drafting',
    'final_review', 'schema_extending', 'ready_to_publish', 'validating',
    'published', 'blocked_by_pagespeed', 'failed', 'rejected',
  ];
  const statuses = requested.filter((s) => validStatuses.includes(s));
  if (statuses.length === 0) {
    return c.json({ ok: false, error: 'no valid statuses' }, 400);
  }

  const rows = await db.select({
    id: articles.id,
    slug: articles.slug,
    title: articles.title,
    cornerstoneKeyword: articles.cornerstoneKeyword,
    status: articles.status,
    cornerstoneSpecId: articles.cornerstoneSpecId,
    projectId: articles.projectId,
    projectName: projects.name,
    projectSlug: projects.slug,
    clusterId: articles.clusterId,
    clusterName: clusters.name,
    pillarName: contentPillars.name,
    updatedAt: articles.updatedAt,
  })
    .from(articles)
    .leftJoin(projects, eq(articles.projectId, projects.id))
    .leftJoin(clusters, eq(articles.clusterId, clusters.id))
    .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
    .where(inArray(articles.status, statuses as ['proposed', ...string[]]))
    .orderBy(desc(articles.updatedAt))
    .limit(50);

  return c.json({ ok: true, data: rows });
});
```

That's the only backend change. Imports may need adjusting (`inArray` from drizzle-orm, `clusters`, `contentPillars` from `@marketing-auto/db`).

### Frontend: InboxPage

`apps/web/src/pages/InboxPage.vue`:

```vue
<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-lg">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('inbox.title') }}</h1>
        <p class="text-caption text-grey-7 q-mt-xs">
          {{ $t('inbox.signedInAs', { email: userEmail }) }}
        </p>
      </div>
      <div class="col-auto">
        <q-btn flat icon="refresh" :loading="loading" @click="refresh" />
      </div>
    </div>

    <!-- Setup-incomplete banner (existing) -->
    <SetupIncompleteBanner v-if="setupIncomplete" />

    <!-- All-empty state -->
    <div v-if="!loading && allEmpty" class="all-empty-state">
      <q-icon name="check_circle" size="64px" color="positive" />
      <p class="text-h6 q-mt-md">{{ $t('inbox.allQuiet.title') }}</p>
      <p class="text-body2 text-grey-7">{{ $t('inbox.allQuiet.subtitle') }}</p>
    </div>

    <template v-else>
      <!-- Section 1: Aktuelle Aufgaben -->
      <InboxSection
        :title="$t('inbox.tasks.title')"
        :count="tasks.length"
        :loading="loading"
        :empty-message="$t('inbox.tasks.empty')"
        :is-empty="!loading && tasks.length === 0"
      >
        <div class="task-grid">
          <InboxTaskGroup
            v-for="group in groupedTasks"
            :key="group.status"
            :status="group.status"
            :articles="group.articles"
          />
        </div>
      </InboxSection>

      <!-- Section 2: Was läuft gerade -->
      <InboxSection
        :title="$t('inbox.running.title')"
        :count="runningRuns.length"
        :loading="loading"
        :empty-message="$t('inbox.running.empty')"
        :is-empty="!loading && runningRuns.length === 0"
        class="q-mt-lg"
      >
        <q-list separator class="bordered-list">
          <InboxRunRow v-for="run in runningRuns" :key="run.id" :entry="run" />
        </q-list>
      </InboxSection>

      <!-- Section 3: Neu seit gestern -->
      <InboxSection
        :title="$t('inbox.recentNotifications.title')"
        :count="recentNotifications.length"
        :loading="loading"
        :empty-message="$t('inbox.recentNotifications.empty')"
        :is-empty="!loading && recentNotifications.length === 0"
        class="q-mt-lg"
      >
        <q-list separator class="bordered-list">
          <NotificationItem
            v-for="n in recentNotifications"
            :key="n.id"
            :notification="n"
            @click="onNotificationClick(n)"
          />
        </q-list>
      </InboxSection>
    </template>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useSessionStore } from 'src/stores/session';
import { useNotificationsStore, type NotificationRow } from 'src/stores/notifications';
import { api } from 'src/lib/api-client';
import SetupIncompleteBanner from 'src/components/common/SetupIncompleteBanner.vue';
import InboxSection from 'src/components/inbox/InboxSection.vue';
import InboxTaskGroup from 'src/components/inbox/InboxTaskGroup.vue';
import InboxRunRow from 'src/components/inbox/InboxRunRow.vue';
import NotificationItem from 'src/components/notifications/NotificationItem.vue';

interface InboxArticle {
  id: string;
  slug: string;
  title: string | null;
  cornerstoneKeyword: string;
  status: 'proposed' | 'outline_review' | 'final_review';
  cornerstoneSpecId: string | null;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  clusterId: string | null;
  clusterName: string | null;
  pillarName: string | null;
  updatedAt: string;
}

interface InboxRunEntry {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  title: string;
  subtitle: string | null;
  articleId: string | null;
  startedAt: string | null;
  createdAt: string;
}

const TASK_STATUSES = ['proposed', 'outline_review', 'final_review'] as const;

export default defineComponent({
  name: 'InboxPage',

  components: {
    SetupIncompleteBanner,
    InboxSection,
    InboxTaskGroup,
    InboxRunRow,
    NotificationItem,
  },

  setup() {
    return {
      session: useSessionStore(),
      notificationsStore: useNotificationsStore(),
    };
  },

  data: () => ({
    tasks: [] as InboxArticle[],
    activeRuns: [] as InboxRunEntry[],
    recentNotifications: [] as NotificationRow[],
    loading: false,
    setupIncomplete: false, // wired via existing setup-state composable
  }),

  computed: {
    userEmail(): string {
      return this.session.user?.email ?? '';
    },
    runningRuns(): InboxRunEntry[] {
      return this.activeRuns.filter((r) => r.status === 'queued' || r.status === 'running');
    },
    allEmpty(): boolean {
      return this.tasks.length === 0
        && this.runningRuns.length === 0
        && this.recentNotifications.length === 0;
    },
    groupedTasks() {
      const groups: Array<{ status: typeof TASK_STATUSES[number]; articles: InboxArticle[] }> = [];
      // Order: outline_review (most actionable), final_review, proposed
      for (const status of ['outline_review', 'final_review', 'proposed'] as const) {
        const articles = this.tasks.filter((a) => a.status === status);
        if (articles.length > 0) groups.push({ status, articles });
      }
      return groups;
    },
  },

  async created() {
    await this.refresh();
  },

  methods: {
    async refresh(): Promise<void> {
      this.loading = true;
      try {
        await Promise.all([
          this.fetchTasks(),
          this.fetchActiveRuns(),
          this.fetchRecentNotifications(),
        ]);
      } finally {
        this.loading = false;
      }
    },

    async fetchTasks(): Promise<void> {
      const statuses = TASK_STATUSES.join(',');
      const res = await api.get<{ ok: boolean; data: InboxArticle[] }>(
        `/articles/across-projects?statuses=${statuses}`,
      );
      this.tasks = res.data.data;
    },

    async fetchActiveRuns(): Promise<void> {
      // Last 1 hour — for in-flight only, recent terminated don't matter for inbox
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const res = await api.get<{ ok: boolean; data: { entries: InboxRunEntry[] } }>(
        `/pipeline-runs/active?since=${encodeURIComponent(since)}`,
      );
      this.activeRuns = res.data.data.entries;
    },

    async fetchRecentNotifications(): Promise<void> {
      // Last 24h, unread only, max 10
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await api.get<{ ok: boolean; data: { notifications: NotificationRow[] } }>(
        `/notifications?since=${encodeURIComponent(since)}&unreadOnly=true&limit=10`,
      );
      this.recentNotifications = res.data.data.notifications;
    },

    async onNotificationClick(n: NotificationRow): Promise<void> {
      if (!n.readAt) {
        await this.notificationsStore.markAsRead([n.id]);
      }
      if (n.link) {
        void this.$router.push(n.link);
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.task-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;

  @media (min-width: 768px) {
    grid-template-columns: 1fr;
  }
}

.bordered-list {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.all-empty-state {
  text-align: center;
  padding: 100px 0;
}
</style>
```

### Frontend: InboxSection (wrapper)

`apps/web/src/components/inbox/InboxSection.vue`:

```vue
<template>
  <section class="inbox-section">
    <div class="inbox-section__header">
      <h2 class="inbox-section__title">
        {{ title }}
        <span v-if="!loading && count > 0" class="inbox-section__count">({{ count }})</span>
      </h2>
    </div>

    <div v-if="loading" class="inbox-section__loading">
      <q-skeleton type="rect" height="80px" class="q-mb-sm" />
      <q-skeleton type="rect" height="80px" />
    </div>

    <div v-else-if="isEmpty" class="inbox-section__empty">
      {{ emptyMessage }}
    </div>

    <slot v-else />
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'InboxSection',

  props: {
    title: { type: String, required: true },
    count: { type: Number, default: 0 },
    loading: { type: Boolean, default: false },
    isEmpty: { type: Boolean, default: false },
    emptyMessage: { type: String, default: '' },
  },
});
</script>

<style lang="scss" scoped>
.inbox-section__header {
  margin-bottom: 16px;
}

.inbox-section__title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.7));
}

.inbox-section__count {
  font-weight: 400;
  margin-left: 8px;
  font-size: 14px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
}

.inbox-section__loading {
  min-height: 180px;
}

.inbox-section__empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
  font-style: italic;
  border: 1px dashed var(--q-grey-3, #e0e0e0);
  border-radius: 8px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}
</style>
```

### Frontend: InboxTaskGroup

`apps/web/src/components/inbox/InboxTaskGroup.vue`:

```vue
<template>
  <div class="task-group">
    <div class="task-group__header">
      <q-icon :name="icon" size="16px" :color="color" class="q-mr-sm" />
      <span class="task-group__label">{{ $t(`inbox.tasks.statusLabel.${status}`) }}</span>
      <span class="task-group__count">{{ articles.length }}</span>
    </div>

    <div class="task-group__cards">
      <InboxTaskCard
        v-for="article in articles"
        :key="article.id"
        :article="article"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import InboxTaskCard from './InboxTaskCard.vue';

interface InboxArticle {
  id: string;
  // ... see InboxPage type
  [key: string]: unknown;
}

const STATUS_ICONS: Record<string, string> = {
  proposed: 'pending',
  outline_review: 'list_alt',
  final_review: 'rate_review',
};

const STATUS_COLORS: Record<string, string> = {
  proposed: 'grey-6',
  outline_review: 'primary',
  final_review: 'warning',
};

export default defineComponent({
  name: 'InboxTaskGroup',

  components: { InboxTaskCard },

  props: {
    status: { type: String, required: true },
    articles: { type: Array as PropType<InboxArticle[]>, required: true },
  },

  computed: {
    icon(): string {
      return STATUS_ICONS[this.status] ?? 'help';
    },
    color(): string {
      return STATUS_COLORS[this.status] ?? 'grey';
    },
  },
});
</script>

<style lang="scss" scoped>
.task-group {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }
}

.task-group__header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.task-group__label {
  font-size: 13px;
  font-weight: 600;
  flex-grow: 1;
}

.task-group__count {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  background: var(--q-grey-2, #f0f0f0);
  padding: 1px 8px;
  border-radius: 999px;

  body.body--dark & {
    background: rgba(255, 255, 255, 0.06);
  }
}

.task-group__cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;

  @media (min-width: 640px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
```

### Frontend: InboxTaskCard

`apps/web/src/components/inbox/InboxTaskCard.vue`:

```vue
<template>
  <div class="task-card" @click="onClick">
    <div v-if="isCornerstone" class="task-card__cornerstone-bar" />

    <div class="task-card__main">
      <div v-if="article.projectName" class="task-card__project">
        <q-icon name="folder" size="11px" class="q-mr-xs" />
        {{ article.projectName }}
        <template v-if="article.pillarName">
          <span class="task-card__separator">›</span>
          {{ article.pillarName }}
        </template>
      </div>

      <div class="task-card__title">
        {{ article.title || article.cornerstoneKeyword }}
      </div>

      <div v-if="article.title" class="task-card__keyword">
        <code>{{ article.cornerstoneKeyword }}</code>
      </div>

      <div class="task-card__footer">
        <span v-if="isCornerstone" class="task-card__badge">{{ $t('articles.card.cornerstone') }}</span>
        <q-space />
        <span class="task-card__action">
          {{ $t('inbox.tasks.review') }}
          <q-icon name="chevron_right" size="14px" />
        </span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';

interface InboxArticle {
  id: string;
  title: string | null;
  cornerstoneKeyword: string;
  cornerstoneSpecId: string | null;
  projectName: string | null;
  pillarName: string | null;
  status: string;
}

export default defineComponent({
  name: 'InboxTaskCard',

  props: {
    article: { type: Object as PropType<InboxArticle>, required: true },
  },

  computed: {
    isCornerstone(): boolean {
      return this.article.cornerstoneSpecId !== null;
    },
  },

  methods: {
    onClick(): void {
      void this.$router.push({ name: 'article-detail', params: { id: this.article.id } });
    },
  },
});
</script>

<style lang="scss" scoped>
.task-card {
  display: flex;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);
  cursor: pointer;
  transition: all 0.15s;
  overflow: hidden;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }

  &:hover {
    border-color: var(--q-primary);
    transform: translateY(-1px);
  }
}

.task-card__cornerstone-bar {
  width: 3px;
  background: var(--q-primary);
  flex-shrink: 0;
}

.task-card__main {
  padding: 12px 14px;
  flex-grow: 1;
  min-width: 0;
}

.task-card__project {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-card__separator {
  margin: 0 4px;
}

.task-card__title {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-card__keyword {
  margin-bottom: 8px;

  code {
    font-size: 11px;
    background: rgba(0, 0, 0, 0.05);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: monospace;

    body.body--dark & {
      background: rgba(255, 255, 255, 0.06);
    }
  }
}

.task-card__footer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.task-card__badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(63, 81, 181, 0.1);
  color: var(--q-primary);
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 600;
}

.task-card__action {
  color: var(--q-primary);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}
</style>
```

### Frontend: InboxRunRow

`apps/web/src/components/inbox/InboxRunRow.vue`:

```vue
<template>
  <q-item clickable @click="onClick">
    <q-item-section avatar>
      <q-spinner v-if="entry.status === 'running'" size="20px" color="primary" />
      <q-icon v-else name="schedule" size="20px" color="grey-6" />
    </q-item-section>

    <q-item-section>
      <q-item-label>
        <span :class="`type-pill type-pill--${entry.type}`">{{ $t(`activity.types.${entry.type}`) }}</span>
        {{ entry.title }}
      </q-item-label>
      <q-item-label caption>
        <span v-if="entry.projectName">{{ entry.projectName }}</span>
        <span v-if="entry.subtitle"> · {{ entry.subtitle }}</span>
        <span v-if="elapsed"> · {{ elapsed }}</span>
      </q-item-label>
    </q-item-section>

    <q-item-section side>
      <q-icon name="chevron_right" size="20px" color="grey-6" />
    </q-item-section>
  </q-item>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';

interface InboxRunEntry {
  id: string;
  type: string;
  status: string;
  projectName: string | null;
  projectSlug: string | null;
  title: string;
  subtitle: string | null;
  articleId: string | null;
  startedAt: string | null;
}

export default defineComponent({
  name: 'InboxRunRow',

  props: {
    entry: { type: Object as PropType<InboxRunEntry>, required: true },
  },

  computed: {
    elapsed(): string | null {
      if (!this.entry.startedAt) return null;
      const ms = Date.now() - new Date(this.entry.startedAt).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return `${s}s`;
      if (s < 3600) return `${Math.round(s / 60)}m`;
      return `${(s / 3600).toFixed(1)}h`;
    },
  },

  methods: {
    onClick(): void {
      // Navigate to article-detail if linked, else activity feed
      if (this.entry.articleId) {
        void this.$router.push({ name: 'article-detail', params: { id: this.entry.articleId } });
      } else {
        void this.$router.push({ name: 'activity' });
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.type-pill {
  display: inline-block;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 8px;
  background: var(--q-grey-2);
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));

  body.body--dark & {
    background: rgba(255, 255, 255, 0.06);
  }

  &--cold_start { background: rgba(63, 81, 181, 0.12); color: #3f51b5; }
  &--article_outline, &--article_draft { background: rgba(124, 77, 255, 0.12); color: #7c4dff; }
  &--astro_sync { background: rgba(38, 166, 154, 0.12); color: #26a69a; }
  &--pagespeed { background: rgba(242, 192, 55, 0.18); color: #b07b00; }
  &--schema_extension { background: rgba(0, 188, 212, 0.12); color: #00838f; }
  &--link_rebuild { background: rgba(96, 125, 139, 0.12); color: #455a64; }
}
</style>
```

### Frontend: Extract NotificationItem from NotificationBell

The NotificationBell currently has `<q-item>` blocks rendering notifications inline. Extract them to a reusable component.

`apps/web/src/components/notifications/NotificationItem.vue`:

```vue
<template>
  <q-item
    clickable
    :class="['notification-item', { 'notification-item--unread': !notification.readAt }]"
    @click="$emit('click', notification)"
  >
    <q-item-section avatar>
      <q-icon :name="iconName" :color="iconColor" size="20px" />
    </q-item-section>
    <q-item-section>
      <q-item-label>{{ notification.title }}</q-item-label>
      <q-item-label caption lines="2">{{ notification.message }}</q-item-label>
      <q-item-label caption class="notification-item__time">
        {{ relativeTime }}
      </q-item-label>
    </q-item-section>
    <q-item-section v-if="!notification.readAt" side>
      <div class="unread-dot" />
    </q-item-section>
  </q-item>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { NotificationRow } from 'src/stores/notifications';

const SEVERITY_ICONS: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
};
const SEVERITY_COLORS: Record<string, string> = {
  info: 'primary',
  warning: 'warning',
  critical: 'negative',
};

export default defineComponent({
  name: 'NotificationItem',

  props: {
    notification: { type: Object as PropType<NotificationRow>, required: true },
  },

  emits: ['click'],

  computed: {
    iconName(): string {
      return SEVERITY_ICONS[this.notification.severity] ?? 'notifications';
    },
    iconColor(): string {
      return SEVERITY_COLORS[this.notification.severity] ?? 'grey';
    },
    relativeTime(): string {
      const ms = Date.now() - new Date(this.notification.createdAt).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return this.$t('notifications.relative.justNow') as string;
      const m = Math.round(s / 60);
      if (m < 60) return this.$t('notifications.relative.minutesAgo', { n: m }) as string;
      const h = Math.round(m / 60);
      if (h < 24) return this.$t('notifications.relative.hoursAgo', { n: h }) as string;
      const d = Math.round(h / 24);
      return this.$t('notifications.relative.daysAgo', { n: d }) as string;
    },
  },
});
</script>

<style lang="scss" scoped>
.notification-item {
  &--unread {
    background: rgba(63, 81, 181, 0.04);

    body.body--dark & {
      background: rgba(63, 81, 181, 0.12);
    }
  }
}

.notification-item__time {
  margin-top: 2px;
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.45));
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--q-primary);
}
</style>
```

Then update `NotificationBell.vue` to use the new component instead of inline rendering:

```vue
<!-- In NotificationBell.vue, replace the inline q-item blocks: -->
<q-list v-else separator>
  <NotificationItem
    v-for="n in list"
    :key="n.id"
    :notification="n"
    @click="onClickItem"
  />
</q-list>
```

And import:
```typescript
import NotificationItem from './NotificationItem.vue';
// ...
components: { NotificationItem },
```

### Routing

Verify the Inbox is the default route after login. In `apps/web/src/router/routes.ts`:

```typescript
{
  path: '/',
  component: () => import('layouts/MainLayout.vue'),
  meta: { requiresAuth: true },
  children: [
    { path: '', name: 'inbox', component: () => import('pages/InboxPage.vue') },
    // ... other routes
  ],
},
```

If the route already exists pointing to a stub component, just swap the component reference.

### i18n keys

`apps/web/src/i18n/de/inbox.ts`:

```typescript
export default {
  title: 'Inbox',
  signedInAs: 'Angemeldet als {email}',

  allQuiet: {
    title: 'Alles ruhig',
    subtitle: 'Nichts wartet gerade auf dich.',
  },

  tasks: {
    title: 'Aktuelle Aufgaben',
    empty: 'Keine Artikel warten gerade auf Review.',
    review: 'Review',
    statusLabel: {
      proposed: 'Vorgeschlagen',
      outline_review: 'Outline-Review',
      final_review: 'Final-Review',
    },
  },

  running: {
    title: 'Was läuft gerade',
    empty: 'Keine laufenden Pipelines.',
  },

  recentNotifications: {
    title: 'Neu seit gestern',
    empty: 'Keine neuen Benachrichtigungen seit gestern.',
  },
};
```

Mirror in `en/`.

## Acceptance Criteria

### Backend
- [ ] `GET /api/articles/across-projects?statuses=...` returns articles across all projects
- [ ] Validates `statuses` against article-status enum, rejects invalid values
- [ ] Returns 400 if `statuses` missing or empty after filtering
- [ ] Joins project + cluster + pillar names for display
- [ ] Limits to 50 results, ordered by updatedAt desc
- [ ] Requires auth

### Frontend
- [ ] InboxPage renders at `/` (default after login)
- [ ] Three sections: Aktuelle Aufgaben, Was läuft gerade, Neu seit gestern
- [ ] Each section header shows total count
- [ ] Refresh button reloads all three sections in parallel
- [ ] All-empty state shown when no items in any section (single message)
- [ ] Loading skeletons during fetch (no layout shift)
- [ ] Each section's empty state shown when only that section is empty

### Aktuelle Aufgaben
- [ ] Articles in proposed/outline_review/final_review only
- [ ] Grouped by status: outline_review first, final_review second, proposed last
- [ ] Cards display project name, title (or cornerstone keyword), keyword pill if title exists
- [ ] Cornerstones have left primary border + badge
- [ ] Click on card → article-detail page
- [ ] Cards in 1-3 column responsive grid

### Was läuft gerade
- [ ] Lists only `queued` + `running` runs (no terminated)
- [ ] Each row: type pill, title, project, elapsed time, spinner for running
- [ ] Click on row with articleId → article-detail page
- [ ] Click on row without articleId → activity feed page

### Neu seit gestern
- [ ] Lists unread notifications from last 24h, max 10
- [ ] Reuses NotificationItem component
- [ ] Click on notification: marks as read + navigates to link

### Reused/refactored
- [ ] NotificationItem extracted from NotificationBell
- [ ] NotificationBell still works correctly after refactor (no regression)

### i18n
- [ ] All strings via $t() in de + en

## Testing Strategy

Manual smoke tests:

1. **Empty state**: Mark all notifications as read + ensure no in-progress runs + no review-status articles. Open `/` → "Alles ruhig" shown.
2. **All three sections populated**: Have 2+ articles in proposed, 1 in-flight pipeline, 3 unread notifications. Open `/` → all three sections render with counts.
3. **Aktuelle Aufgaben grouping**: Have articles in different review-statuses. Verify groups render in order: outline_review, final_review, proposed.
4. **Cornerstone styling**: Cornerstones in tasks have border + badge.
5. **Card click**: Click task card → navigates to /articles/:id.
6. **Run row click (with article)**: Click running pipeline that has articleId → article detail.
7. **Run row click (without article)**: Click cold-start pipeline → activity feed.
8. **Notification click**: Click unread notification → marks as read + navigates.
9. **Refresh button**: Click refresh → all sections re-fetch (verify network tab).
10. **Setup banner**: Without VAPID keys configured, banner shows above sections (existing behavior preserved).
11. **Dark mode**: Toggle dark, verify all sections render correctly.
12. **Responsive**: Resize to mobile width → cards stack to single column.
13. **NotificationBell regression**: After NotificationItem extraction, bell-dropdown still works exactly like before.

## Open Questions / Decisions Made

**Decision 1: New `/articles/across-projects` endpoint chosen over fan-out from frontend.**
Single round-trip is cleaner. The endpoint is read-only and tightly scoped (only review-statuses), no risk of misuse.

**Decision 2: No live updates on Inbox.**
Decision 11. Inbox is a launchpad, not a monitor.

**Decision 3: Articles "Aktuelle Aufgaben" sub-grouped by status.**
Visual separation makes priority obvious without sorting.

**Decision 4: 24h window for notifications, 1h window for runs.**
24h matches "since yesterday" mental model. 1h for runs because anything older than that should not still be running (would indicate a stuck job — better surfaced via Activity Feed's full-history view).

**Decision 5: NotificationItem extraction — same file structure as InboxTaskCard.**
Both are list-item components rendered in multiple contexts. Same naming convention.

**Decision 6: Setup-incomplete banner stays above the three sections.**
Existing behavior preserved. Marcel sees "configure VAPID keys" or similar above the dashboard when relevant.

**Decision 7: No "all read" / "clear" button for the notifications section.**
Click-through to mark-read is enough. Bulk-clear feels destructive on a page that's about awareness.

**Decision 8: No project filter on Inbox.**
Single-tenant + small project count. If Marcel reaches 5+ active projects, add a filter dropdown then.

**Decision 9: Refresh button is the user's recourse for "is this current?".**
Discrete, predictable. Beats half-baked auto-polling for a glance-and-go page.

**Decision 10: Inbox has no setup wizard or empty-project handling.**
Empty database (fresh install, no projects) just shows all-empty state. Setup wizard is in Spec 32 territory.

## Implementation Order

**Single session, ~3-4h:**

1. Backend `/articles/across-projects` endpoint (~30 min)
2. Extract `NotificationItem` from `NotificationBell` (~30 min)
3. `InboxPage.vue` shell (~45 min)
4. `InboxSection`, `InboxTaskGroup`, `InboxTaskCard` (~1h)
5. `InboxRunRow` (~20 min)
6. Routing verification + remove stub component (~10 min)
7. i18n keys de + en (~20 min)
8. Manual smoke tests (~30 min)
9. Commit: `feat(api,web): inbox dashboard (spec 43)`

## Splitting Plan

Single session.

## Discovered During Implementation

- **Hono route ordering is registration-order-dependent**: the spec's new `GET /articles/across-projects` route had to be registered *before* the existing `GET /articles/:id` wildcard, otherwise Hono would capture "across-projects" as an article ID. This is now documented as a DO NOT in `apps/api/CLAUDE.md`.

## Deviations

- **`useSessionStore` → `useAuthStore`**: The spec's code samples referenced `useSessionStore()` and `session.user?.email`, but no such store exists in the project. Used the existing `useAuthStore()` / `authStore.user?.email` pattern instead (same data, consistent with the pre-existing stub).
- **`SetupIncompleteBanner` kept inline**: The spec listed `SetupIncompleteBanner` as a standalone imported component. The existing stub already had the banner inline using `systemStatusStore.allConfigured`; that pattern was preserved rather than extracting a new component out of scope.
