# GitHub App Setup for Astro Sync

One-time setup (~10 minutes). After completion, all your Astro repos can be synced through this single App.

## Step 1: Create the GitHub App

1. Go to https://github.com/settings/apps/new (personal account) or
   https://github.com/organizations/<org>/settings/apps/new (organization)

2. Fill in:
   - **GitHub App name**: `Marketing Automation Sync` (must be globally unique)
   - **Homepage URL**: any URL, e.g. `https://github.com/<your-username>`
   - **Webhook**: UNCHECK "Active" — we don't use webhooks
   - **Repository permissions**:
     - Contents: **Read and write** (required: commit files)
     - Metadata: **Read-only** (default)
     - Pull requests: **Read and write** (forward-compat for Spec 21.5)
   - **Account permissions**: leave all "No access"
   - **Where can this GitHub App be installed?**: "Only on this account"

3. Click "Create GitHub App"

## Step 2: Generate a private key

1. After creation, scroll down to "Private keys"
2. Click "Generate a private key"
3. A `.pem` file will download. Save it as `~/.config/marketing-auto/github-app.pem`
   (or any path you'll reference in `.env`)

## Step 3: Note the App ID

On the App settings page, copy the "App ID" (a 6-digit number near the top).

## Step 4: Install on your Astro repos

1. In the App settings, click "Install App" in the left sidebar
2. Click "Install" next to your account
3. Choose "Only select repositories"
4. Select your Astro repo(s): `ki-wissensraum-astro`, etc.
5. Click "Install"

## Step 5: Get installation IDs

```bash
# After Step 6 below (env configured), run:
bun --filter @marketing-auto/adapter-astro-sync list-installations
```

Expected output:
```
Installation 12345678
  Account: your-username
  Repos: your-username/ki-wissensraum-astro
```

## Step 6: Configure environment

Add to `.env`:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/Users/marcel/.config/marketing-auto/github-app.pem
```

## Step 7: Set per-project astro_repo config

In Drizzle Studio, update `projects.astro_repo` for each project:

```json
{
  "owner": "your-username",
  "name": "ki-wissensraum-astro",
  "installationId": 12345678,
  "defaultBranch": "main",
  "contentRoot": "src/content",
  "assetsRoot": "src/assets"
}
```

## Verification

```bash
bun --filter @marketing-auto/adapter-astro-sync verify-app
```

Expected output: `✅ GitHub App authenticated: marketing-automation-sync (id: 123456)`
