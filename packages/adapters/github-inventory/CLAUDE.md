# `@marketing-auto/adapter-github-inventory`

GitHub-API typed adapter for the **Inventory** subsystem (Spec 64.20). Fetches
stable structured metadata (stars, releases, topics, language, license) for
tool + skill rows in `content_source_inventory`.

## What it does

- `fetchFullRepoMetadata(fullName, creds)` — composes 2 GitHub-API calls
  (repo metadata + latest release) into the `GithubInventoryMetadata` shape
  defined in `@marketing-auto/db`.
- `detectSkill(fullName, subdirOrNull, creds)` — walks for `SKILL.md`, parses
  the YAML frontmatter, returns the populated `skillFrontmatter` subset.
- `verifyGitHub(creds)` — live-verify CLI (`bun --filter ... verify`).
- Low-level `fetchRepoMetadata` / `fetchLatestRelease` / `fetchRateLimit`
  exported for tests + ad-hoc consumers.

## Differences from `@marketing-auto/adapter-github-trending`

| Concern | `github-trending` | `github-inventory` |
|---|---|---|
| Purpose | Signal-collector (one-shot search for trending repos) | Inventory refresh (per-row stable metadata) |
| Endpoints | `/search/repositories` | `/repos/{owner}/{repo}`, `/repos/{owner}/{repo}/releases/latest`, `/repos/{owner}/{repo}/contents/{path}`, `/rate_limit` |
| Retry | None | 5xx + network errors, 3 attempts, backoff 500/1000/2000ms |
| Returns | `GitHubSearchResponse` | `GithubInventoryMetadata` (the typed-bucket type from `@marketing-auto/db`) |
| Cost | Free; rate-limit budget proxy via response headers | Same — no cost-tracker write (Memory: GitHub-API free APIs don't log to `cost_logs`) |

## Credential pattern

Single shared vault entry `service='github'` keyed in `globalCredentials` (Spec
59.1b precedent). Workers read via `readAdapterCreds('github')` and pass the
PAT into adapter functions as the `credentials.personalAccessToken` field.

**Do NOT add a new credential-type** for inventory — share the vault key with
the signal-collector. Per root CLAUDE.md rule.

## Error classes

`GitHubAuthError | GitHubRateLimitError | GitHubNotFoundError` — discriminated
via `githubErrorKind` literal on each instance. Consumers can branch on this
field without `instanceof` chains.

## Rate-limit handling

PAT-authenticated calls have a 5000/hr budget. The client parses
`x-ratelimit-remaining` / `x-ratelimit-reset` from response headers. Beyond
that, rate-limit pressure is the worker's concern (not the adapter's): the
worker should call `fetchRateLimit` periodically and pause when remaining < 100.

## Skill detection

`source_identifier="owner/repo:subdir"` (colon-separator) → fetch
`contents/{subdir}/SKILL.md`. Standalone skill repos use bare `owner/repo` →
fetch `contents/SKILL.md`. Skills with no SKILL.md fall through to the
generic repo metadata path (skill row still gets stars + license but
`skillFrontmatter` stays undefined).

The YAML parser in `skill-detector.ts` is intentionally minimal — handles only
`name:`, `description:`, `category:`, `version:` keys. No multi-line, no
nested objects, no anchors. SKILL.md is a thin standard; that's all we need.

## Testing

`bun --filter @marketing-auto/adapter-github-inventory test` runs offline-only
unit tests (mocked `fetch`). Live verification via
`bun --filter @marketing-auto/adapter-github-inventory verify` (needs
`GITHUB_PAT` env or vault credential).
