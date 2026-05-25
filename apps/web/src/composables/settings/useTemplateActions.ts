// Spec 65.0 Day 6 — soft-disable / enable mutation for a single template.
//
// Wraps `PATCH /api/projects/:slug/templates/:templateKey` with `{ isActive }`.
// Uses raw fetch (not `apiPatch`) so the structured 404-body error stays
// available to the call site if the backend reports `template_not_found`.

import { ref } from "vue";

const BASE = (import.meta.env.VITE_API_BASE_URL as string)
  ?? "http://localhost:3050/api";

export interface SetActiveSuccess {
  templateKey: string;
  isActive: boolean;
  scope: "project" | "global";
}

export interface SetActiveFailure {
  status: number;
  error: string;
}

export function useTemplateActions() {
  const pending = ref(false);
  const lastError = ref<SetActiveFailure | null>(null);

  async function setActive(input: {
    slug: string;
    templateKey: string;
    isActive: boolean;
  }): Promise<SetActiveSuccess | SetActiveFailure> {
    pending.value = true;
    lastError.value = null;
    try {
      const url = `${BASE}/projects/${input.slug}/templates/${input.templateKey}`;
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: input.isActive }),
      });
      const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && raw.ok === true && raw.data) {
        return raw.data as SetActiveSuccess;
      }
      const failure: SetActiveFailure = {
        status: res.status,
        error: typeof raw.error === "string" ? raw.error : "unknown",
      };
      lastError.value = failure;
      return failure;
    } catch (err) {
      const failure: SetActiveFailure = {
        status: 0,
        error: err instanceof Error ? err.message : "network_error",
      };
      lastError.value = failure;
      return failure;
    } finally {
      pending.value = false;
    }
  }

  return { pending, lastError, setActive };
}
