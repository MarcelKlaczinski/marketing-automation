# Spec 38: Cost Dashboard

**Phase:** 4 (Welle 3)
**Estimated Effort:** 1 day (1-2 sessions)
**Dependencies:** Spec 03 (cost tracker — generates `costLogs` rows), Spec 30 (shell)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (read-only dashboard, SQL aggregation, charts)

---

## Goal

Build the **Cost Dashboard** at `/cost`. Two-tier view:

- **Top section**: Aggregated cards + charts per service & per operation (this month + this year)
- **Bottom section**: Detail table of individual `costLogs` rows with filters

After this spec:
- Marcel can answer "How much did KI-Wissensraum cost this month?" in 5 seconds
- Marcel can drill down to "What was the most expensive single Anthropic call last week?"
- Cost anomalies are immediately visible (a single €5 call when others are €0.30 jumps out)

The Cost Dashboard is **global** (across all projects) by default, with per-project filtering. This matches the credentials model: credentials are global, costs accumulate globally, but projects pay for their own usage.

## Architecture Decisions

**Decision 1: Server-side aggregation via SQL.**
SQL is perfect for this — `GROUP BY service, operation`, `DATE_TRUNC('day', createdAt)`, etc. Backend exposes pre-aggregated endpoints. Frontend never aggregates raw logs.

**Decision 2: Two endpoints — one for aggregations, one for detail.**
- `GET /api/cost/aggregations` — buckets and totals
- `GET /api/cost/logs` — paginated list of individual records, with filter params

This keeps queries fast and intentional. No "give me all 10,000 rows and let the UI aggregate."

**Decision 3: Time periods baked into aggregations endpoint.**
The endpoint returns multiple time windows in one response: this month, last month, this year. Frontend doesn't query each separately. Reduces network round-trips and lets a single component render the entire summary.

**Decision 4: Charts via Chart.js.**
Already a known library, lightweight (~50KB), Vue-friendly via `vue-chartjs`. Alternative considered: ECharts (too heavy), Plotly (overkill).

**Decision 5: Detail table with server-side filter + pagination.**
Filters: project (dropdown), service, operation (text contains), date range (from/to). Pagination: 50 rows per page.

**Decision 6: All cost amounts displayed in EUR with 2-4 decimals.**
DB stores `decimal(10,6)` — 6 decimals of precision. Display rounds to 4 by default, 2 when value > €1.00 (avoid showing `€1.500000`). Helper function in frontend.

**Decision 7: Cost Dashboard is a top-level route, not in a project hub.**
At `/cost`. Available globally. Per-project filter shown as dropdown. Reason: cost is mostly cross-cutting; you want to compare projects.

**Decision 8: No cost limits / alerts UI in this spec.**
Cost limits are configured in projects.costLimits already (Spec 03). Alerting on threshold breaches is done backend-side. UI surfacing alerts is a future spec (likely tied to Spec 39 Activity Feed).

**Decision 9: No cost forecasting / projections.**
Out of scope. Show what was spent. Inferring "you'll spend €130 by month-end" is fancy but error-prone with sparse data.

**Decision 10: No CSV export in this spec.**
Could add later. For now, Marcel queries Drizzle directly if he needs raw data.

## Non-Goals

- **No cost limit configuration UI** — done in project settings (Spec 34) via JSON; no granular UI in v1
- **No alert / notification system** for budget breaches
- **No forecasts / projections**
- **No CSV/Excel export**
- **No cost-by-user attribution** (single-user system)
- **No cost optimization recommendations** ("you could save by...")

## Detailed Implementation

### Backend: Cost Aggregation Endpoint

`apps/api/src/routes/cost.ts`:

```typescript
import { Hono } from 'hono';
import { eq, and, gte, lte, desc, sql, like } from 'drizzle-orm';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, costLogs, projects } from '@marketing-auto/db';
import { requireAuth } from '../middleware/require-auth';

export const costRoutes = new Hono();
costRoutes.use(requireAuth);

interface AggregationBucket {
  service: string;
  operation: string;
  totalEur: string;
  callCount: number;
}

interface DailyTotal {
  day: string; // ISO date YYYY-MM-DD
  totalEur: string;
}

interface AggregationsResponse {
  thisMonth: {
    totalEur: string;
    byService: Array<{ service: string; totalEur: string; callCount: number }>;
    byServiceAndOperation: AggregationBucket[];
    daily: DailyTotal[];
  };
  lastMonth: {
    totalEur: string;
    byService: Array<{ service: string; totalEur: string; callCount: number }>;
  };
  thisYear: {
    totalEur: string;
    byMonth: Array<{ month: string; totalEur: string }>;
  };
}

// ───── GET /api/cost/aggregations ───────────────────────────────────────
// Returns prebaked summary buckets for the dashboard.
// Optional query: ?projectId=xxx to filter to a single project.

costRoutes.get('/aggregations', async (c) => {
  const projectId = c.req.query('projectId');
  const projectFilter = projectId ? eq(costLogs.projectId, projectId) : undefined;

  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Total this month
  const thisMonthTotalRow = await db.select({
    totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
  })
    .from(costLogs)
    .where(and(
      gte(costLogs.createdAt, startOfThisMonth),
      ...(projectFilter ? [projectFilter] : []),
    ));

  // Per-service this month
  const thisMonthByService = await db.select({
    service: costLogs.service,
    totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
    callCount: sql<number>`count(*)::int`,
  })
    .from(costLogs)
    .where(and(
      gte(costLogs.createdAt, startOfThisMonth),
      ...(projectFilter ? [projectFilter] : []),
    ))
    .groupBy(costLogs.service);

  // Per-service-and-operation this month
  const thisMonthByOp = await db.select({
    service: costLogs.service,
    operation: costLogs.operation,
    totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
    callCount: sql<number>`count(*)::int`,
  })
    .from(costLogs)
    .where(and(
      gte(costLogs.createdAt, startOfThisMonth),
      ...(projectFilter ? [projectFilter] : []),
    ))
    .groupBy(costLogs.service, costLogs.operation)
    .orderBy(desc(sql`sum(${costLogs.costEur})`));

  // Daily totals this month
  const thisMonthDaily = await db.select({
    day: sql<string>`to_char(${costLogs.createdAt}, 'YYYY-MM-DD')`,
    totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
  })
    .from(costLogs)
    .where(and(
      gte(costLogs.createdAt, startOfThisMonth),
      ...(projectFilter ? [projectFilter] : []),
    ))
    .groupBy(sql`to_char(${costLogs.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${costLogs.createdAt}, 'YYYY-MM-DD')`);

  // Last month total + per-service
  const lastMonthByService = await db.select({
    service: costLogs.service,
    totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
    callCount: sql<number>`count(*)::int`,
  })
    .from(costLogs)
    .where(and(
      gte(costLogs.createdAt, startOfLastMonth),
      lte(costLogs.createdAt, endOfLastMonth),
      ...(projectFilter ? [projectFilter] : []),
    ))
    .groupBy(costLogs.service);

  const lastMonthTotalRow = await db.select({
    totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
  })
    .from(costLogs)
    .where(and(
      gte(costLogs.createdAt, startOfLastMonth),
      lte(costLogs.createdAt, endOfLastMonth),
      ...(projectFilter ? [projectFilter] : []),
    ));

  // Year-to-date total + per-month
  const thisYearTotalRow = await db.select({
    totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
  })
    .from(costLogs)
    .where(and(
      gte(costLogs.createdAt, startOfYear),
      ...(projectFilter ? [projectFilter] : []),
    ));

  const thisYearByMonth = await db.select({
    month: sql<string>`to_char(${costLogs.createdAt}, 'YYYY-MM')`,
    totalEur: sql<string>`coalesce(sum(${costLogs.costEur}), 0)::text`,
  })
    .from(costLogs)
    .where(and(
      gte(costLogs.createdAt, startOfYear),
      ...(projectFilter ? [projectFilter] : []),
    ))
    .groupBy(sql`to_char(${costLogs.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${costLogs.createdAt}, 'YYYY-MM')`);

  const response: AggregationsResponse = {
    thisMonth: {
      totalEur: thisMonthTotalRow[0]?.totalEur ?? '0',
      byService: thisMonthByService,
      byServiceAndOperation: thisMonthByOp,
      daily: thisMonthDaily,
    },
    lastMonth: {
      totalEur: lastMonthTotalRow[0]?.totalEur ?? '0',
      byService: lastMonthByService,
    },
    thisYear: {
      totalEur: thisYearTotalRow[0]?.totalEur ?? '0',
      byMonth: thisYearByMonth,
    },
  };

  return c.json({ ok: true, data: response });
});

// ───── GET /api/cost/logs ───────────────────────────────────────────────
// Paginated detail logs with filters.

const logsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  service: z.enum(['anthropic', 'replicate', 'dataforseo', 'smtp']).optional(),
  operation: z.string().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

costRoutes.get('/logs', async (c) => {
  const parsed = logsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid query params' }, 400);
  const q = parsed.data;

  const filters = [];
  if (q.projectId) filters.push(eq(costLogs.projectId, q.projectId));
  if (q.service) filters.push(eq(costLogs.service, q.service));
  if (q.operation) filters.push(like(costLogs.operation, `%${q.operation}%`));
  if (q.from) filters.push(gte(costLogs.createdAt, new Date(q.from)));
  if (q.to) filters.push(lte(costLogs.createdAt, new Date(q.to)));

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  // Logs with project info joined
  const logs = await db.select({
    id: costLogs.id,
    projectId: costLogs.projectId,
    projectName: projects.name,
    projectSlug: projects.slug,
    service: costLogs.service,
    operation: costLogs.operation,
    costEur: costLogs.costEur,
    metadata: costLogs.metadata,
    pipelineRunId: costLogs.pipelineRunId,
    articleId: costLogs.articleId,
    createdAt: costLogs.createdAt,
  })
    .from(costLogs)
    .leftJoin(projects, eq(costLogs.projectId, projects.id))
    .where(whereClause)
    .orderBy(desc(costLogs.createdAt))
    .limit(q.limit)
    .offset(q.offset);

  // Total count for pagination
  const [countRow] = await db.select({
    count: sql<number>`count(*)::int`,
  })
    .from(costLogs)
    .where(whereClause);

  return c.json({
    ok: true,
    data: {
      logs,
      total: countRow?.count ?? 0,
      limit: q.limit,
      offset: q.offset,
    },
  });
});
```

Mount in `apps/api/src/index.ts`:
```typescript
app.route('/api/cost', costRoutes);
```

### Frontend: Cost Store

`apps/web/src/stores/cost.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

export interface CostBucket {
  service: string;
  operation?: string;
  totalEur: string;
  callCount?: number;
}

export interface DailyTotal {
  day: string;
  totalEur: string;
}

export interface MonthlyTotal {
  month: string;
  totalEur: string;
}

export interface CostAggregations {
  thisMonth: {
    totalEur: string;
    byService: CostBucket[];
    byServiceAndOperation: CostBucket[];
    daily: DailyTotal[];
  };
  lastMonth: {
    totalEur: string;
    byService: CostBucket[];
  };
  thisYear: {
    totalEur: string;
    byMonth: MonthlyTotal[];
  };
}

export interface CostLog {
  id: string;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  service: string;
  operation: string;
  costEur: string;
  metadata: Record<string, unknown>;
  pipelineRunId: string | null;
  articleId: string | null;
  createdAt: string;
}

export interface CostLogsResponse {
  logs: CostLog[];
  total: number;
  limit: number;
  offset: number;
}

interface CostState {
  aggregations: CostAggregations | null;
  logs: CostLogsResponse | null;
  loading: boolean;
  filters: {
    projectId: string | null;
    service: string | null;
    operation: string;
    from: string | null;
    to: string | null;
  };
}

export const useCostStore = defineStore('cost', {
  state: (): CostState => ({
    aggregations: null,
    logs: null,
    loading: false,
    filters: {
      projectId: null,
      service: null,
      operation: '',
      from: null,
      to: null,
    },
  }),

  actions: {
    async fetchAggregations(): Promise<void> {
      this.loading = true;
      try {
        const params: Record<string, string> = {};
        if (this.filters.projectId) params.projectId = this.filters.projectId;
        const queryString = new URLSearchParams(params).toString();
        const res = await api.get<{ ok: boolean; data: CostAggregations }>(
          `/cost/aggregations${queryString ? '?' + queryString : ''}`,
        );
        this.aggregations = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async fetchLogs(limit = 50, offset = 0): Promise<void> {
      const params: Record<string, string> = {
        limit: String(limit),
        offset: String(offset),
      };
      if (this.filters.projectId) params.projectId = this.filters.projectId;
      if (this.filters.service) params.service = this.filters.service;
      if (this.filters.operation) params.operation = this.filters.operation;
      if (this.filters.from) params.from = this.filters.from;
      if (this.filters.to) params.to = this.filters.to;

      const queryString = new URLSearchParams(params).toString();
      const res = await api.get<{ ok: boolean; data: CostLogsResponse }>(`/cost/logs?${queryString}`);
      this.logs = res.data.data;
    },

    setFilters(patch: Partial<CostState['filters']>): void {
      this.filters = { ...this.filters, ...patch };
    },
  },
});
```

### Frontend: CostDashboardPage

`apps/web/src/pages/CostDashboardPage.vue`:

```vue
<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('cost.title') }}</h1>
      </div>
      <div class="col-auto">
        <q-select
          v-model="selectedProjectId"
          outlined
          dense
          :options="projectOptions"
          emit-value
          map-options
          :label="$t('cost.filters.project')"
          style="min-width: 220px;"
          @update:model-value="onProjectChange"
        />
      </div>
    </div>

    <CostSummaryCards :aggregations="costStore.aggregations" :loading="costStore.loading" />
    <CostByServiceChart :aggregations="costStore.aggregations" class="q-mt-lg" />
    <CostDailyChart :aggregations="costStore.aggregations" class="q-mt-lg" />
    <CostByOperationTable :aggregations="costStore.aggregations" class="q-mt-lg" />

    <h2 class="text-h6 q-mt-xl q-mb-md">{{ $t('cost.detailLogs') }}</h2>
    <CostLogsTable />
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useCostStore } from 'src/stores/cost';
import { useProjectsStore } from 'src/stores/projects';
import CostSummaryCards from 'src/components/cost/CostSummaryCards.vue';
import CostByServiceChart from 'src/components/cost/CostByServiceChart.vue';
import CostDailyChart from 'src/components/cost/CostDailyChart.vue';
import CostByOperationTable from 'src/components/cost/CostByOperationTable.vue';
import CostLogsTable from 'src/components/cost/CostLogsTable.vue';

export default defineComponent({
  name: 'CostDashboardPage',

  components: {
    CostSummaryCards,
    CostByServiceChart,
    CostDailyChart,
    CostByOperationTable,
    CostLogsTable,
  },

  setup() {
    return {
      costStore: useCostStore(),
      projectsStore: useProjectsStore(),
    };
  },

  data: () => ({
    selectedProjectId: null as string | null,
  }),

  computed: {
    projectOptions() {
      const opts = this.projectsStore.list.map((p) => ({
        label: p.name,
        value: p.id,
      }));
      return [
        { label: this.$t('cost.filters.allProjects'), value: null },
        ...opts,
      ];
    },
  },

  async created() {
    if (this.projectsStore.list.length === 0) {
      await this.projectsStore.fetchList();
    }
    await this.costStore.fetchAggregations();
    await this.costStore.fetchLogs();
  },

  methods: {
    async onProjectChange(): Promise<void> {
      this.costStore.setFilters({ projectId: this.selectedProjectId });
      await this.costStore.fetchAggregations();
      await this.costStore.fetchLogs();
    },
  },
});
</script>
```

### Frontend: CostSummaryCards

`apps/web/src/components/cost/CostSummaryCards.vue`:

```vue
<template>
  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-card__label">{{ $t('cost.summary.thisMonth') }}</div>
      <div class="summary-card__value">€ {{ formatEur(aggregations?.thisMonth.totalEur ?? '0') }}</div>
      <div v-if="lastMonthValue !== null" class="summary-card__caption">
        <q-icon
          :name="trendIcon"
          :color="trendColor"
          size="14px"
          class="q-mr-xs"
        />
        {{ trendCaption }}
      </div>
    </div>

    <div class="summary-card">
      <div class="summary-card__label">{{ $t('cost.summary.lastMonth') }}</div>
      <div class="summary-card__value">€ {{ formatEur(aggregations?.lastMonth.totalEur ?? '0') }}</div>
    </div>

    <div class="summary-card">
      <div class="summary-card__label">{{ $t('cost.summary.thisYear') }}</div>
      <div class="summary-card__value">€ {{ formatEur(aggregations?.thisYear.totalEur ?? '0') }}</div>
    </div>

    <div class="summary-card">
      <div class="summary-card__label">{{ $t('cost.summary.dailyAvg') }}</div>
      <div class="summary-card__value">€ {{ formatEur(dailyAvg) }}</div>
      <div class="summary-card__caption">{{ $t('cost.summary.dailyAvgHint') }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { formatEur } from 'src/lib/format-eur';
import type { CostAggregations } from 'src/stores/cost';

export default defineComponent({
  name: 'CostSummaryCards',

  props: {
    aggregations: { type: Object as PropType<CostAggregations | null>, default: null },
    loading: { type: Boolean, default: false },
  },

  computed: {
    thisMonthValue(): number {
      return parseFloat(this.aggregations?.thisMonth.totalEur ?? '0');
    },
    lastMonthValue(): number | null {
      const v = this.aggregations?.lastMonth.totalEur;
      return v ? parseFloat(v) : null;
    },
    trendIcon(): string {
      if (this.lastMonthValue === null) return 'remove';
      return this.thisMonthValue > this.lastMonthValue ? 'trending_up' : 'trending_down';
    },
    trendColor(): string {
      if (this.lastMonthValue === null) return 'grey';
      // Higher = worse (more spending), so trending_up is negative
      return this.thisMonthValue > this.lastMonthValue ? 'negative' : 'positive';
    },
    trendCaption(): string {
      if (this.lastMonthValue === null) return '';
      const diff = this.thisMonthValue - this.lastMonthValue;
      const pct = this.lastMonthValue > 0
        ? Math.abs(diff / this.lastMonthValue) * 100
        : 0;
      const sign = diff >= 0 ? '+' : '−';
      return `${sign}${pct.toFixed(0)}% ${this.$t('cost.summary.vsLastMonth')}`;
    },
    dailyAvg(): string {
      if (!this.aggregations) return '0';
      const totalThisMonth = parseFloat(this.aggregations.thisMonth.totalEur);
      const dayOfMonth = new Date().getDate();
      return (totalThisMonth / dayOfMonth).toFixed(4);
    },
  },

  methods: {
    formatEur,
  },
});
</script>

<style lang="scss" scoped>
.summary-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 640px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 1024px) {
    grid-template-columns: repeat(4, 1fr);
  }
}

.summary-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.summary-card__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 8px;
}

.summary-card__value {
  font-size: 26px;
  font-weight: 600;
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
}

.summary-card__caption {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  display: flex;
  align-items: center;
}
</style>
```

### Frontend: format-eur helper

`apps/web/src/lib/format-eur.ts`:

```typescript
/**
 * Formats a EUR value (string or number) for display.
 * Rules:
 * - Values >= 1.00: 2 decimals (e.g., "12.34")
 * - Values < 1.00: 4 decimals (e.g., "0.0234")
 * - Values < 0.0001: 6 decimals (rare; e.g., "0.000045")
 */
export function formatEur(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';

  if (Math.abs(num) >= 1) return num.toFixed(2);
  if (Math.abs(num) >= 0.0001) return num.toFixed(4);
  return num.toFixed(6);
}
```

### Frontend: CostByServiceChart (Chart.js)

Install dependencies:
```bash
cd apps/web
bun add chart.js vue-chartjs
```

`apps/web/src/components/cost/CostByServiceChart.vue`:

```vue
<template>
  <div class="chart-card">
    <div class="chart-card__title">{{ $t('cost.charts.byService') }}</div>
    <div v-if="!aggregations" class="chart-card__empty">
      {{ $t('cost.charts.noData') }}
    </div>
    <div v-else class="chart-wrap">
      <Doughnut :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { Chart, ArcElement, Tooltip, Legend, type ChartOptions } from 'chart.js';
import { Doughnut } from 'vue-chartjs';
import { formatEur } from 'src/lib/format-eur';
import type { CostAggregations } from 'src/stores/cost';

Chart.register(ArcElement, Tooltip, Legend);

const SERVICE_COLORS: Record<string, string> = {
  anthropic: '#3f51b5',     // primary indigo
  replicate: '#7c4dff',     // accent purple
  dataforseo: '#26a69a',    // secondary teal
  smtp: '#f2c037',          // warning yellow
};

export default defineComponent({
  name: 'CostByServiceChart',

  components: { Doughnut },

  props: {
    aggregations: { type: Object as PropType<CostAggregations | null>, default: null },
  },

  computed: {
    chartData() {
      const services = this.aggregations?.thisMonth.byService ?? [];
      return {
        labels: services.map((s) => s.service),
        datasets: [{
          backgroundColor: services.map((s) => SERVICE_COLORS[s.service] ?? '#999'),
          data: services.map((s) => parseFloat(s.totalEur)),
        }],
      };
    },

    chartOptions(): ChartOptions<'doughnut'> {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { boxWidth: 12, padding: 12 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const label = ctx.label ?? '';
                const value = ctx.parsed;
                return `${label}: € ${formatEur(value)}`;
              },
            },
          },
        },
      };
    },
  },
});
</script>

<style lang="scss" scoped>
.chart-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.chart-card__title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.chart-card__empty {
  text-align: center;
  padding: 40px 0;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}

.chart-wrap {
  height: 240px;
  position: relative;
}
</style>
```

### Frontend: CostDailyChart

Same pattern, using `Bar` chart from `vue-chartjs`. Bars per day for current month.

```vue
<template>
  <div class="chart-card">
    <div class="chart-card__title">{{ $t('cost.charts.daily') }}</div>
    <div class="chart-wrap">
      <Bar :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { Chart, BarElement, CategoryScale, LinearScale, Tooltip, type ChartOptions } from 'chart.js';
import { Bar } from 'vue-chartjs';
import { formatEur } from 'src/lib/format-eur';
import type { CostAggregations } from 'src/stores/cost';

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip);

export default defineComponent({
  name: 'CostDailyChart',

  components: { Bar },

  props: {
    aggregations: { type: Object as PropType<CostAggregations | null>, default: null },
  },

  computed: {
    chartData() {
      const daily = this.aggregations?.thisMonth.daily ?? [];
      return {
        labels: daily.map((d) => d.day.slice(8)), // just DD
        datasets: [{
          label: 'EUR',
          backgroundColor: '#3f51b5',
          data: daily.map((d) => parseFloat(d.totalEur)),
        }],
      };
    },

    chartOptions(): ChartOptions<'bar'> {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `€ ${formatEur(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => `€ ${formatEur(v)}`,
            },
          },
        },
      };
    },
  },
});
</script>

<style lang="scss" scoped>
/* Same as CostByServiceChart */
</style>
```

### Frontend: CostByOperationTable

`apps/web/src/components/cost/CostByOperationTable.vue`:

```vue
<template>
  <div class="op-table-card">
    <div class="op-table-card__title">{{ $t('cost.charts.byOperation') }}</div>

    <table v-if="rows.length > 0" class="op-table">
      <thead>
        <tr>
          <th>{{ $t('cost.table.service') }}</th>
          <th>{{ $t('cost.table.operation') }}</th>
          <th class="num">{{ $t('cost.table.callCount') }}</th>
          <th class="num">{{ $t('cost.table.totalEur') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, idx) in rows" :key="`${row.service}-${row.operation}-${idx}`">
          <td>
            <span :class="`service-pill service-pill--${row.service}`">{{ row.service }}</span>
          </td>
          <td class="op-cell">{{ row.operation }}</td>
          <td class="num">{{ row.callCount }}</td>
          <td class="num">€ {{ formatEur(row.totalEur) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-else class="op-table-card__empty">{{ $t('cost.charts.noData') }}</div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { formatEur } from 'src/lib/format-eur';
import type { CostAggregations } from 'src/stores/cost';

export default defineComponent({
  name: 'CostByOperationTable',

  props: {
    aggregations: { type: Object as PropType<CostAggregations | null>, default: null },
  },

  computed: {
    rows() {
      return this.aggregations?.thisMonth.byServiceAndOperation ?? [];
    },
  },

  methods: {
    formatEur,
  },
});
</script>

<style lang="scss" scoped>
.op-table-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.op-table-card__title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.op-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

    body.body--dark & {
      border-bottom-color: rgba(255, 255, 255, 0.06);
    }
  }

  th {
    font-weight: 600;
    color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
    background: var(--q-grey-1, #fafafa);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;

    body.body--dark & {
      background: rgba(255, 255, 255, 0.03);
    }
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .op-cell {
    font-family: monospace;
    font-size: 12px;
  }
}

.service-pill {
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.04em;

  &--anthropic { background: rgba(63, 81, 181, 0.12); color: #3f51b5; }
  &--replicate { background: rgba(124, 77, 255, 0.12); color: #7c4dff; }
  &--dataforseo { background: rgba(38, 166, 154, 0.12); color: #26a69a; }
  &--smtp { background: rgba(242, 192, 55, 0.18); color: #b07b00; }
}

.op-table-card__empty {
  text-align: center;
  padding: 40px 0;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}
</style>
```

### Frontend: CostLogsTable (with filters + pagination)

`apps/web/src/components/cost/CostLogsTable.vue`:

```vue
<template>
  <div class="logs-card">
    <div class="logs-card__filters">
      <q-select
        v-model="localFilters.service"
        outlined
        dense
        :options="serviceOptions"
        emit-value
        map-options
        :label="$t('cost.filters.service')"
        clearable
        style="min-width: 160px;"
        @update:model-value="onFilterChange"
      />
      <q-input
        v-model="localFilters.operation"
        outlined
        dense
        :label="$t('cost.filters.operation')"
        :placeholder="$t('cost.filters.operationPlaceholder')"
        debounce="400"
        clearable
        style="min-width: 200px;"
        @update:model-value="onFilterChange"
      />
      <!-- Date filters omitted for brevity; use q-date inside q-popup-proxy -->
    </div>

    <table v-if="costStore.logs && costStore.logs.logs.length > 0" class="logs-table">
      <thead>
        <tr>
          <th>{{ $t('cost.table.date') }}</th>
          <th>{{ $t('cost.table.project') }}</th>
          <th>{{ $t('cost.table.service') }}</th>
          <th>{{ $t('cost.table.operation') }}</th>
          <th class="num">{{ $t('cost.table.totalEur') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in costStore.logs.logs" :key="log.id">
          <td>{{ formatDateTime(log.createdAt) }}</td>
          <td>{{ log.projectName ?? '—' }}</td>
          <td>
            <span :class="`service-pill service-pill--${log.service}`">{{ log.service }}</span>
          </td>
          <td class="op-cell">{{ log.operation }}</td>
          <td class="num">€ {{ formatEur(log.costEur) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-else-if="costStore.logs" class="logs-card__empty">{{ $t('cost.table.noResults') }}</div>

    <div v-if="costStore.logs && costStore.logs.total > limit" class="logs-card__pagination">
      <q-btn
        flat
        icon="chevron_left"
        :disable="offset === 0"
        @click="changePage(offset - limit)"
      />
      <span class="page-info">
        {{ offset + 1 }} – {{ Math.min(offset + limit, costStore.logs.total) }}
        {{ $t('cost.table.of') }}
        {{ costStore.logs.total }}
      </span>
      <q-btn
        flat
        icon="chevron_right"
        :disable="offset + limit >= costStore.logs.total"
        @click="changePage(offset + limit)"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useCostStore } from 'src/stores/cost';
import { formatEur } from 'src/lib/format-eur';

export default defineComponent({
  name: 'CostLogsTable',

  setup() {
    return { costStore: useCostStore() };
  },

  data: () => ({
    limit: 50,
    offset: 0,
    localFilters: {
      service: null as string | null,
      operation: '',
    },
  }),

  computed: {
    serviceOptions() {
      return [
        { label: 'Anthropic', value: 'anthropic' },
        { label: 'Replicate', value: 'replicate' },
        { label: 'DataForSEO', value: 'dataforseo' },
        { label: 'SMTP', value: 'smtp' },
      ];
    },
  },

  methods: {
    formatEur,

    formatDateTime(iso: string): string {
      const d = new Date(iso);
      const locale = this.$i18n.locale;
      return d.toLocaleString(locale, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    },

    async onFilterChange(): Promise<void> {
      this.costStore.setFilters(this.localFilters);
      this.offset = 0;
      await this.costStore.fetchLogs(this.limit, 0);
    },

    async changePage(newOffset: number): Promise<void> {
      this.offset = newOffset;
      await this.costStore.fetchLogs(this.limit, newOffset);
    },
  },
});
</script>

<style lang="scss" scoped>
.logs-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);
  overflow: hidden;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.logs-card__filters {
  display: flex;
  gap: 12px;
  padding: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    padding: 10px 16px;
    border-bottom: 1px solid var(--q-grey-2, #f0f0f0);
    text-align: left;

    body.body--dark & {
      border-bottom-color: rgba(255, 255, 255, 0.06);
    }
  }

  th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
    background: var(--q-grey-1, #fafafa);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.03);
    }
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .op-cell {
    font-family: monospace;
    font-size: 12px;
  }
}

.service-pill {
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;

  &--anthropic { background: rgba(63, 81, 181, 0.12); color: #3f51b5; }
  &--replicate { background: rgba(124, 77, 255, 0.12); color: #7c4dff; }
  &--dataforseo { background: rgba(38, 166, 154, 0.12); color: #26a69a; }
  &--smtp { background: rgba(242, 192, 55, 0.18); color: #b07b00; }
}

.logs-card__empty {
  text-align: center;
  padding: 40px 0;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}

.logs-card__pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--q-grey-2, #f0f0f0);
  gap: 12px;

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}

.page-info {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-variant-numeric: tabular-nums;
}
</style>
```

### i18n keys

`apps/web/src/i18n/de/cost.ts`:

```typescript
export default {
  title: 'Kosten',
  detailLogs: 'Detail-Logs',

  summary: {
    thisMonth: 'Dieser Monat',
    lastMonth: 'Letzter Monat',
    thisYear: 'Dieses Jahr',
    dailyAvg: 'Tagesdurchschnitt',
    dailyAvgHint: 'Tagesschnitt aktueller Monat',
    vsLastMonth: 'vs. letzten Monat',
  },

  charts: {
    byService: 'Kosten nach Service',
    daily: 'Täglicher Verlauf (aktueller Monat)',
    byOperation: 'Kosten nach Operation',
    noData: 'Keine Daten für diesen Zeitraum',
  },

  filters: {
    project: 'Projekt',
    allProjects: 'Alle Projekte',
    service: 'Service',
    operation: 'Operation',
    operationPlaceholder: 'z.B. outline-generation',
  },

  table: {
    date: 'Datum',
    project: 'Projekt',
    service: 'Service',
    operation: 'Operation',
    callCount: 'Aufrufe',
    totalEur: 'Summe',
    of: 'von',
    noResults: 'Keine Treffer für diese Filter',
  },
};
```

Mirror in `en/`.

## Acceptance Criteria

### Backend
- [ ] `GET /api/cost/aggregations` returns prebaked summary with thisMonth/lastMonth/thisYear
- [ ] Optional `?projectId=` filter narrows aggregations
- [ ] `GET /api/cost/logs?limit=50&offset=0` returns paginated logs
- [ ] Filter params: `projectId`, `service`, `operation` (LIKE), `from`, `to`
- [ ] Logs include project name (joined from projects table)
- [ ] All endpoints require auth

### Frontend
- [ ] `/cost` route renders dashboard
- [ ] Project filter dropdown switches between "all projects" and individual project
- [ ] 4 summary cards: This Month, Last Month, This Year, Daily Avg
- [ ] This Month card shows trend indicator vs. last month
- [ ] Doughnut chart by service renders correctly
- [ ] Bar chart for daily totals renders correctly
- [ ] Operation table sorted by total cost desc
- [ ] Detail logs table with filter inputs
- [ ] Pagination prev/next buttons work
- [ ] EUR values formatted: 2 decimals when ≥ €1, 4 decimals when < €1, 6 decimals when < €0.0001

## Testing Strategy

Manual tests:

1. **Empty state**: Fresh DB with no cost logs. Visit `/cost`. All cards show €0. Charts show "no data".
2. **With data**: After Cold-Start runs, logs exist. Verify totals match Drizzle Studio query.
3. **Project filter**: Select KI-Wissensraum. Verify totals only include that project.
4. **Filter logs**: Filter by service=anthropic. Verify only Anthropic rows shown. Add operation filter "outline". Verify narrows further.
5. **Pagination**: Generate 100+ cost logs (run Cold-Start a few times). Verify prev/next buttons work, total count correct.
6. **Trend calculation**: Verify "this month vs last month" % calculation correct manually.

## Open Questions / Decisions Made

**Decision 1: Server-side aggregation only.**
Frontend never aggregates raw logs. Backend SQL is faster + correct.

**Decision 2: Chart.js over alternatives.**
Lightweight, well-maintained, Vue integration via `vue-chartjs`. Familiar API.

**Decision 3: Pagination via offset+limit, not cursor.**
Cost logs aren't real-time-modified, offset is fine. Cursor pagination is overkill.

**Decision 4: No aggregations for "today".**
Daily chart shows last 30-31 days; today is the latest bar. No separate "today" KPI card.

**Decision 5: No cost forecasts.**
Out of scope. Predicting "you'll spend €X" with sparse data is risky.

**Decision 6: All amounts in EUR — no currency conversion.**
DB already stores EUR. Anthropic/Replicate APIs are billed in USD; cost-tracker (Spec 03) converted at write-time using fixed rate constant. Display is uniform EUR.

**Decision 7: Operation filter uses LIKE %x%.**
Substring match is good UX. Performance fine for thousands of rows.

**Decision 8: Date range filter UI deferred to v2.**
Adding two date pickers + validation doubles the UI complexity. Marcel can use direct DB query for date-bound exports for now. Add later if requested.

## Implementation Order

**Single session, ~5-6h:**

1. Backend `costRoutes` with both endpoints (~1.5h)
2. Frontend store + format-eur helper (~30 min)
3. CostDashboardPage shell (~30 min)
4. CostSummaryCards (~30 min)
5. CostByServiceChart (Doughnut) (~30 min)
6. CostDailyChart (Bar) (~30 min)
7. CostByOperationTable (~30 min)
8. CostLogsTable with filters + pagination (~1h)
9. i18n keys (~20 min)
10. Manual smoke tests (~30 min)
11. Commit: `feat(web): cost dashboard (spec 38)`

If the session exceeds 5-6h, split between charts (session 1) and detail table (session 2).

## Splitting Plan

Optional split. Not required.

## Discovered During Implementation

(empty — fill during/after implementation)

## Deviations

(empty — fill during/after implementation)
