// Spec 63.5: per-plan-run embedding providers for diversity scoring.
//
// The provider is generic over the item type — briefs, signals, and articles
// all flow through the same iterative picker. Each item-source-specific
// factory below resolves the right embedding text + the right cluster fallback
// (when available) and caches by stable ID for the lifetime of the run.
//
// Resolution order (one Voyage call per cache-miss):
//   1. Embed the item's text via Voyage on-the-fly (Option C).
//   2. Fall back to clusters.embedding via the item's cluster id (Option B).
//   3. Return null — item contributes no diversity signal but still gets
//      considered by the picker (skip-diversity-for-this-item semantics).

import { voyage } from "@marketing-auto/adapter-voyage";
import { COST_OPS } from "@marketing-auto/core/cost";
import { clusters, db, eq, type TopicBrief } from "@marketing-auto/db";
import { createLogger, type SignalTopNEntry } from "@marketing-auto/shared";

const log = createLogger("pipelines:planner:diversity-embedding");

/** Generic provider — call once per item, the implementation caches by id. */
export interface EmbeddingProvider<T> {
  getForItem(item: T): Promise<number[] | null>;
}

/**
 * Back-compat alias: `EmbeddingProvider<TopicBrief>` with the older
 * `getForBrief()` method name. Used by SelectFloorItemsStep and existing
 * callers; new callers should adopt the generic form.
 */
export interface BriefEmbeddingProvider extends EmbeddingProvider<TopicBrief> {
  getForBrief(brief: TopicBrief): Promise<number[] | null>;
}

export interface EmbeddingProviderOptions {
  projectId: string;
  pipelineRunId?: string;
}

/**
 * Build an embedding-text string from a brief. Returns `null` when neither
 * `primaryKeyword` nor `topicTitle` is usable — the caller then falls back to
 * the cluster embedding (or skips diversity for the brief).
 *
 * Combined text outperforms either field alone for short briefs: "RAG" alone
 * is too sparse; "RAG-Pipelines mit Claude" carries more semantic weight.
 */
export function buildEmbeddingText(brief: TopicBrief): string | null {
  const primary = (brief.primaryKeyword ?? "").trim();
  const title = (brief.topicTitle ?? "").trim();
  if (primary && title) return `${primary} ${title}`;
  if (primary) return primary;
  if (title) return title;
  return null;
}

/**
 * Pre-load a single cluster's embedding by id. Returns null on missing row,
 * missing embedding, or DB error (errors are logged and swallowed so the
 * picker can still proceed — the item just won't contribute a diversity
 * signal in this run).
 */
async function loadClusterEmbedding(clusterId: string): Promise<number[] | null> {
  try {
    const rows = await db
      .select({ embedding: clusters.embedding })
      .from(clusters)
      .where(eq(clusters.id, clusterId))
      .limit(1);
    const row = rows[0];
    if (!row || !row.embedding) return null;
    return row.embedding;
  } catch (err) {
    log.warn({ err, clusterId }, "loadClusterEmbedding failed; falling through");
    return null;
  }
}

/**
 * Shared embed-with-Voyage-and-cache helper used by all source-specific
 * providers below.
 */
async function embedWithCache(
  cache: Map<string, number[] | null>,
  key: string,
  text: string | null,
  fallbackClusterId: string | null,
  opts: EmbeddingProviderOptions,
): Promise<number[] | null> {
  if (cache.has(key)) return cache.get(key) ?? null;

  if (text) {
    try {
      const embedding = await voyage.embed(text, {
        projectId: opts.projectId,
        operation: COST_OPS.VOYAGE_EMBED_TEXT,
        ...(opts.pipelineRunId !== undefined && { pipelineRunId: opts.pipelineRunId }),
      });
      cache.set(key, embedding);
      return embedding;
    } catch (err) {
      log.warn(
        { err, key, textLength: text.length },
        "voyage.embed failed; trying cluster fallback",
      );
      // Fall through to cluster fallback.
    }
  }

  if (fallbackClusterId) {
    const fallback = await loadClusterEmbedding(fallbackClusterId);
    cache.set(key, fallback);
    return fallback;
  }

  cache.set(key, null);
  return null;
}

/**
 * Brief-based provider. Embeds `${primaryKeyword} ${topicTitle}` per brief
 * with `clusters.embedding` fallback via `brief.clusterId`.
 */
export function createPlanRunEmbeddingProvider(
  opts: EmbeddingProviderOptions,
): BriefEmbeddingProvider {
  const cache = new Map<string, number[] | null>();
  const getForItem = (brief: TopicBrief) =>
    embedWithCache(cache, brief.id, buildEmbeddingText(brief), brief.clusterId ?? null, opts);
  return {
    getForItem,
    // Back-compat alias for callers that still use the named verb.
    getForBrief: getForItem,
  };
}

/**
 * Signal-based provider. Embeds `signal.title`; no cluster fallback (signals
 * carry no cluster anchor — vendor_rss is the closest, and the planner already
 * lacks a structured route from signal → cluster).
 */
export function createSignalEmbeddingProvider(
  opts: EmbeddingProviderOptions,
): EmbeddingProvider<SignalTopNEntry> {
  const cache = new Map<string, number[] | null>();
  return {
    getForItem(signal) {
      const text = signal.title?.trim() || null;
      return embedWithCache(cache, signal.signalId, text, null, opts);
    },
  };
}

/**
 * Article-based provider for the Social-post selector's refresh + pool
 * sub-cases. Takes a minimal `{ id, embeddingText, clusterId }` shape — the
 * step pre-loads article rows and passes them through.
 */
export interface ArticleLike {
  id: string;
  embeddingText: string | null;
  clusterId: string | null;
}

export function createArticleEmbeddingProvider(
  opts: EmbeddingProviderOptions,
): EmbeddingProvider<ArticleLike> {
  const cache = new Map<string, number[] | null>();
  return {
    getForItem(article) {
      return embedWithCache(cache, article.id, article.embeddingText, article.clusterId, opts);
    },
  };
}
