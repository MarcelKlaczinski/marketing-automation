export default {
  title: "[EN] First Setup",
  intro:
    "[EN] This wizard guides you through configuring all external services. You can skip individual steps and return later.",
  alreadyInitialized:
    "[EN] The system has already been set up. You can reconfigure or re-verify individual adapters here.",

  step: "[EN] Step {current} of {total}",
  back: "[EN] Back",
  next: "[EN] Next",
  skip: "[EN] Skip",
  finish: "[EN] Finish",

  status: {
    pending: "[EN] Pending",
    configured: "[EN] Configured",
    verified: "[EN] Verified",
    failed: "[EN] Verification failed",
    skipped: "[EN] Skipped",
  },

  save: {
    save: "[EN] Save",
    update: "[EN] Update",
    saved: "[EN] Saved",
  },

  verify: {
    button: "[EN] Verify now",
    inProgress: "[EN] Verifying...",
    success: "[EN] Connection successful",
    failure: "[EN] Connection failed: {message}",
  },

  skipDialog: {
    title: "[EN] Skip this step?",
    intro: "[EN] If you skip this step, the following features will be unavailable:",
    confirm: "[EN] Understood, skip",
    cancel: "[EN] Cancel",
  },

  adapters: {
    verified: "[EN] Configured and verified",
    configuredNotVerified: "[EN] Configured, not verified",
    notConfigured: "[EN] Not configured",
  },

  validation: {
    required: "[EN] Required",
  },

  steps: {
    intro: {
      title: "[EN] Welcome",
      description:
        "[EN] This platform automates SEO and content workflows. Before you can start, some external services need to be configured.",
      timeEstimate: "[EN] Estimated time: 30-60 minutes",
    },
    core: {
      title: "[EN] Core Infrastructure",
      description:
        "[EN] Database and Redis. These are configured via environment variables and cannot be changed in the browser.",
      postgresLabel: "[EN] PostgreSQL",
      redisLabel: "[EN] Redis",
      configHint: "[EN] Set DATABASE_URL and REDIS_URL in `.env` and restart the API server.",
    },
    smtp: {
      title: "[EN] Email (SMTP)",
      description: "[EN] Required for magic-link login. Recommended: Gmail with App Password.",
      consequenceIfSkipped:
        "[EN] Magic-link login will be logged to the console (dev mode). Cost alerts and notifications will not be sent.",
      fields: {
        host: "[EN] SMTP Host",
        port: "[EN] Port",
        user: "[EN] Username",
        password: "[EN] Password",
        fromAddress: "[EN] From Address",
      },
      hint: "[EN] Gmail setup: Enable 2-factor auth, then create an App Password at https://myaccount.google.com/apppasswords",
    },
    anthropic: {
      title: "[EN] Anthropic API",
      description:
        "[EN] Required for cold-start synthesis, article generation, and schema extensions.",
      consequenceIfSkipped:
        "[EN] The following features are unavailable: cold-start, article generation, schema extraction, internal linking. Effectively: almost everything.",
      fields: {
        apiKey: "[EN] API Key",
      },
      hint: "[EN] Get the key at https://console.anthropic.com/settings/keys",
    },
    replicate: {
      title: "[EN] Replicate",
      description: "[EN] Used for generating hero images (Flux 1.1 Pro).",
      consequenceIfSkipped:
        "[EN] Hero image generation in the article pipeline is unavailable. Articles will be created without a hero image.",
      fields: {
        apiToken: "[EN] API Token",
      },
      hint: "[EN] Token available at https://replicate.com/account/api-tokens",
    },
    r2: {
      title: "[EN] Cloudflare R2",
      description: "[EN] Storage for generated hero images. Referenced directly in Astro Sync.",
      consequenceIfSkipped:
        "[EN] Replicate does not work without R2 (images cannot be stored). Indirect consequence: no article generation.",
      fields: {
        accountId: "[EN] Account ID",
        accessKeyId: "[EN] Access Key ID",
        secretAccessKey: "[EN] Secret Access Key",
        bucket: "[EN] Bucket Name",
        publicBaseUrl: "[EN] Public Base URL",
      },
      hint: "[EN] Create bucket + R2 token at https://dash.cloudflare.com/?to=/:account/r2",
    },
    dataforseo: {
      title: "[EN] DataForSEO",
      description:
        "[EN] Provides SERP data and keyword volume for cold-start and article research.",
      consequenceIfSkipped:
        "[EN] Cold-start competitor analysis, cluster plan, and article research do not work. Cold-start is effectively blocked.",
      fields: {
        login: "[EN] Login",
        password: "[EN] Password",
      },
      hint: "[EN] Account with $50 deposit at https://app.dataforseo.com/register",
    },
    githubApp: {
      title: "[EN] GitHub App",
      description: "[EN] Push articles to the Astro repository.",
      consequenceIfSkipped:
        "[EN] Astro Sync is unavailable. Articles remain in the DB and must be manually copied to the Astro repo.",
      fields: {
        appId: "[EN] App ID",
        privateKeyPath: "[EN] Path to Private Key (.pem)",
        privateKeyContent: "[EN] Private Key Content (PEM)",
      },
      hint: "[EN] Setup guide: packages/adapters/astro-sync/SETUP-GITHUB-APP.md",
      hintPathPlaceholder: "/Users/you/.ssh/my-github-app.pem",
      hintPemPlaceholder: "-----BEGIN RSA PRIVATE KEY-----",
      modeNoteLokal: "[EN] Local mode: path to the PEM file on your Mac.",
      modeNoteSelfHosted: "[EN] Self-hosted mode: paste the PEM content (stored encrypted).",
    },
    producthunt: {
      title: "[EN] Product Hunt API",
      description: "[EN] Used by the signal collector (Spec 54.4) to fetch new AI tool launches from Product Hunt daily.",
      consequenceIfSkipped:
        "[EN] Product Hunt signals will not be collected. HN and RSS sources continue to run.",
      fields: {
        apiKey: "[EN] API Key (Client ID)",
        apiSecret: "[EN] API Secret (Client Secret)",
      },
      hint: "[EN] Create an OAuth app at https://www.producthunt.com/v2/oauth/applications → copy Client ID and Client Secret.",
    },
    summary: {
      title: "[EN] Summary",
      readyTitle: "[EN] Ready to go",
      readyDescription:
        "[EN] All required adapters are configured. Click Finish to proceed to the app.",
      partialTitle: "[EN] Setup partially complete",
      partialDescription:
        "[EN] Some adapters are skipped. You can complete them under Settings at any time.",
      finishButton: "[EN] Finish — go to app",
    },
  },
};
