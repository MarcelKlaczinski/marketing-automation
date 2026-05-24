# Setting up content-schema auto-sync

One-time setup for the auto-sync workflow from `marketing-automation` to consumer Astro repos (currently: `ki-wissensraum-v2`; future tenants register here as well).

## How it works

Workflow `.github/workflows/sync-content-schema-to-toolwiki.yml` runs on every push to `master` that touches `packages/content-schema/`. It copies `packages/content-schema/src/` into the toolwiki repo under `src/vendored/content-schema/` and opens (or updates) a PR on the toolwiki `master` branch via the `sync/content-schema` branch. PRs are reused — multiple consecutive syncs update the same PR rather than spamming new ones.

The workflow can also be triggered manually from the Actions tab via `workflow_dispatch` (useful for first-run smoke tests).

## Prerequisites

- GitHub App `marketing-tool-sync` already configured (App-ID **`3618750`**, Client-ID `Iv23liVJCBd8ihNrOBwc`)
- App installed on both `MarcelKlaczinski/marketing-automation` and `MarcelKlaczinski/ki-wissensraum-v2`
- App permissions: `Contents: Read & write` + `Pull requests: Read & write` on both repos

## 1. Configure repo secrets in marketing-automation

Go to `https://github.com/MarcelKlaczinski/marketing-automation/settings/secrets/actions`.

Add two secrets:

| Name | Value |
|---|---|
| `SYNC_APP_ID` | `3618750` (the GitHub App's numeric ID) |
| `SYNC_APP_PRIVATE_KEY` | The full PEM-formatted private key, including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----` lines |

The private key was downloaded when the App was created. If lost: revoke the old key in App settings → Private keys, generate a new one, then update the secret.

## 2. Verify App has access to both repos

Go to `https://github.com/settings/installations` (personal) or the org-level equivalent.

For the `marketing-tool-sync` app:
- **Repository access** should list both `marketing-automation` and `ki-wissensraum-v2`
- If only one is listed: click **Configure** → select the missing repo → save

## 3. Test the workflow manually

1. Go to `https://github.com/MarcelKlaczinski/marketing-automation/actions`
2. Select **Sync content-schema to Toolwiki**
3. Click **Run workflow** → Branch: `master` → **Run workflow**

Expected result:
- Workflow run completes green within ~30 seconds
- New PR appears in `MarcelKlaczinski/ki-wissensraum-v2`: `sync: content-schema@<SHA>`
- PR contains `src/vendored/content-schema/` with all files plus `.SOURCE` manifest and a `README.md` warning against manual edits

Troubleshooting:
- **403 / "Resource not accessible by integration"** → App is not installed on one of the repos, or `Contents`/`Pull requests` permissions are missing. Reconfigure the installation and re-run.
- **"secret SYNC_APP_ID not found"** → secret name mismatch. Verify spelling exactly: `SYNC_APP_ID` and `SYNC_APP_PRIVATE_KEY`.
- **PEM parse errors** → re-copy the private key. Ensure no leading/trailing whitespace, full PEM with header and footer lines on their own lines.
- **`fatal: could not read Username`** at the toolwiki-checkout step → the `token` input on `actions/checkout@v4` is missing or the token's `Contents:write` permission on the toolwiki repo is denied.

## 4. Verify the first auto-PR

In the toolwiki repo, the first auto-PR adds:
- `src/vendored/content-schema/` directory with all schema files from `packages/content-schema/src/`
- `src/vendored/content-schema/.SOURCE` manifest (source repo + SHA + sync timestamp)
- `src/vendored/content-schema/README.md` warning against manual edits

Before merging this first PR:
- Check that the file list matches `packages/content-schema/src/` in `marketing-automation`
- Pull the branch locally, run `npm run build` in the toolwiki repo — schema validation against all content collections must pass
- `npx astro check` (or `npm run astro -- check`) clean

After merging, refactor the local stubs under `src/schema/` to re-export from `src/vendored/content-schema/` instead of containing parallel definitions. That refactor is a separate follow-up PR — not part of this branch.

## 5. Day-to-day workflow

Whenever a `master` commit in `marketing-automation` touches `packages/content-schema/`, GitHub Actions auto-creates or updates the PR in `ki-wissensraum-v2`. Review and merge at your leisure.

If multiple `master` commits land before the previous toolwiki-PR is merged, the PR is updated in-place on the `sync/content-schema` branch. No PR spam.

## Adding a new consumer repo

1. Install the `marketing-tool-sync` GitHub App on the new repo (Repository access → Configure → add repo)
2. Add the new repo name to the `repositories:` list in the `create-github-app-token` step in `.github/workflows/sync-content-schema-to-toolwiki.yml`
3. Add a second `actions/checkout@v4` step + a second sync block + a second `peter-evans/create-pull-request` step targeting the new repo. Keep the `sync/content-schema` branch name and `delete-branch: false` to prevent PR spam.
4. In the new consumer repo, set up the `src/vendored/content-schema/` consumer pattern (see `ki-wissensraum-v2` for reference)
