# Signal Sources

Signal sources are pure data fetchers — they return `RawSignal[]` and never write to the DB.
The BullMQ `signal-collector` worker owns all persistence and dedup logic.

## Adding a new source

1. Create `packages/adapters/<name>/` with `package.json`, `src/index.ts`, `src/client.ts`, `src/signal-source.ts`
2. Implement `ExternalSignalSource<Input>` from `@marketing-auto/pipelines/signal-sources`
3. Add the source name to `ExternalSignalSourceValue` in `packages/db/src/schema/content.ts`
4. Extend the CHECK constraint in a new migration SQL
5. Register the adapter in `apps/api/src/workers/signal-collector.ts`'s adapter switch
6. Add the config field to `SignalSourcesSchema` in `packages/db/src/schema/project-config.ts`

## Interface contract

```typescript
interface ExternalSignalSource<Input> {
  readonly source: ExternalSignalSourceValue;   // stable enum value
  readonly inputSchema: z.ZodType<Input>;        // Zod schema for input validation
  fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]>;
}
```

The worker calls `inputSchema.parse(rawInput)` before `fetch()`.
