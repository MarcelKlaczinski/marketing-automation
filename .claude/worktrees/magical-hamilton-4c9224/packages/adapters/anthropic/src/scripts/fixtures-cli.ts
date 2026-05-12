#!/usr/bin/env bun
import { unlinkSync } from "node:fs";
import { fixturePath, listFixtures } from "../cache.ts";

const cmd = process.argv[2];

// biome-ignore lint/suspicious/noConsoleLog: script output
const print = (msg: string) => console.log(msg);
const die = (msg: string, code = 1): never => {
  console.error(msg);
  process.exit(code);
};

if (!cmd || cmd === "list") {
  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    print("No fixtures recorded.");
    process.exit(0);
  }
  print(`Found ${fixtures.length} fixture(s):\n`);
  for (const { cacheKey, fixture } of fixtures.sort((a, b) =>
    a.fixture.recordedAt.localeCompare(b.fixture.recordedAt)
  )) {
    const date = fixture.recordedAt.slice(0, 19).replace("T", " ");
    print(
      `  ${cacheKey}  ${date}  ${fixture.metadata.model.padEnd(20)}  ${fixture.metadata.operation.padEnd(28)}  "${fixture.metadata.userMessagePreview}"`
    );
  }
  process.exit(0);
}

if (cmd === "show") {
  const cacheKey = process.argv[3] ?? die("Usage: fixtures show <cacheKey>");
  const fixtures = listFixtures();
  const match =
    fixtures.find((f) => f.cacheKey === cacheKey) ?? die(`Fixture ${cacheKey} not found.`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(JSON.stringify(match.fixture, null, 2));
  process.exit(0);
}

if (cmd === "delete") {
  const cacheKey = process.argv[3] ?? die("Usage: fixtures delete <cacheKey>");
  try {
    unlinkSync(fixturePath(cacheKey));
    print(`Deleted fixture ${cacheKey}`);
  } catch (e) {
    die(`Failed: ${(e as Error).message}`);
  }
  process.exit(0);
}

if (cmd === "prune") {
  const daysArg = process.argv[3];
  const days = daysArg ? parseInt(daysArg, 10) : 30;
  if (!Number.isFinite(days) || days < 1) die("Usage: fixtures prune [days] (default 30)");
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const fixtures = listFixtures();
  let pruned = 0;
  for (const { cacheKey, fixture } of fixtures) {
    if (new Date(fixture.recordedAt).getTime() < cutoff) {
      unlinkSync(fixturePath(cacheKey));
      pruned += 1;
      print(`  pruned ${cacheKey} (${fixture.recordedAt})`);
    }
  }
  print(`\nPruned ${pruned} fixture(s) older than ${days} days.`);
  process.exit(0);
}

console.error("Usage: fixtures <list|show|delete|prune> [args]");
console.error("");
console.error("  list                  — list all fixtures with metadata");
console.error("  show <cacheKey>       — print full fixture content");
console.error("  delete <cacheKey>     — delete one fixture");
console.error("  prune [days]          — delete fixtures older than N days (default 30)");
process.exit(1);
