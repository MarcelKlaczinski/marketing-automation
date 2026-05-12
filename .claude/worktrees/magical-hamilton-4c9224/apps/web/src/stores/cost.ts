import { defineStore } from "pinia";
import { api } from "src/lib/api-client";

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

export interface CostAlert {
  id: string;
  projectId: string;
  projectName: string | null;
  service: string;
  thresholdType: "daily" | "monthly";
  limitEur: string;
  spentEur: string;
  percent: number;
  acknowledgedAt: string | null;
  createdAt: string;
}

interface CostFilters {
  projectId: string | null;
  service: string | null;
  operation: string;
  from: string | null;
  to: string | null;
}

interface CostState {
  aggregations: CostAggregations | null;
  logs: CostLogsResponse | null;
  alerts: CostAlert[];
  loading: boolean;
  filters: CostFilters;
}

export const useCostStore = defineStore("cost", {
  state: (): CostState => ({
    aggregations: null,
    logs: null,
    alerts: [],
    loading: false,
    filters: {
      projectId: null,
      service: null,
      operation: "",
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
          `/cost/aggregations${queryString ? `?${queryString}` : ""}`
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
      const res = await api.get<{ ok: boolean; data: CostLogsResponse }>(
        `/cost/logs?${queryString}`
      );
      this.logs = res.data.data;
    },

    setFilters(patch: Partial<CostFilters>): void {
      this.filters = { ...this.filters, ...patch };
    },

    async fetchAlerts(): Promise<void> {
      const res = await api.get<{ ok: boolean; data: CostAlert[] }>("/cost/alerts");
      this.alerts = res.data.data;
    },

    async acknowledgeAlert(id: string): Promise<void> {
      await api.post(`/cost/alerts/${id}/acknowledge`);
      await this.fetchAlerts();
    },
  },
});
