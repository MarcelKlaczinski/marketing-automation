// Spec 63.5: offline embedding providers for selector tests.
//
// Returning `null` from every getForItem call makes the diversity picker
// degrade to FIFO (no malus computed) — same observable behaviour as
// diversity being disabled. Keeps tests deterministic and offline.

import type {
  ArticleLike,
  BriefEmbeddingProvider,
  EmbeddingProvider,
  EmbeddingProviderOptions,
} from "../../../src/planning/lib/diversity-embedding.ts";
import type { TopicBrief } from "@marketing-auto/db";
import type { SignalTopNEntry } from "@marketing-auto/shared";

export function createNullBriefProvider(_: EmbeddingProviderOptions): BriefEmbeddingProvider {
  const noop = async (_x: TopicBrief) => null;
  return { getForItem: noop, getForBrief: noop };
}

export function createNullSignalProvider(
  _: EmbeddingProviderOptions,
): EmbeddingProvider<SignalTopNEntry> {
  return { async getForItem(_x) { return null; } };
}

export function createNullArticleProvider(
  _: EmbeddingProviderOptions,
): EmbeddingProvider<ArticleLike> {
  return { async getForItem(_x) { return null; } };
}
