# Voyage AI Adapter

Thin wrapper around the Voyage AI REST API for text embeddings. Used by
`packages/pipelines` for the existing-coverage check and cluster matching
in Spec 54.5 (Trend Scoring & Topic Synthesis).

## Credentials

Reads `VOYAGE_API_KEY` from `getEnv()` (shared config, `optionalStr`).
If the key is absent, `callVoyageEmbed()` throws `VoyageError` on the first call.
Set via `.env` or DB vault (Spec 32 vault not yet wired for voyage — uses env only).

## Embedding model

`voyage-3` — 1024-dimensional float array.
Matches `vector(1024)` columns on `articles.embedding` and `clusters.embedding`.

## API

```typescript
import { voyage } from "@marketing-auto/adapter-voyage";

// Single text
const emb: number[] = await voyage.embed("GPT-4 im Test", { projectId, operation });

// Batch (up to 128 texts)
const embs: number[][] = await voyage.embedBatch(["text1", "text2"], { projectId, operation });
```

**Always import the `voyage` object, not the named `embed` export.** The object
pattern makes the function replaceable in tests (ESM named bindings are read-only,
object properties are not).

## Cost

~$0.06 / 1 M tokens → `VOYAGE_COST_USD_PER_TOKEN = 0.000_000_06`.
Every call goes through `track()` from `@marketing-auto/cost-tracker` so costs
land in `cost_logs` with `service = 'voyage'`.

## Verify

```typescript
import { verifyVoyage } from "@marketing-auto/adapter-voyage/verify";
const result = await verifyVoyage(apiKey);  // { ok: boolean; message: string }
```

Used by the installer `/api/system/verify/voyage` endpoint (to be wired in a future
installer spec — Spec 32 already handles the pattern; voyage just needs a route entry).

## Hard Rules

- DO NOT call the Voyage REST API directly — always use `voyage.embed()` / `voyage.embedBatch()`
- DO NOT import the named `embed` function in production code — use `voyage.embed` so it's mockable in tests
- DO NOT exceed 128 texts per `embedBatch()` call — Voyage API limit
- Cost is negligible (~€0.0001 per article) but must still go through `track()` for observability
