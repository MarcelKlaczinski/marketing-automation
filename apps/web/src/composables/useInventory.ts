// Spec 64.20: TanStack Query composable for `content_source_inventory`.
// Provides reactive list + mutations for create / patch / delete / refresh.
//
// Composition API is acceptable here because composables are explicitly allowed
// (per apps/web/CLAUDE.md "Composition API only in composables").

import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { computed, type MaybeRef, unref } from "vue";
import { apiDelete, apiGet, apiPatch, apiPost } from "src/lib/api";

// ─── Shapes (mirror DB schema) ──────────────────────────────────────────────

export interface InventoryGithubMetadata {
  starsCount: number;
  forksCount: number;
  watchersCount?: number;
  primaryLanguage: string | null;
  license: string | null;
  topics: string[];
  defaultBranch: string;
  createdAt: string;
  pushedAt: string;
  latestRelease: { tag: string; name: string | null; publishedAt: string } | null;
  skillFrontmatter?: { name: string; description: string; category?: string; version?: string };
}

export interface InventoryRow {
  id: string;
  projectId: string;
  source: "github";
  objectType: "tool" | "skill";
  sourceIdentifier: string;
  displayName: string;
  description: string | null;
  homepageUrl: string | null;
  githubMetadata: InventoryGithubMetadata | Record<string, never>;
  fetchStatus: "pending" | "fetching" | "ok" | "error";
  fetchError: string | null;
  lastFetchedAt: string | null;
  refreshIntervalHours: number;
  approvedAt: string | null;
  approvedByUserId: string | null;
  articleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryListResponse {
  items: InventoryRow[];
  counts: { tool: number; skill: number };
}

export interface InventoryFilters {
  objectType?: "tool" | "skill";
  fetchStatus?: "pending" | "fetching" | "ok" | "error";
  approvedOnly?: boolean;
}

export interface CreateInventoryInput {
  source?: "github";
  objectType: "tool" | "skill";
  sourceIdentifier: string;
  displayName: string;
  description?: string | null;
  homepageUrl?: string | null;
  refreshIntervalHours?: number;
  articleId?: string | null;
  approveOnCreate?: boolean;
}

export interface PatchInventoryInput {
  displayName?: string;
  description?: string | null;
  homepageUrl?: string | null;
  refreshIntervalHours?: number;
  articleId?: string | null;
}

// ─── Composable ─────────────────────────────────────────────────────────────

export function useInventory(slug: MaybeRef<string>, filters: MaybeRef<InventoryFilters> = {}) {
  const qc = useQueryClient();

  const queryKey = computed(() => {
    const f = unref(filters);
    return [
      "inventory",
      unref(slug),
      f.objectType ?? "all",
      f.fetchStatus ?? "all",
      f.approvedOnly === false ? "with-unapproved" : "approved",
    ] as const;
  });

  const listQuery = useQuery({
    queryKey,
    queryFn: () => {
      const f = unref(filters);
      const params = new URLSearchParams();
      if (f.objectType) params.set("objectType", f.objectType);
      if (f.fetchStatus) params.set("fetchStatus", f.fetchStatus);
      if (f.approvedOnly === false) params.set("approvedOnly", "false");
      const qs = params.toString();
      return apiGet<InventoryListResponse>(
        `/projects/${unref(slug)}/inventory${qs ? `?${qs}` : ""}`,
      );
    },
    refetchInterval: 15_000, // surface cron-driven status changes promptly
  });

  function invalidateAll() {
    return qc.invalidateQueries({ queryKey: ["inventory", unref(slug)] });
  }

  const createMutation = useMutation({
    mutationFn: (input: CreateInventoryInput) =>
      apiPost<InventoryRow>(`/projects/${unref(slug)}/inventory`, input),
    onSuccess: () => invalidateAll(),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchInventoryInput }) =>
      apiPatch<InventoryRow>(`/projects/${unref(slug)}/inventory/${id}`, input),
    onSuccess: () => invalidateAll(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiDelete<{ deleted: boolean }>(`/projects/${unref(slug)}/inventory/${id}`),
    onSuccess: () => invalidateAll(),
  });

  const refreshRowMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ jobId: string }>(`/projects/${unref(slug)}/inventory/${id}/refresh`, {}),
  });

  const refreshAllMutation = useMutation({
    mutationFn: (ids?: string[]) =>
      apiPost<{ jobId: string; mode: string }>(
        `/projects/${unref(slug)}/inventory/refresh`,
        ids ? { ids } : {},
      ),
  });

  return {
    listQuery,
    createMutation,
    patchMutation,
    deleteMutation,
    refreshRowMutation,
    refreshAllMutation,
    invalidateAll,
  };
}
