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
  },

  brandTokens: {
    title: "Brand Tokens",
    formMode: "Form view",
    advancedMode: "JSON editor",
    advancedDescription: "Edit all brand tokens as JSON.",
    resetSection: "Reset section",
    colors: {
      title: "Colors",
      primary: "Primary color",
      secondary: "Secondary color",
    },
    typography: {
      title: "Typography",
      headingFont: "Heading font",
      headingFontCustom: "Custom font",
    },
  },

  brandAssets: {
    title: "Brand Assets",
    slots: {},
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
