/**
 * Spec multi-domain-evolution Domain-Registry follow-up — Phase 4.
 *
 * Tests for:
 *   - GET  /api/projects/:slug/brief-options
 *     Returns dynamic collection + intent taxonomy from the project's
 *     DomainSpec when the registry resolves; falls back to the hardcoded
 *     Toolwiki shape when the registry returns null.
 *   - POST /api/projects/:slug/briefs
 *     Registry-gate rejects collectionHint values not in the resolved
 *     DomainSpec's allow-list. `"cluster"` (planner pseudo-collection)
 *     always passes the gate.
 *
 * Pattern mirrors apps/api/test/routes/briefs-create.test.ts.
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  projects,
  sessions,
  topicBriefs,
  users,
} from "@marketing-auto/db";
import {
  resetDomainRegistryForTesting,
  setDomainRegistryForTesting,
} from "@marketing-auto/pipelines/domain-registry";
import { toolwikiDomain } from "@marketing-auto/content-schema/domains/toolwiki";
import {
  createDbBackedRegistry,
  type DomainSpec,
  type ProjectLookup,
} from "@marketing-auto/content-schema/registry";
import { z } from "zod";
import { hashToken } from "../../src/lib/tokens.ts";
import app from "../../src/server.ts";

let projectId: string;
let slug: string;
let sessionToken: string;
let userId: string;
const createdBriefIds: string[] = [];

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: `brief-options-${Date.now()}@test.local`,
      name: "Brief Options Test",
      role: "owner",
    })
    .returning({ id: users.id });
  userId = user!.id;

  sessionToken = `tok-${crypto.randomUUID()}`;
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(sessionToken),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  slug = `brief-options-${Date.now()}`;
  const [proj] = await db
    .insert(projects)
    .values({
      slug,
      name: "Brief Options Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;
});

afterAll(async () => {
  for (const id of createdBriefIds) {
    await db.delete(topicBriefs).where(eq(topicBriefs.id, id));
  }
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
});

afterEach(() => {
  resetDomainRegistryForTesting();
});

function authed(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: `ma_session=${sessionToken}`,
      ...(init.headers ?? {}),
    },
  });
}

function injectRegistryForTestProject(domains: ReadonlyArray<DomainSpec>) {
  const lookup: ProjectLookup = {
    async resolve(id) {
      if (id === projectId) {
        return {
          niche: domains[0]?.niche ?? "ai-tool-wiki",
          domain: "test.example.com",
          locales: ["de"] as const,
        };
      }
      return null;
    },
  };
  setDomainRegistryForTesting(createDbBackedRegistry(domains, lookup));
}

const briefOptionsResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    source: z.enum(["registry", "fallback"]),
    niche: z.string().nullable(),
    collectionHints: z.array(z.string()),
    intentTypes: z.array(z.string()),
    // Spec multi-domain-evolution Phase-C — collection→intent map. Always
    // present; empty object signals "no per-tenant default".
    collectionToIntentMap: z.record(z.string(), z.string()),
  }),
});

describe("GET /api/projects/:slug/brief-options", () => {
  it("returns source='registry' + DomainSpec taxonomy when registry resolves", async () => {
    injectRegistryForTestProject([toolwikiDomain]);
    const res = await app.fetch(authed(`/api/projects/${slug}/brief-options`));
    expect(res.status).toBe(200);
    const parsed = briefOptionsResponseSchema.parse(await res.json());
    expect(parsed.data.source).toBe("registry");
    expect(parsed.data.niche).toBe("ai-tool-wiki");
    // toolwikiDomain has blog/comparison/ki-wissen/tools/usecases — and the
    // endpoint appends "cluster" (planner pseudo-collection).
    expect(parsed.data.collectionHints).toEqual(
      expect.arrayContaining(["blog", "comparison", "ki-wissen", "tools", "usecases", "cluster"]),
    );
    // Intents come from TOOLWIKI_BLOG_INTENT_TYPES.
    expect(parsed.data.intentTypes.length).toBeGreaterThan(0);
  });

  it("returns source='fallback' when registry returns null", async () => {
    // No registry set → singleton lazy-initializes the production lookup,
    // which queries `projects.targetNiche` for our test project (which is
    // NULL) and returns null → endpoint falls through to hardcoded shape.
    const res = await app.fetch(authed(`/api/projects/${slug}/brief-options`));
    expect(res.status).toBe(200);
    const parsed = briefOptionsResponseSchema.parse(await res.json());
    expect(parsed.data.source).toBe("fallback");
    expect(parsed.data.niche).toBeNull();
    // Hardcoded fallback list from briefs.ts.
    expect(parsed.data.collectionHints).toEqual(["blog", "comparison", "ki-wissen", "cluster"]);
  });

  it("returns 404 for unknown slug", async () => {
    const res = await app.fetch(authed(`/api/projects/does-not-exist/brief-options`));
    expect(res.status).toBe(404);
  });

  // Spec multi-domain-evolution Phase-C — collectionToIntentMap surface.
  it("surfaces Toolwiki's registered collectionToIntentMap when source='registry'", async () => {
    injectRegistryForTestProject([toolwikiDomain]);
    const res = await app.fetch(authed(`/api/projects/${slug}/brief-options`));
    const parsed = briefOptionsResponseSchema.parse(await res.json());
    expect(parsed.data.source).toBe("registry");
    // Matches toolwikiDomain.collectionToIntentMap byte-for-byte (the
    // legacy 4-value hardcoded switch — preserved zero-regression).
    expect(parsed.data.collectionToIntentMap).toEqual({
      comparison: "comparison",
      "ki-wissen": "knowledge",
      blog: "use_case",
      cluster: "use_case",
    });
  });

  it("surfaces the hardcoded fallback collectionToIntentMap when source='fallback'", async () => {
    // No registry inject → endpoint hits null path and returns the
    // hardcoded 4-value mirror map. Validates that the frontend always
    // has SOMETHING to drive the auto-derive UX even when DomainSpec
    // is missing.
    const res = await app.fetch(authed(`/api/projects/${slug}/brief-options`));
    const parsed = briefOptionsResponseSchema.parse(await res.json());
    expect(parsed.data.source).toBe("fallback");
    expect(parsed.data.collectionToIntentMap).toEqual({
      comparison: "comparison",
      "ki-wissen": "knowledge",
      blog: "use_case",
      cluster: "use_case",
    });
  });
});

describe("POST /api/projects/:slug/briefs — registry gate", () => {
  // Synthetic BK-shaped DomainSpec — only registers a single "blog" collection.
  // Toolwiki-shaped values ("comparison"/"ki-wissen") MUST be rejected for
  // this niche, while "cluster" (planner pseudo) MUST pass.
  const bkDomain: DomainSpec = {
    niche: "solar-energy-test",
    domain: "balkon-kraft-werk.de",
    locales: ["de"] as const,
    intentTaxonomy: ["knowledge", "use_case"] as const,
    collections: [{ name: "blog", extrasSchema: z.object({}) }],
  };

  it("422 when collectionHint not in registered DomainSpec allow-list", async () => {
    injectRegistryForTestProject([bkDomain]);
    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs`, {
        method: "POST",
        body: JSON.stringify({
          topicTitle: "Was ist photovoltaische Direkteinspeisung?",
          primaryKeyword: "Direkteinspeisung",
          collectionHint: "comparison", // not registered for bkDomain
          locale: "de",
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(body.error).toBe("collection_not_in_registry");
    expect(body.niche).toBe("solar-energy-test");
    expect(body.allowedCollections).toEqual(expect.arrayContaining(["blog", "cluster"]));
  });

  it("passes when collectionHint='cluster' regardless of registered collections", async () => {
    injectRegistryForTestProject([bkDomain]);
    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs`, {
        method: "POST",
        body: JSON.stringify({
          topicTitle: "Balkonkraftwerk-Cluster: Komponenten-Übersicht",
          primaryKeyword: "Balkonkraftwerk Cluster",
          collectionHint: "cluster",
          locale: "de",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; data: { brief: { id: string } } };
    expect(body.ok).toBe(true);
    createdBriefIds.push(body.data.brief.id);
  });

  it("passes when registry returns null (legacy project, no gate)", async () => {
    // Default singleton — no inject; production lookup returns null for our
    // test project (no targetNiche), so the gate is skipped entirely.
    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs`, {
        method: "POST",
        body: JSON.stringify({
          topicTitle: "Legacy project — gate skipped",
          primaryKeyword: "legacy keyword",
          collectionHint: "comparison",
          locale: "de",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ok: boolean; data: { brief: { id: string } } };
    expect(body.ok).toBe(true);
    createdBriefIds.push(body.data.brief.id);
  });

  it("422 when explicit intentType not in DomainSpec intentTaxonomy", async () => {
    injectRegistryForTestProject([bkDomain]);
    const res = await app.fetch(
      authed(`/api/projects/${slug}/briefs`, {
        method: "POST",
        body: JSON.stringify({
          topicTitle: "Topic with rejected intent type for BK domain",
          primaryKeyword: "intent gate test",
          collectionHint: "blog",
          intentType: "comparison", // not in bkDomain.intentTaxonomy
          locale: "de",
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("intent_not_in_registry");
    expect(body.allowedIntentTypes).toEqual(expect.arrayContaining(["knowledge", "use_case"]));
  });
});
