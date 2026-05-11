export default {
  pageTitle: "Content Gaps",

  actions: {
    runDetection:        "Run Detection",
    running:             "Detecting…",
    dismiss:             "Dismiss",
    reopen:              "Reopen",
    markInProgress:      "Mark In Progress",
    suggest:             "Suggest title",
    suggesting:          "Loading suggestion…",
    generate:            "Generate article",
    generating:          "Starting…",
    translationDisabled: "Translation pipeline not yet available",
    viewArticle:         "View article",
    viewSpec:            "View cornerstone spec",
    dismissAll:          "Dismiss all",
    suggestAll:          "Suggest all titles",
  },

  status: {
    open:        "Open",
    in_progress: "In Progress",
    resolved:    "Resolved",
    dismissed:   "Dismissed",
  },

  gapType: {
    missing_hub:         "Missing Hub",
    missing_translation: "Missing Translation",
    missing_spoke_type:  "Missing Spoke Type",
    cluster_too_small:   "Cluster Too Small",
  },

  priority: {
    "1": "Critical",
    "2": "High",
    "3": "Medium",
  },

  filters: {
    all:                 "All",
    missing_hub:         "Missing Hubs",
    missing_translation: "Translations",
    missing_spoke_type:  "Spoke Types",
    cluster_too_small:   "Small Clusters",
  },

  lastDetected:    "Last detected:",
  neverDetected:   "Never detected",
  totalOpen:       "{count} open gaps",
  emptyState:      "No open content gaps found.",
  emptyStateHint:  "Run detection to identify cluster and translation gaps.",
  emptyFiltered:   "No gaps for this filter.",

  suggestion: {
    title:              "Suggested title:",
    slug:               "Slug:",
    keyword:            "Keyword",
    metaDesc:           "Meta description:",
    imagePrompt:        "Image prompt:",
    discoveredKeywords: "Discovered keywords (saved):",
  },

  metadata: {
    cluster:         "Cluster",
    locale:          "Locale",
    missingLocale:   "Missing language",
    intentType:      "Intent",
    spokesPresent:   "Present spokes",
    existingArticle: "Existing article",
  },

  batch: {
    suggestAllConfirm:  "Suggest titles for up to 20 gaps using AI (approx. €0.10)?",
    dismissedSuccess:   "{count} gaps dismissed",
    suggestedSuccess:   "Titles suggested for {count} gaps",
  },

  articleCount: "{count} articles",
};
