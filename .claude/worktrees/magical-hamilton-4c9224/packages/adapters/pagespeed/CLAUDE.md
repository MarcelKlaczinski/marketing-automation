# PageSpeed Validation Adapter

Two validation modes (Spec 22.5):
- **local** (`article:pagespeed-validation`): Clones Astro repo, builds locally, runs Lighthouse. Quality gate — transitions article to `published` or `blocked_by_pagespeed`.
- **api** (`article:pagespeed-validation-api`): Calls Google PageSpeed Insights API on a live URL. Informational — updates scores without changing article status.

## Hard Rules

- Local mode still requires `astroCommitSha` (article must have been synced) and `astroRepo` config — enforced in the pipeline bridge, not the step
- API mode requires `projects.domain` to be set (or `urlOverride` passed via trigger) — enforced at the API route before enqueueing
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

## Preview Server Port

`AstroPreviewServerStep` uses fixed port **14321** (not `--port 0`). Astro CLI does not
support dynamic port-zero binding — it will ignore the flag and default to 4321, causing
collisions if you run multiple validations. 14321 is our stable sentinel; ensure no other
process occupies it before running validation.

## Common Mistakes

- DO NOT skip the chrome install step on a fresh machine (local mode only)
- DO NOT trigger local mode on an article that hasn't been synced via Spec 21 — `astroCommitSha` will be null and the bridge throws before clone-or-update
- DO NOT run multiple validations in parallel against the same project — they share the workDir
  (could collide). Pipeline has no built-in lock; the BullMQ jobId dedup catches same-article retries.
- DO NOT manually kill the preview server during a run — the pipeline expects to own its lifecycle.
- DO NOT name this package's constructor error field `cause` — use `originalCause` per project convention
- DO NOT add `"types": ["bun"]` to tsconfig.json — it breaks under the workspace root config
- DO NOT add new pipeline steps that need `runCmd` without passing `stage` — the helper accepts
  `stage: RunCmdStage` so error messages correctly identify which phase failed
- DO NOT remove mode-specific precondition checks from `LoadArticleStep` without moving them to the pipeline bridge — the step is shared across both pipelines, so mode-specific guards (e.g. "must have astroCommitSha for local") belong in `Pipeline.bridge()` at the transition where they're actually needed, not in the step itself
- DO NOT add a new validation mode without updating both the `pagespeedRuns.mode` DB column type AND the `EvaluateAndPersistInput.mode` type — they must stay in sync
