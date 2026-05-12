export default {
  title: "Cost",
  detailLogs: "Detail Logs",

  summary: {
    thisMonth: "This Month",
    lastMonth: "Last Month",
    thisYear: "This Year",
    dailyAvg: "Daily Average",
    dailyAvgHint: "Daily avg this month",
    vsLastMonth: "vs. last month",
  },

  charts: {
    byService: "Cost by Service",
    daily: "Daily Trend (current month)",
    byOperation: "Cost by Operation",
    noData: "No data for this period",
  },

  services: {
    anthropic: "Anthropic",
    replicate: "Replicate",
    dataforseo: "DataForSEO",
    smtp: "SMTP",
  },

  thresholdTypes: {
    daily: "Daily",
    monthly: "Monthly",
  },

  filters: {
    project: "Project",
    allProjects: "All Projects",
    service: "Service",
    operation: "Operation",
    operationPlaceholder: "e.g. outline-generation",
  },

  table: {
    date: "Date",
    project: "Project",
    service: "Service",
    operation: "Operation",
    callCount: "Calls",
    totalEur: "Total",
    of: "of",
    noResults: "No results for these filters",
  },

  alerts: {
    title: "{count} active cost alerts",
  },

  errors: {
    limitExceeded: "Cost limit reached. Pipeline paused.",
  },
};
