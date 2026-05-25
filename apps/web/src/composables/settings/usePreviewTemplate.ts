// Spec 65.0 Day 5 — Preview-template mutation for the Settings page.
//
// Posts to `POST /api/projects/:slug/templates/:templateKey/preview` and
// exposes `submit()`, `pending`, `lastResult`, `lastError`. Uses raw fetch
// instead of `apiPost` because the 400-render_failed response includes a
// `message` field that `apiPost`'s plain-Error mapping would drop — same
// pattern as `usePauseActions.ts` for the 409+impact case.

import { ref } from "vue";

const BASE = (import.meta.env.VITE_API_BASE_URL as string)
  ?? "http://localhost:3050/api";

export interface PreviewSuccessData {
  sessionId: string;
  previewUrl: string;
  previewUrls: string[];
  slideCount: number;
  renderDurationMs: number;
  renderedAt: string;
}

export interface PreviewFailure {
  status: number;
  error: string;
  message?: string;
}

export interface PreviewSubmitInput {
  slug: string;
  templateKey: string;
  sampleData: Record<string, unknown>;
  theme?: "dark" | "light";
  locale?: "de" | "en";
}

export function usePreviewTemplate() {
  const pending = ref(false);
  const lastResult = ref<PreviewSuccessData | null>(null);
  const lastError = ref<PreviewFailure | null>(null);

  async function submit(input: PreviewSubmitInput): Promise<PreviewSuccessData | PreviewFailure> {
    pending.value = true;
    lastResult.value = null;
    lastError.value = null;
    try {
      const url = `${BASE}/projects/${input.slug}/templates/${input.templateKey}/preview`;
      const body: Record<string, unknown> = {
        sampleData: input.sampleData,
      };
      if (input.theme !== undefined) body.theme = input.theme;
      if (input.locale !== undefined) body.locale = input.locale;

      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && raw.ok === true && raw.data) {
        const data = raw.data as PreviewSuccessData;
        lastResult.value = data;
        return data;
      }

      const failure: PreviewFailure = {
        status: res.status,
        error: typeof raw.error === "string" ? raw.error : "unknown",
        ...(typeof raw.message === "string" && { message: raw.message }),
      };
      lastError.value = failure;
      return failure;
    } catch (err) {
      const failure: PreviewFailure = {
        status: 0,
        error: "network_error",
        message: err instanceof Error ? err.message : String(err),
      };
      lastError.value = failure;
      return failure;
    } finally {
      pending.value = false;
    }
  }

  function reset(): void {
    lastResult.value = null;
    lastError.value = null;
  }

  return { pending, lastResult, lastError, submit, reset };
}
