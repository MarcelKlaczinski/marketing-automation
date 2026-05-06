export default {
  title: 'Projects',
  empty: 'No projects yet. Create your first project to get started.',
  createButton: 'New Project',

  stats: {
    clusters: 'Clusters',
    articles: 'Articles',
    totalArticles: 'Total Articles',
    published: 'Published',
  },

  create: {
    title: 'Create New Project',
    basicsStep: 'Basics',
    contextStep: 'Marketing Context',
    name: 'Name',
    slug: 'Slug',
    slugInvalid: 'Only lowercase letters, numbers and hyphens',
    slugHint: 'URL-friendly identifier — auto-suggested from the name',
    industry: 'Industry',
    pipelineTemplate: 'Pipeline Template',
    contextIntro: 'Optional: Describe brand voice, target audience, content strategy. You can also auto-generate this later in the Cold-Start phase.',
    createButton: 'Create Project',
    success: 'Project "{name}" created',
  },

  detail: {
    notFound: 'Project not found',
    backToList: 'Back to list',
    coldStartStub: 'Cold-Start UI will be implemented in Spec 35.',
    articlesStub: 'Article Pipeline UI will be implemented in Spec 36.',
    clustersStub: 'Cluster Management UI will be implemented in Spec 37.',
    tabs: {
      overview: 'Overview',
      coldStart: 'Cold-Start',
      articles: 'Articles',
      clusters: 'Clusters',
      settings: 'Settings',
    },
  },

  overview: {
    contextTitle: 'Marketing Context',
    contextHint: 'Description of the brand, target audience, and content strategy. Used in Cold-Start and Article Generation as system prompt.',
    saveSuccess: 'Marketing context saved',
    statsTitle: 'Statistics',
    metaTitle: 'Metadata',
    industry: 'Industry',
    pipelineTemplate: 'Template',
    created: 'Created',
  },

  settings: {
    intro: 'Project-specific settings for Astro-Sync, PageSpeed validation and cost limits.',
    saveSuccess: 'Settings saved',
    astroRepo: {
      title: 'Astro Repository',
      description: 'GitHub repository where articles are pushed via Astro-Sync.',
      owner: 'Owner (Username/Org)',
      name: 'Repo Name',
      installationId: 'GitHub App Installation ID',
      installationIdHint: 'Numeric ID. Available via "bun --filter @marketing-auto/adapter-astro-sync list-installations".',
      defaultBranch: 'Default Branch',
      contentRoot: 'Content Root',
      assetsRoot: 'Assets Root',
    },
    publishDomain: {
      title: 'Publish Domain',
      description: 'Domain where the Astro site is deployed (without protocol).',
      field: 'Domain',
    },
    pagespeed: {
      title: 'PageSpeed Thresholds',
      description: 'Minimum Lighthouse scores an article must reach to be considered "published".',
      performance: 'Performance',
      accessibility: 'Accessibility',
      bestPractices: 'Best Practices',
      seo: 'SEO',
    },
    linkRebuild: {
      title: 'Internal Linking Budget',
      description: 'Maximum monthly budget for cluster-wide internal linking rebuilds.',
      field: 'Budget',
      invalid: 'Invalid amount (e.g. 30 or 30.00)',
    },
  },
};
