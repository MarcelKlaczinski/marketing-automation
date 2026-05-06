import { Hono } from 'hono';

export const systemRoutes = new Hono();

/**
 * MINIMAL STUB. Spec 32 replaces this with real adapter status checks.
 * Returns "all unknown" so the frontend doesn't show false-confidence indicators.
 * Not behind requireAuth — needed before login (installer wizard).
 */
systemRoutes.get('/status', (c) => {
  const unknown = { configured: false, verified: null, lastVerifiedAt: null };
  return c.json({
    loading: false,
    adapters: {
      anthropic: unknown,
      replicate: unknown,
      r2: unknown,
      dataforseo: unknown,
      smtp: unknown,
      githubApp: unknown,
    },
    redis: unknown,
    postgres: unknown,
  });
});
