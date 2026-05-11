import type { MessagesResult } from "./types.ts";

export type CacheMode = "off" | "replay" | "record" | "auto";

/** What gets persisted to disk per cache hit. */
export interface CachedResponse {
  /** Cache schema version — bump if fixture format changes */
  schemaVersion: 1;
  /** ISO timestamp when this fixture was recorded */
  recordedAt: string;
  /** The model + prompt-hash this was generated for, for human inspection */
  metadata: {
    model: string;
    systemPrefixLen: number;
    systemSuffixLen: number;
    userMessageLen: number;
    jsonMode: boolean;
    operation: string;
    /** First 80 chars of userMessage for human grepping */
    userMessagePreview: string;
  };
  /** Full response (cacheStats are zeroed for replay — reflects fixture cache, not Anthropic's) */
  response: MessagesResult;
}
