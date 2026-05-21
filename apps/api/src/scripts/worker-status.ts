// Spec 62.6 followup: diagnose `worker:restart` issues.
//
// Reads tmp/worker.pid + checks whether the recorded process is actually alive,
// then sanity-checks BullMQ queue connectivity. Use when a `worker:restart`
// seemed to silently fail or the UI hangs on "Loading…".
//
// Usage:
//   bun --filter @marketing-auto/api run worker:status

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import IORedis from "ioredis";
import { getEnv } from "@marketing-auto/shared";

const PID_FILE = join(process.cwd(), "tmp", "worker.pid");

async function main(): Promise<void> {
  console.log("== Worker status ==");

  let pidContents: string | null = null;
  try {
    pidContents = (await readFile(PID_FILE, "utf8")).trim();
    console.log(`PID file:        ${PID_FILE}`);
    console.log(`PID file value:  ${pidContents}`);
  } catch {
    console.log(`PID file:        (missing — no worker recorded as running)`);
  }

  if (pidContents) {
    const pid = parseInt(pidContents, 10);
    if (Number.isNaN(pid)) {
      console.log(`PID parse:       FAILED (file contained garbage)`);
    } else {
      try {
        process.kill(pid, 0);
        console.log(`Process ${pid}:    ALIVE (responding to signal 0)`);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ESRCH") {
          console.log(`Process ${pid}:    DEAD (stale PID file — next restart will clean up)`);
        } else if (code === "EPERM") {
          console.log(`Process ${pid}:    EXISTS but not signalable (different user / privileged)`);
        } else {
          console.log(`Process ${pid}:    UNKNOWN (${code})`);
        }
      }
    }
  }

  // Probe Redis / BullMQ — if the worker thinks it's alive but Redis dropped
  // the connection, jobs won't be picked up.
  const env = getEnv();
  const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const pong = await redis.ping();
    console.log(`Redis ping:      ${pong}`);
    // BullMQ default queue key prefix is `bull:<queueName>:`. Active jobs map.
    const active = await redis.llen("bull:pipelines:active").catch(() => -1);
    const waiting = await redis.llen("bull:pipelines:wait").catch(() => -1);
    const delayed = await redis.zcard("bull:pipelines:delayed").catch(() => -1);
    console.log(`Queue pipelines: active=${active} waiting=${waiting} delayed=${delayed}`);
  } catch (err) {
    console.log(`Redis ping:      FAILED — ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    redis.disconnect();
  }

  console.log("");
  console.log("If the worker is dead but the PID file exists, just call:");
  console.log("  bun --filter @marketing-auto/api run worker:restart");
  console.log("It will detect the stale PID and replace it cleanly.");

  process.exit(0);
}

main().catch((err) => {
  console.error("worker:status failed:", err);
  process.exit(1);
});
