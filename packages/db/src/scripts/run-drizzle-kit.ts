#!/usr/bin/env bun
// Wrapper that runs a drizzle-kit subcommand with env vars propagated to the
// child process. `drizzle-kit check` rejects `--env-file` as an unknown flag
// (the other subcommands silently swallow it, but that's brittle). This
// wrapper is the future-proof entry point: load env via Bun's `--env-file`
// into this process, then spawn drizzle-kit with `env: process.env` so the
// drizzle.config.ts `getEnv()` call sees DATABASE_URL / REDIS_URL / etc.
//
// Usage: bun --env-file ../../.env src/scripts/run-drizzle-kit.ts <subcommand> [args...]

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: run-drizzle-kit.ts <subcommand> [args...]");
  process.exit(1);
}

const result = Bun.spawnSync(["bunx", "drizzle-kit", ...args], {
  stdio: ["inherit", "inherit", "inherit"],
  env: process.env,
});
process.exit(result.exitCode ?? 0);
