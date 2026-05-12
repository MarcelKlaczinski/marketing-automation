# Anthropic Response Fixtures

These JSON files are recorded responses from `anthropic.messages()` calls.
They replay live API outputs in dev/CI without incurring API costs.

See `packages/adapters/anthropic/CLAUDE.md` → "Dev-Mode Response Cache" for
workflow, modes, and CLI reference.

## Filename Format

`<16-hex-chars>.json` — first 16 chars of sha256(canonicalized MessagesInput).

## Don't Hand-Edit

Fixtures are written by the adapter. To re-record, use `forceRefresh: true`
in `MessagesInput` or `ANTHROPIC_CACHE_MODE=record`.

## Sensitive Content

Fixtures contain prompt+response pairs. If a prompt includes user PII or
confidential data, do NOT commit. Inspect before staging:

```bash
bun --filter @marketing-auto/adapter-anthropic fixtures show <key>
```
