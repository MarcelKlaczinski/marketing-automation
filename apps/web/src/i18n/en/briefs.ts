export default {
  title: "Briefs",

  sections: {
    pending: "Pending",
    pendingDescription: "Sorted by trend score — highest priority first.",
    pendingEmpty: { title: "No pending briefs", description: "All briefs have been processed." },
    inFlight: "In Flight",
    inFlightDescription: "Briefs that have been approved and whose pipeline is running.",
    inFlightEmpty: { title: "No active briefs", description: "Approve briefs to start pipelines." },
    done: "Done",
    doneDescription: "Dismissed and completed briefs.",
    doneEmpty: { title: "No finished briefs yet", description: "" },
  },

  bulk: {
    approveSelected: "Approve selected",
    dismissSelected: "Dismiss selected",
    confirmTitle: "Approve briefs",
    confirmDescription: "{count} brief(s) will be approved.",
    estimatedCost: "Estimated cost",
    estimatedTime: "Estimated time",
    modeAssist: "Assist (single articles)",
    modeAuto: "Auto (cluster creation)",
    confirm: "Approve",
    success: "{approved} approved, {skipped} skipped, {failed} failed",
    approveSuccess: "{count} brief(s) approved",
    dismissSuccess: "Briefs dismissed",
    dismissConfirmTitle: "Dismiss briefs",
    dismissConfirmDescription: "{count} brief(s) will be dismissed.",
    // Spec 64.17 — "Select all matching filter" pattern.
    selectAllMatching: "Select all {n} briefs matching filter",
    selectAllMatchingActive: "{n} briefs selected (all matching filter)",
    preflightLoading: "Checking cluster assignments …",
    preflightTotal: "{n} briefs selected",
    preflightEligible: "{n} ready",
    preflightNeedsCluster: "{n} need cluster assignment (will be skipped)",
    preflightError: "Cluster check failed — submit still enabled.",
    raceDetected: "Filter matched {total} briefs at action time.",
  },

  // Spec 63.6: dispatch picker for brief-approval (plan vs immediate).
  bulkApprove: {
    dispatchLabel: "Dispatch mode",
    plan: "Schedule for next plan",
    planHint:
      "Briefs land in the plan pool. Generation only starts once you approve the next weekly plan — budget gate active.",
    planSuccess: "{count} brief(s) queued for next plan",
    immediate: "Generate immediately",
    immediateHint:
      "Articles will be generated right now. The weekly budget gate is bypassed — use only for edge cases.",
    immediateSuccess: "{count} brief(s) — generation running",
    immediateConfirmTitle: "Confirm immediate generation",
    // Spec 64.17 — Submit labels with pre-flight eligibility count.
    submitPlanN: "Schedule {n} brief(s) into plan",
    submitImmediateN: "Generate {n} brief(s) immediately",
  },

  actions: {
    approve: "Approve",
    assignCluster: "Assign cluster",
    dismiss: "Dismiss",
    approveSuccess: "Brief approved — pipeline started",
    dismissSuccess: "Brief dismissed",
  },

  fields: {
    title: "Suggested title",
    slug: "Suggested slug",
    meta: "Meta description",
    primaryKeyword: "Primary keyword",
    clusterAction: "Cluster action",
  },

  detail: {
    suggestion: "AI suggestion",
    trend: "Trend data",
    refresh: "Refresh context",
    needsCluster: "This brief requires a cluster assignment first.",
    empty: "Select a brief",
    emptyDescription: "Click a brief on the left to see details.",
  },

  selectBrief: "Select brief",

  approvalStatus: {
    pending: "Pending",
    plan_pending: "In Plan Pool",
    approved: "Approved",
    auto_approved: "Auto-Approved",
    rejected: "Rejected",
    routed: "Routed",
    superseded: "Superseded",
  },

  source: {
    gap_analysis: "Gap Analysis",
    trend_discovery: "Trend",
    refresh_detection: "Refresh",
    manual: "Manual",
    comparison_discovery: "Comparison Discovery",
    release_detection: "Release",
    star_trend: "Star spike",
    recurring: "Recurring",
  },

  clusterAction: {
    append_to_existing: "Add to cluster",
    create_new: "New cluster",
    translation: "Translation",
    refresh: "Refresh",
    standalone: "Standalone",
    comparison: "Comparison",
  },

  filters: {
    label: "Source",
    all: "All",
    clear: "Clear filter",
    readinessLabel: "Status",
    readinessAll: "All",
    readinessReady: "Approve-ready",
    readinessUnready: "Not enriched",
    readinessPlanReady: "In plan pool",
  },

  // Spec 64.14 Phase C: manual brief creation form.
  create: {
    open: "Create brief",
    title: "Create new brief",
    subtitle:
      "Manual topic the trend synthesizer doesn't find — e.g. \"What is RAG?\".",
    collectionHint: "Collection",
    collectionHintHelp: "Determines default intent and cluster action.",
    // Spec multi-domain-evolution Domain-Registry follow-up — surfaces the
    // tenant niche under the collection dropdown when the /brief-options
    // endpoint returns source="registry" (vs. source="fallback").
    taxonomyFromRegistry: "Taxonomy from DomainSpec ({niche})",
    intentType: "Intent type",
    intentHint: "Optional. Otherwise derived from collection.",
    topicTitle: "Topic",
    topicTitlePlaceholder: "e.g. What is Retrieval-Augmented Generation?",
    primaryKeyword: "Primary keyword",
    primaryKeywordPlaceholder: "e.g. RAG",
    description: "Context (optional)",
    descriptionPlaceholder:
      "Short note for yourself — saved as the brief's meta description.",
    locale: "Language",
    submit: "Create brief",
    submitting: "Creating…",
    success: "Brief \"{title}\" created — landed as \"Pending\" in the list.",
    errors: {
      titleTooShort: "At least 10 characters",
      keywordRequired: "At least 2 characters",
      submitFailed: "Create failed",
    },
  },

  // Spec 64.14: collection-hint values for the create form.
  // Spec multi-domain-evolution Domain-Registry follow-up: `tools` + `usecases`
  // added because they live in toolwikiDomain.collections (registered in
  // @marketing-auto/content-schema/domains/toolwiki/spec.ts) and the
  // /brief-options endpoint will return them under source="registry".
  collections: {
    "ki-wissen": "ki-wissen (knowledge explainer)",
    blog: "Blog (standalone)",
    comparison: "Comparison",
    cluster: "Cluster (new)",
    tools: "Tool page",
    usecases: "Use case",
  },

  // Spec 64.14: intent-type values for the create form. Names are read-only
  // taxonomy strings — keep in sync with INTENT_TYPES in
  // apps/api/src/routes/projects/briefs.ts.
  intents: {
    knowledge: "Knowledge (concept explainer)",
    tutorial: "Tutorial (tool-centric)",
    use_case: "Use-case (industry / persona)",
    comparison: "Comparison",
    review: "Review",
    news: "News",
    best_practices: "Best practices",
    alternatives: "Alternatives",
    pricing: "Pricing",
    risks: "Risks",
  },
};
