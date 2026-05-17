export default {
  title: "Settings",

  sections: {
    project: "Project",
    "brand-tokens": "Brand Tokens",
    "brand-assets": "Brand Assets",
    credentials: "Credentials",
  },

  project: {
    title: "Project Settings",
    basics: {
      title: "Basics",
      description: "Project name, domain, and industry.",
    },
    marketing: {
      title: "Marketing Context",
      description: "Target audience, tone of voice, and core messages for the AI pipeline.",
    },
    costLimits: {
      title: "Cost Limits",
      description: "Monthly budget and alert thresholds for API costs.",
    },
    astro: {
      title: "Astro Repository",
      description: "Connection to the Astro repo for publishing articles and local preview.",
      notConfigured: "No Astro repository configured.",
    },
    pagespeed: {
      title: "PageSpeed Thresholds",
      description: "Minimum Lighthouse score requirements for validation.",
    },
    translation: {
      title: "Translation Automation",
      description: "Automatically generate an EN version when a DE article completes.",
    },
    fields: {
      name: "Project name",
      domain: "Domain",
      domainHelper: "Public domain without protocol, e.g. example.com",
      industry: "Industry",
      marketingContextMd: "Marketing context (Markdown)",
      marketingContextMdHelper: "Target audience, tone, and core messages. Loaded into every pipeline.",
      monthlyBudget: "Monthly Anthropic budget (€)",
      monthlyBudgetHelper: "Maximum monthly spend on Anthropic API calls.",
      alertThreshold: "Alert threshold (%)",
      alertThresholdHelper: "Percentage of budget at which a warning alert fires (e.g. 80).",
      astroDefaultBranch: "Default branch",
      astroLocalPath: "Local path",
      astroLocalPathHelper: "Absolute path to the locally checked-out Astro repo for preview.",
      minPerformance: "Minimum performance score (0–100)",
      minSeo: "Minimum SEO score (0–100)",
      translationAutoTrigger: "Auto-generate EN version",
      translationAutoTriggerHelper: "Starts the translation pipeline automatically after a DE article completes.",
    },
  },

  brandTokens: {
    title: "Brand Tokens",
    formMode: "Form view",
    advancedMode: "JSON editor",
    advancedDescription: "Edit all brand tokens as JSON.",
    resetSection: "Reset section",
    jsonInvalid: "Invalid JSON — please fix before saving.",
    jsonSaveError: "Save error: {msg}",
    resetAll: "Reset all",
    colors: {
      title: "Colors",
      primary: "Primary color",
      accent: "Accent color",
      surface: "Surface color",
    },
    typography: {
      title: "Typography",
      headingFont: "Heading font",
      headingFontCustom: "Custom font",
      customFont: "Custom font name",
    },
    voice: {
      title: "Brand voice",
      addressForm: "Form of address",
      addressDu: "Du (informal)",
      addressSie: "Sie (formal)",
      forbiddenWords: "Forbidden words",
      forbiddenWordsHelper: "Comma-separated list of words to avoid.",
      signaturePhrases: "Signature phrases",
      signaturePhrasesHelper: "One phrase per line — characteristic brand expressions.",
    },
    social: {
      title: "Social media",
      instagramHandle: "Instagram handle",
      websiteUrl: "Website URL",
    },
  },

  brandAssets: {
    title: "Brand Assets",
    uploadLabel: "Upload file",
    uploadDrag: "Drag file here or click",
    deleteLabel: "Delete",
    noAsset: "No asset uploaded",
    uploadError: "Upload failed",
    slots: {
      logo: {
        title: "Logo",
        description: "Primary brand logo (SVG or PNG recommended, min. 200×60 px)",
      },
      tool_icon: {
        title: "Tool icon",
        description: "Default icon for tools without their own logo (square, min. 128×128 px)",
      },
    },
  },

  credentials: {
    title: "Credentials",
    description: "Manage API keys for external services.",
    set: "Save",
    update: "Update",
    verify: "Test connection",
    remove: "Remove",
    setBefore: "(already configured)",
    savedSuccess: "Credentials saved",
    verifySuccess: "Connection successful",
    verifyFailed: "Connection failed",
    keys: {
      apiKey: "API Key",
      apiToken: "API Token",
      login: "Username",
      password: "Password",
    },
  },

  tabs: {
    adapters: "Adapters",
    system: "System",
    profile: "Profile",
    notifications: "Notifications",
  },

  adapters: {
    intro: "Manage connections to external services. Click an adapter to change its configuration.",
    disconnect: "Disconnect",
    status: {
      verified: "Verified",
      configured: "Configured",
      notConfigured: "Not configured",
    },
    disconnectDialog: {
      title: "Really disconnect?",
      description:
        "All stored credentials for {adapter} will be deleted. You can re-configure them at any time.",
      confirm: "Disconnect",
      success: "Disconnected",
    },
  },

  system: {
    intro: "Status of core infrastructure and system metadata.",
    deploymentMode: "Mode",
    apiVersion: "API version",
    connected: "Connected",
    disconnected: "Disconnected",
    lastChecked: "Last checked",
    lokalCaption: "Local development mode",
    selfHostedCaption: "Self-hosted mode (container)",
    refreshButton: "Refresh status",
    coreUnreachable:
      "Core infrastructure (PostgreSQL/Redis) is unreachable. Check DATABASE_URL and REDIS_URL in your .env file.",
  },

  profile: {
    intro: "Your account.",
    email: "Email address",
    userId: "User ID",
  },

  notifications: {
    title: "Browser Notifications",
    intro: "Receive push notifications for critical events (pipeline failures, cost limits) even when the tab is closed.",
    enabled: "Enabled on this device",
    disabled: "Not enabled on this device",
    enable: "Enable",
    disable: "Disable",
    unsupported: "Push notifications are not supported in this browser.",
    permissionDenied: "Permission denied. Enable it in your browser settings.",
    permissionDeniedToast: "Permission denied. Enable it in your browser settings.",
    enabledSuccess: "Push notifications enabled",
    disabledSuccess: "Push notifications disabled",
    sendTest: "Send test notification",
    testSent: "Test notification sent",
    activeDevices: "Active devices",
    noDevices: "No devices registered",
    unknownDevice: "Unknown device",
    subscribedAt: "Registered {time}",
    lastUsed: "Last used {time}",
    revoke: "Revoke",
    deviceRevoked: "Device revoked",
  },
};
