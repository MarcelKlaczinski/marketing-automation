export default {
  pageTitle: "Clusters & Pillars",
  empty: "No pillars yet.",
  emptyHint: "Create a pillar to start organizing clusters.",

  fields: {
    pillarName: "Pillar name",
    clusterName: "Cluster name",
    description: "Description",
    descriptionHint: "Short description of this content pillar",
    primaryKeyword: "Primary keyword",
    clusters: "Clusters",
    articles: "Articles",
    cornerstones: "Cornerstones",
    pillarArticle: "Pillar article",
  },

  actions: {
    manage: "Manage clusters",
    newPillar: "New pillar",
    newCluster: "New cluster",
    moveUp: "Move up",
    moveDown: "Move down",
    editDescription: "Edit description",
    delete: "Delete",
    moveArticles: "Move articles…",
    changePillar: "Change pillar",
  },

  dialogs: {
    createPillar: "New pillar",
    createCluster: "New cluster",
    deletePillar: "Delete pillar?",
    deletePillarMessage: 'Really delete pillar "{name}"? This action cannot be undone.',
    deleteCluster: "Delete cluster?",
    deleteClusterMessage: 'Really delete cluster "{name}"?',
    deleteClusterWithArticles:
      'Really delete cluster "{name}"? The {count} articles inside will become uncategorized.',
    editPillarDescription: "Edit pillar description",
    moveArticles: "Move articles",
    moveArticlesFrom: "From cluster: {name}",
    moveTo: "Move to",
    uncategorized: "— Uncategorized —",
    noArticlesInCluster: "This cluster has no articles.",
    moveSelectedCount: "Move {count}",
  },

  notify: {
    pillarCreated: "Pillar created",
    pillarUpdated: "Pillar updated",
    pillarDeleted: "Pillar deleted",
    clusterCreated: "Cluster created",
    clusterUpdated: "Cluster updated",
    clusterDeleted: "Cluster deleted",
    clusterMoved: "Cluster moved",
    articlesMoved: "{count} articles moved",
    cannotDeletePillarWithClusters:
      "Cannot delete pillar — it still has {count} clusters. Move or delete them first.",
  },

  validation: {
    nameTooShort: "Minimum 2 characters",
  },
};
