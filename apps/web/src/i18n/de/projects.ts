export default {
  title: 'Projekte',
  empty: 'Noch keine Projekte. Erstelle dein erstes Projekt um loszulegen.',
  createButton: 'Neues Projekt',

  stats: {
    clusters: 'Cluster',
    articles: 'Artikel',
    totalArticles: 'Artikel insgesamt',
    published: 'Veröffentlicht',
  },

  create: {
    title: 'Neues Projekt erstellen',
    basicsStep: 'Grunddaten',
    contextStep: 'Marketing-Context',
    name: 'Name',
    slug: 'Slug',
    slugInvalid: 'Nur Kleinbuchstaben, Zahlen und Bindestriche',
    slugHint: 'URL-freundlicher Bezeichner — wird automatisch aus dem Namen vorgeschlagen',
    industry: 'Branche',
    pipelineTemplate: 'Pipeline-Template',
    contextIntro: 'Optional: Beschreibe Brand-Voice, Zielgruppe, Inhalts-Strategie. Du kannst dies auch nachträglich im Cold-Start automatisch generieren lassen.',
    createButton: 'Projekt erstellen',
    success: 'Projekt "{name}" erstellt',
  },

  detail: {
    notFound: 'Projekt nicht gefunden',
    backToList: 'Zurück zur Übersicht',
    coldStartStub: 'Cold-Start UI wird in Spec 35 implementiert.',
    articlesStub: 'Article Pipeline UI wird in Spec 36 implementiert.',
    clustersStub: 'Cluster Management UI wird in Spec 37 implementiert.',
    tabs: {
      overview: 'Übersicht',
      coldStart: 'Cold-Start',
      articles: 'Artikel',
      clusters: 'Cluster',
      settings: 'Einstellungen',
    },
  },

  overview: {
    contextTitle: 'Marketing-Context',
    contextHint: 'Beschreibung der Marke, Zielgruppe, und Content-Strategie. Wird in Cold-Start und Article-Generation als System-Prompt verwendet.',
    saveSuccess: 'Marketing-Context gespeichert',
    statsTitle: 'Statistiken',
    metaTitle: 'Metadaten',
    industry: 'Branche',
    pipelineTemplate: 'Template',
    created: 'Erstellt',
  },

  settings: {
    intro: 'Projekt-spezifische Einstellungen für Astro-Sync, PageSpeed-Validierung und Cost-Limits.',
    saveSuccess: 'Einstellungen gespeichert',
    astroRepo: {
      title: 'Astro Repository',
      description: 'GitHub-Repository in das Articles per Astro-Sync gepusht werden.',
      owner: 'Owner (Username/Org)',
      name: 'Repo Name',
      installationId: 'GitHub App Installation ID',
      installationIdHint: 'Numerische ID. Verfügbar via "bun --filter @marketing-auto/adapter-astro-sync list-installations".',
      defaultBranch: 'Default Branch',
      contentRoot: 'Content Root',
      assetsRoot: 'Assets Root',
    },
    publishDomain: {
      title: 'Publish Domain',
      description: 'Domain auf der die Astro-Site deployed ist (ohne Protokoll).',
      field: 'Domain',
    },
    pagespeed: {
      title: 'PageSpeed Schwellenwerte',
      description: 'Lighthouse-Scores die ein Article mindestens erreichen muss um als "published" zu gelten.',
      performance: 'Performance',
      accessibility: 'Accessibility',
      bestPractices: 'Best Practices',
      seo: 'SEO',
    },
    linkRebuild: {
      title: 'Internal-Linking-Budget',
      description: 'Maximales Budget pro Monat für Cluster-weite Internal-Linking-Rebuilds.',
      field: 'Budget',
      invalid: 'Ungültiger Betrag (z.B. 30 oder 30.00)',
    },
  },
};
