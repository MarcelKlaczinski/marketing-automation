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
};
