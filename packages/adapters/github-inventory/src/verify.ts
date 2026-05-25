/**
 * Spec 64.20: live-verify CLI for the inventory adapter.
 *
 * Run: `bun --filter @marketing-auto/adapter-github-inventory verify`
 *
 * Reads PAT from `GITHUB_PAT` env (live-verify only — production reads from
 * vault via `readAdapterCreds('github')`). Performs:
 *   1. `GET /rate_limit` — confirms PAT scope works and prints budget.
 *   2. `fetchFullRepoMetadata("anthropics/claude-code")` — smoke fetch.
 */
import {
  fetchFullRepoMetadata,
  fetchRateLimit,
  GitHubAuthError,
  GitHubRateLimitError,
} from "./index.ts";
import type { GitHubCredentials } from "./types.ts";

export interface VerifyGitHubInventoryResult {
  ok: boolean;
  message: string;
}

export async function verifyGitHubInventory(
  creds: GitHubCredentials,
): Promise<VerifyGitHubInventoryResult> {
  try {
    const rate = await fetchRateLimit(creds);
    if (rate.remaining < 5) {
      return {
        ok: false,
        message: `Rate-limit too low to verify: ${rate.remaining}/${rate.limit}, resets ${rate.resetAt.toISOString()}`,
      };
    }
    const repo = await fetchFullRepoMetadata("anthropics/claude-code", creds);
    return {
      ok: true,
      message: `OK — rate-limit ${rate.remaining}/${rate.limit}, sample fetch: anthropics/claude-code ${repo.metadata.starsCount}⭐ (default branch: ${repo.metadata.defaultBranch})`,
    };
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return { ok: false, message: `Auth failed: ${err.message}` };
    }
    if (err instanceof GitHubRateLimitError) {
      return {
        ok: false,
        message: `Rate-limit hit: ${err.message}${err.resetAt ? ` (resets ${err.resetAt.toISOString()})` : ""}`,
      };
    }
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// Run as CLI when invoked directly (`bun run verify`).
// process.env is intentional here: this is a CLI bootstrap path, not production.
// Production reads the PAT from the vault via `readAdapterCreds('github')` in the
// cron worker (Spec 64.20 §5.1). getEnv() doesn't include GITHUB_PAT because
// the vault is the source of truth.
if (import.meta.main) {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    // biome-ignore lint/suspicious/noConsoleLog: CLI output
    console.error("GITHUB_PAT env var missing — set it in .env or shell");
    process.exit(1);
  }
  const result = await verifyGitHubInventory({ personalAccessToken: pat });
  // biome-ignore lint/suspicious/noConsoleLog: CLI output
  console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
  process.exit(result.ok ? 0 : 1);
}
