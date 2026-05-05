# Core Package

Domain logic that's not specific to API/worker/UI layers.

## Modules
- `credentials/`     Encrypted vault for tenant API credentials (Spec 02)
- `cost-tracker/`    Cost logging + hard limits (Spec 03)
- (more added over time)

## Conventions
- All public APIs return `Result<T, E>` rather than throwing (use `@marketing-auto/shared/result`)
- All side-effecting functions are testable in isolation (no hidden globals)
- Sensitive data NEVER appears in logs, even at debug level

## Tests
- Run with `bun --filter @marketing-auto/core test`. The script `cd`s to repo root before invoking `bun test` so `.env` resolves correctly. Don't run `bun run test` from inside the package — same recursion gotcha as `packages/db`.

## Common Mistakes to Avoid
- DO NOT log credential payloads, even fragments
- DO NOT return decrypted credentials from public APIs/UIs — only used at moment of external call
- DO NOT pass credentials through HTTP responses except through dedicated, audited endpoints
