/**
 * Spec 65.8 — Verify image-provider credentials via vault.
 *
 * Reads Pexels / Unsplash / Pixabay API keys from `global_credentials`
 * (mirroring `POST /api/system/verify/:adapter`) and runs a read-only
 * search call against each provider. Reports per-provider status with
 * sample hit counts.
 *
 * Usage:
 *   bun --filter @marketing-auto/api verify-image-providers
 *
 * Exits 0 when ALL three providers verified OK, 1 otherwise — Marcel can
 * wire this into a deploy-time smoke check.
 */
import { verifyPexels } from "@marketing-auto/adapter-pexels/verify";
import { verifyPixabay } from "@marketing-auto/adapter-pixabay/verify";
import { verifyUnsplash } from "@marketing-auto/adapter-unsplash/verify";
import { readAdapterCreds } from "../lib/system-service.ts";

// biome-ignore lint/suspicious/noConsoleLog: script output
const out = (line: string): void => console.log(line);

interface ProviderCheckResult {
  service: string;
  ok: boolean;
  message: string;
}

async function verifyOne(
  service: "pexels" | "unsplash" | "pixabay",
): Promise<ProviderCheckResult> {
  const creds = await readAdapterCreds(service);
  if (service === "pexels") {
    if (!creds.api_key) return { service, ok: false, message: "api_key not set in vault" };
    const r = await verifyPexels({ apiKey: creds.api_key });
    return { service, ...r };
  }
  if (service === "unsplash") {
    if (!creds.access_key) return { service, ok: false, message: "access_key not set in vault" };
    const r = await verifyUnsplash({ accessKey: creds.access_key });
    return { service, ...r };
  }
  if (!creds.api_key) return { service, ok: false, message: "api_key not set in vault" };
  const r = await verifyPixabay({ apiKey: creds.api_key });
  return { service, ...r };
}

async function main(): Promise<void> {
  out("== Image-provider verification ==");
  out("");

  const services = ["pexels", "unsplash", "pixabay"] as const;
  const results = await Promise.all(services.map((s) => verifyOne(s)));

  for (const r of results) {
    const marker = r.ok ? "✓" : "✗";
    out(`${marker} ${r.service.padEnd(10)} ${r.message}`);
  }

  out("");
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    out("All providers verified OK.");
    process.exit(0);
  } else {
    out(`${failed.length} of ${results.length} providers failed verification.`);
    process.exit(1);
  }
}

main().catch((err) => {
  out(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
