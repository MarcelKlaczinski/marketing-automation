export default {
  pageTitle: "Cluster & Pillars",
  empty: "Noch keine Pillars angelegt.",
  emptyHint: "Lege einen Pillar an, um Cluster zu organisieren.",

  fields: {
    pillarName: "Pillar-Name",
    clusterName: "Cluster-Name",
    description: "Beschreibung",
    descriptionHint: "Kurze Beschreibung der inhaltlichen Säule",
    primaryKeyword: "Primäres Keyword",
    clusters: "Cluster",
    articles: "Artikel",
    cornerstones: "Cornerstones",
    pillarArticle: "Pillar-Artikel",
  },

  actions: {
    manage: "Cluster verwalten",
    viewCornerstones: "Cornerstones",
    newPillar: "Neuer Pillar",
    newCluster: "Neuer Cluster",
    moveUp: "Nach oben",
    moveDown: "Nach unten",
    editDescription: "Beschreibung bearbeiten",
    delete: "Löschen",
    moveArticles: "Artikel verschieben…",
    changePillar: "Pillar ändern",
  },

  dialogs: {
    createPillar: "Neuer Pillar",
    createCluster: "Neuer Cluster",
    deletePillar: "Pillar löschen?",
    deletePillarMessage:
      'Pillar "{name}" wirklich löschen? Diese Aktion ist nicht rückgängig zu machen.',
    deleteCluster: "Cluster löschen?",
    deleteClusterMessage: 'Cluster "{name}" wirklich löschen?',
    deleteClusterWithArticles:
      'Cluster "{name}" wirklich löschen? Die {count} enthaltenen Artikel werden zu "Ohne Cluster" verschoben.',
    editPillarDescription: "Pillar-Beschreibung bearbeiten",
    moveArticles: "Artikel verschieben",
    moveArticlesFrom: "Aus Cluster: {name}",
    moveTo: "Verschieben nach",
    uncategorized: "— Ohne Cluster —",
    noArticlesInCluster: "Dieser Cluster enthält keine Artikel.",
    moveSelectedCount: "{count} verschieben",
  },

  notify: {
    pillarCreated: "Pillar angelegt",
    pillarUpdated: "Pillar aktualisiert",
    pillarDeleted: "Pillar gelöscht",
    clusterCreated: "Cluster angelegt",
    clusterUpdated: "Cluster aktualisiert",
    clusterDeleted: "Cluster gelöscht",
    clusterMoved: "Cluster verschoben",
    articlesMoved: "{count} Artikel verschoben",
    cannotDeletePillarWithClusters:
      "Pillar kann nicht gelöscht werden — enthält noch {count} Cluster. Verschiebe oder lösche sie zuerst.",
  },

  validation: {
    nameTooShort: "Mindestens 2 Zeichen",
  },
};
