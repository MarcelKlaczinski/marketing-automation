// Spec 65.0 Day 5 — Templates list composable for the Settings page.
//
// Calls `GET /api/projects/:slug/templates` and exposes `items`/`loading`/
// `error`. The slug is taken from the parent component (passed as MaybeRef
// per the Options-API ergonomics convention in apps/web/CLAUDE.md).

import { ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { apiGet } from "src/lib/api";

export interface TemplateLastPreview {
  previewUrls: string[];
  renderedAt: string;
}

export interface TemplateListItem {
  id: string;
  projectId: string | null;
  templateKey: string;
  baseTemplateKey: string;
  variant: string | null;
  filePath: string;
  fileHash: string;
  isActive: boolean;
  formatTypes: string[];
  outputFormat: string | null;
  compatibleChannels: string[];
  generationClass: string | null;
  displayName: string | null;
  description: string | null;
  defaultSlideCount: number | null;
  estimatedCostUsd: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  lastSeenAt: string;
  previewImageUrl: string | null;
  scope: "global" | "project";
  /**
   * Spec 65.0 Day 5 — filesystem-probed: when a render exists at
   * `<projectSlug>/<templateKey>/slide-NN.png`, the URLs + dir mtime
   * are returned so the card can show a thumbnail and the modal can
   * pre-populate without re-rendering.
   */
  lastPreview: TemplateLastPreview | null;
}

interface TemplatesListResponse {
  items: TemplateListItem[];
}

export interface UseTemplatesListInput {
  /**
   * `MaybeRefOrGetter` so Options-API callers can pass a getter that reads
   * `this.projectSlug` directly (a plain `MaybeRef` only accepts values or
   * Refs, neither of which is convenient when the source lives in `data()`
   * or `computed:{}` on a component).
   */
  slug: MaybeRefOrGetter<string>;
  /** Optional format-type filter — re-fetches when this changes. */
  formatType: MaybeRefOrGetter<string | null>;
}

export function useTemplatesList(input: UseTemplatesListInput) {
  const items = ref<TemplateListItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function refetch(): Promise<void> {
    const slug = toValue(input.slug);
    if (!slug) {
      items.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const ft = toValue(input.formatType);
      const qs = ft ? `?formatType=${encodeURIComponent(ft)}` : "";
      const data = await apiGet<TemplatesListResponse>(
        `/projects/${slug}/templates${qs}`,
      );
      items.value = data.items;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "load_failed";
      items.value = [];
    } finally {
      loading.value = false;
    }
  }

  // Re-fetch when slug or formatType changes. `immediate: true` runs once on
  // mount so the consumer doesn't need to remember to call `refetch()`.
  watch(
    () => [toValue(input.slug), toValue(input.formatType)],
    () => {
      void refetch();
    },
    { immediate: true },
  );

  return { items, loading, error, refetch };
}
