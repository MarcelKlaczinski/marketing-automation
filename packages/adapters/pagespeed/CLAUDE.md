# PageSpeed Validation Adapter

Local Astro build + Lighthouse CLI validation pipeline. Last quality gate before
articles transition to `published` status.

## Hard Rules

- Only validates articles in `ready_to_publish` or `blocked_by_pagespeed` status
- Runs Astro build locally — do NOT replace with Vercel/Cloudflare-API in MVP
- All work happens in `/tmp/marketing-auto/pagespeed/<projectSlug>/<runId>/`,
  cleaned up by OS or Marcel as needed
- Preview server PID is tracked on the pipeline instance and killed in afterComplete/afterError
- Lighthouse uses desktop emulation (KI-Wissensraum's primary audience). Mobile testing
  is a future enhancement.

## Required Setup

Before first run, install Chrome:
```bash
bun --filter @marketing-auto/adapter-pagespeed install-chrome
```

Marcel-machine prerequisites: Node.js 18+, git, ~150MB free space for Chrome.

## Performance Notes

- Cold run: ~3-5 min (git clone + npm install + astro build + lighthouse)
- Warm run (repo already cloned): ~1-2 min (git fetch + maybe partial install + build + lighthouse)
- Disk: ~200MB per project per run (cleared between runs is optional)

## Common Mistakes

- DO NOT skip the chrome install step on a fresh machine
- DO NOT validate an article that hasn't been synced via Spec 21 — `astroCommitSha` will be missing
- DO NOT run multiple validations in parallel against the same project — they share the workDir
  (could collide). Pipeline has no built-in lock; the BullMQ jobId dedup catches same-article retries.
- DO NOT manually kill the preview server during a run — the pipeline expects to own its lifecycle.
- DO NOT name this package's constructor error field `cause` — use `originalCause` per project convention
- DO NOT add `"types": ["bun"]` to tsconfig.json — it breaks under the workspace root config
