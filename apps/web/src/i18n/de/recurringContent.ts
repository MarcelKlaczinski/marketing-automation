/**
 * Spec 65.11 — Recurring-Content / Hook-Library / End-Slide Settings i18n (DE).
 *
 * Three sibling pages live under /settings/{recurring-content,hooks,end-slides}.
 * Keys nested under `definitions.*`, `hooks.*`, `endSlides.*` so /search.ts
 * Cmd+K entries can reference them via a single path.
 */
export default {
  definitions: {
    title: "Recurring Content",
    description:
      "Wiederkehrende Carousel-Definitionen — Marcel-Definitionen, Frequenz, Format-Konfiguration und Template-Strategie.",
    empty:
      "Noch keine Definitionen — leg eine neue an, um eine wiederkehrende Carousel-Rhythmus zu starten.",
    loadError: "Definitionen konnten nicht geladen werden.",
    newDefinition: "Neue Definition",
    columns: {
      name: "Name",
      formatType: "Format",
      frequency: "Frequenz",
      nextRun: "Nächster Lauf",
      active: "Aktiv",
    },
    filters: {
      formatType: "Format-Typ filtern",
      formatTypeAll: "Alle Formate",
      includeInactive: "Inaktive einschließen",
    },
    inactiveChip: "Inaktiv",
    rowOpen: "Öffnen",

    detail: {
      title: "Definition-Detail",
      tabs: {
        config: "Konfiguration",
        history: "Verlauf",
        upcoming: "Kommende Runs",
      },
      actions: {
        toggleActivate: "Aktivieren",
        toggleDeactivate: "Deaktivieren",
        runNow: "Jetzt ausführen",
        runNowConfirm:
          "Eine zusätzliche, manuell ausgelöste Brief-Generierung. Der reguläre Zeitplan läuft weiter.",
        runNowSuccess: "Jetzt-Lauf in die Warteschlange eingereiht.",
        dryRun: "Vorschau (Dry-Run)",
        dryRunHint:
          "Dry-Run kostet so viel wie ein echter Lauf — alle LLM-Calls werden ausgeführt, aber nichts gespeichert.",
        dryRunSuccess: "Vorschau erstellt.",
        dryRunFailed: "Vorschau fehlgeschlagen.",
      },
      runNowDialog: {
        title: "Jetzt-Lauf bestätigen",
        message:
          "Ein zusätzlicher Brief wird sofort erstellt. Der reguläre Wochen-Zeitplan bleibt unverändert.",
      },
      dryRunResult: {
        title: "Dry-Run-Ergebnis",
        statusPersisted: "Persistiert",
        statusSkipped: "Übersprungen",
        statusPreview: "Vorschau (nicht gespeichert)",
        templateLabel: "Template",
        templateVia: "Strategie",
        endSlideLabel: "End-Slide",
        endSlideVia: "Auswahl",
        toolsLabel: "Tools",
        hookLabel: "Hook (rendered)",
        topicTitleLabel: "Topic-Titel",
        briefTextLabel: "Brief-Text",
      },
      historyEmpty: "Noch keine Runs für diese Definition.",
      historyTable: {
        runNumber: "Run #",
        createdAt: "Erstellt",
        topicTitle: "Topic",
        status: "Status",
      },
      upcomingEmpty: "Keine kommenden Runs (Definition inaktiv?).",
    },

    create: {
      title: "Neue Definition",
      titleEdit: "Definition bearbeiten",
      cancel: "Abbrechen",
      save: "Speichern",
      saving: "Speichert…",
      saveSuccess: "Definition gespeichert.",
      saveFailed: "Speichern fehlgeschlagen.",
      fields: {
        name: "Name",
        nameHint: 'z. B. "Top 5 LLMs Wochen-Vergleich"',
        formatType: "Format-Typ",
        formatTypeHint: "Bestimmt das Layout der Carousel-Slides.",
        frequency: "Frequenz",
        frequencyHint:
          'weekly, biweekly, monthly ODER ein Cron-Ausdruck (z. B. "0 9 * * 1" für jeden Montag 09:00 UTC).',
        outputTargetsArticle: "Artikel erzeugen",
        outputTargetsSocial: "Social-Carousel erzeugen",
        templateStrategy: "Template-Auswahl",
        templateStrategyHint:
          "fixed = ein konkretes Template • lru = least-recently-used • llm-picks = LLM rankt • latest = neuestes",
        fixedTemplateKey: "Festes Template (key)",
        endSlideStrategy: "End-Slide-Strategie",
        endSlidePool: "End-Slide-Pool (UUIDs)",
        endSlidePoolHint:
          "Komma-getrennte UUIDs aus den End-Slide-Definitionen. Leer = format-Defaults.",
        nextRunAt: "Erster Lauf (UTC)",
        formatConfig: "Format-Konfiguration (JSON)",
        formatConfigHint:
          "Zod-validiert per Format-Typ. Schema-Hinweise unten — copy/paste als Startpunkt.",
        isActive: "Aktiv",
      },
      formatConfigSchemaHeading: "Erwartetes Schema für dieses Format",
      formatConfigJsonInvalid: "Ungültiges JSON.",
    },

    formatType: {
      top_n_comparison: "Top-N Vergleich",
      head_to_head: "Head-to-Head",
      story_arc_clickbait: "Story-Arc (clickbait)",
      lifestyle_listicle: "Lifestyle-Listicle",
      opinion_recommendation: "Meinung & Empfehlung",
    },

    family: {
      A: "Familie A — datengetrieben",
      B: "Familie B — Hook-getrieben",
    },

    templateStrategy: {
      fixed: "Fest (fixed)",
      lru: "Least-recently-used (LRU)",
      "llm-picks": "LLM-Ranking",
      latest: "Neuestes",
    },
  },

  hooks: {
    title: "Hook-Bibliothek",
    description:
      "Wiederverwendbare Familie-B-Hook-Muster mit {variablen}-Platzhaltern. Die 65.5 Brief-Generatoren rotieren per LRU.",
    empty: "Noch keine Hooks für dieses Format / diese Sprache.",
    addHook: "Neuer Hook",
    languageLabel: "Sprache",
    languageDe: "Deutsch",
    languageEn: "Englisch",
    formatTypeLabel: "Format-Typ",
    columns: {
      pattern: "Muster",
      variables: "Variablen",
      usage: "Verwendungen",
      lastUsed: "Zuletzt verwendet",
      active: "Aktiv",
    },
    inactiveChip: "Inaktiv",
    edit: {
      titleCreate: "Neuer Hook",
      titleEdit: "Hook bearbeiten",
      fields: {
        formatType: "Format-Typ",
        language: "Sprache",
        pattern: "Hook-Muster",
        patternHint:
          'Verwende {variable}-Platzhalter, z. B. „Ich habe meinen {profession}-Job verloren wegen {tool}".',
        variables: "Variablen (komma-getrennt)",
        variablesHint:
          "Liste aller Platzhalter im Muster, ohne geschweifte Klammern.",
        isActive: "Aktiv",
      },
      previewHeading: "Vorschau",
      previewHint: "Mit Beispielwerten gerendert.",
      saveSuccess: "Hook gespeichert.",
      saveFailed: "Speichern fehlgeschlagen.",
      cancel: "Abbrechen",
      save: "Speichern",
    },
    samples: {
      profession: "Texter",
      tool: "Claude",
      lifeArea: "Alltag",
      persona: "Solopreneur",
      role: "Designer",
      stance: "begeistert",
      context: "im Team",
    },
  },

  endSlides: {
    title: "End-Slide-Definitionen",
    description:
      "Letzter Frame jedes Theme-65-Carousels. Pluggable Types: follow-cta, comment-to-get, link-in-bio, tag-friend, save-share-cta, swipe-up, quote-action.",
    empty: "Noch keine End-Slide-Definitionen.",
    addEndSlide: "Neuer End-Slide",
    columns: {
      name: "Name",
      type: "Typ",
      active: "Aktiv",
    },
    inactiveChip: "Inaktiv",
    typeLabel: {
      "follow-cta": "Follow-CTA",
      "comment-to-get": "Kommentar-für-Ressource",
      "link-in-bio": "Link in Bio",
      "tag-friend": "Freund taggen",
      "save-share-cta": "Speichern / Teilen",
      "swipe-up": "Swipe-up",
      "quote-action": "Zitat-Action",
    },
    edit: {
      titleCreate: "Neuer End-Slide",
      titleEdit: "End-Slide bearbeiten",
      fields: {
        name: "Name",
        type: "Typ",
        typeImmutable: "(nach Erstellung nicht änderbar)",
        config: "Konfiguration (JSON)",
        configHint: "Zod-validiert per Typ. Schema-Hinweise unten.",
        isActive: "Aktiv",
      },
      schemaHeading: "Erwartetes Schema für diesen Typ",
      saveSuccess: "End-Slide gespeichert.",
      saveFailed: "Speichern fehlgeschlagen.",
      cancel: "Abbrechen",
      save: "Speichern",
    },
  },
};
