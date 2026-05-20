export default {
  pageTitle: "Refresh Queue",
  pageDescription: "Stale articles that need a refresh.",

  runDetection: "Run Detection",
  lastDetection: "Last detection: {time}",
  neverDetected: "Never detected",
  detectionStarted: "Detection started",
  detectionFailed: "Failed to start detection",

  triggered: "Refresh started",
  triggerFailed: "Failed to start refresh",
  dismissFailed: "Failed to dismiss",

  loadMore: "Load more",

  empty: {
    title: "No candidates",
    description: "All articles are up to date. Run detection to find stale ones.",
    suggestions: "No open quality suggestions.",
  },

  lastUpdated: "Last updated",

  actions: {
    refresh: "Refresh",
    dismiss: "Dismiss",
    markRefreshed: "Mark as refreshed",
    viewFindings: "View findings",
    analyzeOne: "Analyze with AI",
  },

  analyzeOneStarted: "AI analysis started for this article",
  analyzeOneFailed: "Failed to start single-article analysis",

  analyzeAll: "Analyze all",
  analyzeAllHint: "Runs AI quality analysis on all published articles.",
  analyzing: "Analyzing…",
  analyzeStarted: "Analysis started for {count} articles",
  analyzeFailed: "Failed to start analysis",

  markRefreshedSuccess: "Article marked as refreshed",
  markRefreshedFailed: "Failed to mark article",
  suggestionDismissed: "Suggestion dismissed",

  suggestionsTitle: "Refresh Suggestions",
  suggestionsDescription:
    "Articles flagged for a refresh — either time-based (threshold exceeded) or via AI quality analysis.",

  source: {
    time: "Time-based",
    quality: "AI Quality Analysis",
  },

  recommendation: {
    "refresh-now": "Refresh now",
    "refresh-soon": "Refresh soon",
    "no-action": "No action needed",
  },

  confidence: {
    high: "High",
    medium: "Medium",
    low: "Low",
  },

  findings: {
    outdatedClaims: "Outdated claims",
    missingCoverage: "Missing coverage",
    staleReferences: "Stale references",
    confidenceLabel: "Confidence",
    noFindings: "No specific findings.",
  },
};
