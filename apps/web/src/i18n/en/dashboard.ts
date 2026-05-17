export default {
  title: "Pipeline Dashboard",
  liveStatus: "{running} running · {queued} queued · €{cost} today",

  stats: {
    activeRuns: "Active Runs",
    costMonth: "Cost this month",
    articlesWeek: "Articles this week",
    successRate: "Success rate (24h)",
    running: "running",
    queued: "queued",
    noTrend: "—",
    trendUp: "+{n}% vs previous",
    trendDown: "{n}% vs previous",
    trendNeutral: "No change",
  },

  filter: {
    last24h: "Last 24h",
    filter: "Filter",
  },

  lanes: {
    queued: "Queued",
    running: "Running",
    failed: "Failed",
    completed: "Completed",
    empty: "No runs",
    emptyDesc: "Nothing in this lane right now.",
  },

  pipeline: {
    types: {
      blog: "Blog",
      translation: "Translation",
      refresh: "Refresh",
      cluster: "Cluster",
      "cluster-creator": "Cluster",
      "cold-start": "Setup",
      default: "Pipeline",
      article_outline: "Outline",
      article_draft: "Draft",
      astro_sync: "Sync",
      pagespeed: "PageSpeed",
      schema_extension: "Schema",
      link_rebuild: "Links",
    },
    stepOf: "Step {current}/{total}",
    elapsed: "Running for {time}",
    ago: "{time} ago",
    costLabel: "€{cost}",
  },

  clusters: {
    title: "Active Clusters",
    empty: "No active clusters",
    emptyDesc: "Clusters with ongoing generation appear here.",
    progress: "{done}/{total} articles",
    pillsLabel: "Article status pills",
  },

  detail: {
    noSelection: "No run selected",
    noSelectionDesc: "Click any card to see details, steps and costs.",
    steps: "Steps",
    noSteps: "No steps yet",
    cost: "Cost",
    costSpent: "Spent",
    costEstimated: "Estimated",
    wordCount: "Words",
    author: "Author",
    loadError: "Could not load run.",
    actions: {
      open: "Open",
      retry: "Retry",
      cancel: "Cancel",
      pause: "Pause",
    },
  },
};
