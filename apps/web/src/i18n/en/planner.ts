export default {
  title: "Planner",
  description: "View and approve the weekly plan",

  // Week navigator
  week: "Week {n} / {year}",
  weekRange: "{start} – {end}",
  prevWeek: "Previous week",
  nextWeek: "Next week",
  thisWeek: "This week",
  pickWeek: "Pick week",

  // View toggle
  viewGrid: "Grid",
  viewList: "List",
  viewToggleAria: "Switch view",

  // Status badges
  planStatus: {
    draft: "Draft",
    approved: "Approved",
    running: "Running",
    completed: "Completed",
    partially_failed: "Partially failed",
    cancelled: "Cancelled",
    superseded: "Superseded",
  },
  itemStatus: {
    pending: "Pending",
    enqueued: "Enqueued",
    in_progress: "Running",
    completed: "Completed",
    failed: "Failed",
    skipped: "Skipped",
    cancelled: "Cancelled",
  },

  // Source-kind badges. Spec 62.4-followup Issue 3.
  sourceKind: {
    floor: "Scheduled",
    overage_signal: "Trend",
    sibling_locale: "EN version",
  },

  // Content-type badges
  contentType: {
    cluster: "Cluster",
    comparison: "Comparison",
    ki_wissen: "KI-Wissen",
    social_post: "Social",
    article: "Article",
    refresh: "Refresh",
    translation: "Translation",
  },

  // Budget bar
  budget: {
    label: "Budget",
    used: "€{used} / €{total}",
    percent: "{percent}%",
    tooltip: "Floor: €{floor}  ·  Overage: €{overage}  ·  Sibling: €{sibling}",
    breakdownFloor: "Floor",
    breakdownOverage: "Overage",
    breakdownSibling: "Sibling",
  },

  // Empty / no-plan state
  empty: {
    title: "No plan for this week",
    description: "Generate a plan for week {n} / {year} to see items here.",
    cta: "Generate plan for week {n}",
  },
  emptyDay: "No items",

  // Action bar
  actions: {
    approveAll: "Approve all",
    approveSelected: "Approve selected ({n})",
    cancelPlan: "Cancel plan",
    regenerate: "Regenerate",
    viewRuns: "View pipeline runs",
    viewRunsComingSoon: "Coming in Spec 62.6",
    generatePlan: "Generate plan",
    generating: "Generating plan …",
  },

  // Generate confirm dialog
  generateConfirm: {
    title: "Generate plan for week {n} / {year}?",
    body: "Cost is shown by the budget bar after generation. Pipeline typically runs 1–3 seconds.",
    confirm: "Generate",
    confirmDebug: "Start debug run",
    cancel: "Cancel",
    debugToggle: "Debug mode (step-by-step)",
    debugHint:
      "Pauses after every step. You can inspect input/output, tweak prompts, or re-run individual steps. Jumps straight to the run detail view.",
  },
  regenerateConfirm: {
    title: "Replace existing plan?",
    body: "The existing plan will be marked superseded and a new plan generated. This cannot be undone.",
    confirm: "Replace",
    cancel: "Cancel",
  },
  cancelPlanConfirm: {
    title: "Cancel plan?",
    body: "All pending items will be cancelled. This cannot be undone.",
    confirm: "Cancel plan",
    cancel: "Close",
  },
  approveSelectedConfirm: {
    title: "Cancel unselected items and approve?",
    body: "{toCancel} item(s) will be cancelled, then the remaining {toKeep} item(s) will be approved. This cannot be undone.",
    confirm: "Cancel + Approve",
    cancel: "Cancel",
  },

  // Toasts / errors
  toast: {
    planGenerated: "Plan generated",
    planGeneratedDebug: "Debug run started — paused after step 1",
    planApproved: "Plan approved",
    planCancelled: "Plan cancelled",
    itemCancelled: "Item cancelled",
    itemRescheduled: "Slot date updated",
    planAlreadyExists: "Plan already exists for this week",
    rescheduleOutOfRange: "Date is outside the plan week",
    actionFailed: "Action failed",
  },

  // Detail page
  detail: {
    back: "Back to planner",
    title: "Item details",
    scheduleSection: "Schedule",
    contentSection: "Content",
    costSection: "Cost",
    pipelineInputSection: "Pipeline input",
    siblingSection: "Sibling locale",
    sourceBriefSection: "Source",
    fields: {
      date: "Date",
      planWeek: "Plan week",
      type: "Type",
      pipeline: "Pipeline",
      source: "Source",
      reason: "Reason",
      estimated: "Estimated",
      actual: "Actual",
      notExecuted: "(not yet executed)",
    },
    editSlotDate: "Edit slot date",
    saveSlotDate: "Save",
    cancelEdit: "Cancel",
    cancelItem: "Cancel item",
    siblingParent: "Parent item",
    siblingChild: "Sibling item",
    viewSibling: "View sibling item",
    viewSourceBrief: "View source brief",
    noSibling: "No sibling",
    noSourceBrief: "No source",
  },

  // Card meta
  card: {
    cost: "€{cost}",
    selectAria: "Select item",
    openAria: "Open item details",
    dragHandleAria: "Drag item to change slot date",
  },

  // Days of week (short labels)
  days: {
    mo: "Mon",
    tu: "Tue",
    we: "Wed",
    th: "Thu",
    fr: "Fri",
    sa: "Sat",
    su: "Sun",
  },
};
