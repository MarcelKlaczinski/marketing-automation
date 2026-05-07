export default {
  title: 'Activity',
  subtitle: '{count} active',
  empty: 'No activity',
  emptyHint: 'No pipeline runs in this time window.',

  filters: {
    project: 'Project',
    allProjects: 'All Projects',
    type: 'Type',
    status: 'Status',
    since: 'Time range',
  },

  since: {
    '24h': 'Last 24h',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
  },

  types: {
    cold_start: 'Cold-Start',
    article_outline: 'Outline',
    article_draft: 'Draft',
    astro_sync: 'Sync',
    pagespeed: 'PageSpeed',
    schema_extension: 'Schema',
    link_rebuild: 'Links',
    other: 'Other',
  },

  statuses: {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  },

  relative: {
    justNow: 'just now',
    minutesAgo: '{n}m ago',
    hoursAgo: '{n}h ago',
    daysAgo: '{n}d ago',
  },
};
