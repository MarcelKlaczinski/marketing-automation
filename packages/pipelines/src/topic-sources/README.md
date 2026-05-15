# Topic Sources

A TopicSource produces TopicBriefs. See `types.ts` for the interface contract.

## Adding a new source

1. Pick a `source` discriminator value matching the `topic_briefs.source` DB enum.
2. Define a source-specific metadata Zod schema in `@marketing-auto/db` (e.g. `TrendMetadataSchema`).
3. Implement the `TopicSource<Input>` interface in a new subfolder under `topic-sources/`.
4. Export from `topic-sources/index.ts`.
5. Wire it into the caller (a route, worker, or import step) that invokes `emit()` and persists the result.

## Key invariant

Sources MUST NOT persist briefs themselves. The caller owns persistence so that
dual-write transactions (e.g., gap row + brief row in one `db.transaction()`) remain atomic.
