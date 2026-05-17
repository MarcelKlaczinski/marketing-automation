/**
 * Typed fetch wrapper for the marketing-auto API.
 * All calls include credentials (httpOnly session cookie).
 * Responses are assumed to follow the { ok: boolean; data: T } envelope.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? "http://localhost:3000/api";

/** Typed GET helper. Throws on non-2xx. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ok: boolean; data: T };
  return body.data;
}

/** Typed PATCH helper. Throws on non-2xx. */
export async function apiPatch<T>(path: string, payload?: unknown): Promise<T> {
  const init: RequestInit = {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  };
  if (payload !== undefined) {
    init.body = JSON.stringify(payload);
  }
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ok: boolean; data: T };
  return body.data;
}

/** Typed DELETE helper. Throws on non-2xx. */
export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ok: boolean; data: T };
  return body.data;
}

/** Typed POST helper. Throws on non-2xx. */
export async function apiPost<T>(path: string, payload?: unknown): Promise<T> {
  // Build init conditionally — exactOptionalPropertyTypes forbids body: string | undefined
  const init: RequestInit = {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  };
  if (payload !== undefined) {
    init.body = JSON.stringify(payload);
  }

  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { ok: boolean; data: T };
  return body.data;
}
