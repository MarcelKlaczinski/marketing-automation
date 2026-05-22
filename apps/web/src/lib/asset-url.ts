// Resolves a backend-relative asset path (e.g. "/renders/…", "/uploads/…") to an
// absolute URL pointed at the API origin. Needed in dev where the Vue dev server
// and the API live on different ports — an <img src="/renders/x.png"> would
// otherwise hit the Vue server's SPA fallback and load HTML.
//
// In prod VITE_API_BASE_URL is typically same-origin ("/api"), so the extracted
// origin is empty and the function returns the path unchanged.

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000/api";

function deriveApiOrigin(base: string): string {
  // base looks like "http://localhost:3000/api" → "http://localhost:3000"
  // or "/api" → "" (same-origin)
  try {
    const u = new URL(base, globalThis.location?.origin ?? "http://localhost");
    if (u.origin === globalThis.location?.origin) return "";
    return u.origin;
  } catch {
    return "";
  }
}

const API_ORIGIN = deriveApiOrigin(API_BASE);

export function assetUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith("/")) return path;
  return `${API_ORIGIN}${path}`;
}
