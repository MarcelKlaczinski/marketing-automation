// Spec 65.2 — Mutations for tool brand-asset rows.
//
// Wraps PATCH (edit colors / canonical name), POST /reresolve, and
// POST /upload-logo (multipart). All three call sites use raw fetch so the
// 404 / 400 response body's structured fields survive — apiPatch / apiPost
// throw plain Error and drop sibling fields. Same posture as
// `useTemplateActions` (Spec 65.0 Day 6) and `usePauseActions` (Spec 62.6).

import { apiGet } from "src/lib/api";

export interface ToolBrandAssetRow {
  toolId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tertiaryColor: string | null;
  brandNameCanonical: string | null;
  source: string;
  needsReview: boolean;
  fetchedAt: string;
  updatedAt: string;
}

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

function getApiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return base ?? "/api";
}

async function safeFetch(
  url: string,
  init: RequestInit,
): Promise<Result<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include", ...init });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network_error",
      status: 0,
    };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const errMsg =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `http_${response.status}`;
    return { ok: false, error: errMsg, status: response.status };
  }

  const data =
    body && typeof body === "object" && "data" in body
      ? (body as { data: unknown }).data
      : body;
  return { ok: true, data };
}

export interface PatchToolBrandAssetInput {
  slug: string;
  toolId: string;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
  brandNameCanonical?: string | null;
  needsReview?: boolean;
}

export async function patchToolBrandAsset(
  input: PatchToolBrandAssetInput,
): Promise<Result<ToolBrandAssetRow>> {
  const { slug, toolId, ...body } = input;
  return (await safeFetch(
    `${getApiBase()}/projects/${slug}/tool-brand-assets/${toolId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )) as Result<ToolBrandAssetRow>;
}

export async function reresolveToolBrandAsset(input: {
  slug: string;
  toolId: string;
}): Promise<Result<ToolBrandAssetRow>> {
  return (await safeFetch(
    `${getApiBase()}/projects/${input.slug}/tool-brand-assets/${input.toolId}/reresolve`,
    { method: "POST" },
  )) as Result<ToolBrandAssetRow>;
}

export async function uploadCustomLogo(input: {
  slug: string;
  toolId: string;
  file: File;
}): Promise<Result<ToolBrandAssetRow>> {
  const fd = new FormData();
  fd.append("file", input.file);
  return (await safeFetch(
    `${getApiBase()}/projects/${input.slug}/tool-brand-assets/${input.toolId}/upload-logo`,
    { method: "POST", body: fd },
  )) as Result<ToolBrandAssetRow>;
}

export interface UsageInfo {
  sharedSlug: string;
  otherProjectCount: number;
  siblingRowCount: number;
}

export async function getToolBrandAssetUsage(input: {
  slug: string;
  toolId: string;
}): Promise<UsageInfo> {
  return await apiGet<UsageInfo>(
    `/projects/${input.slug}/tool-brand-assets/${input.toolId}/usage`,
  );
}
