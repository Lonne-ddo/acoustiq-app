/**
 * Système de traduction FR/EN pour l'interface AcoustiQ
 */

const translations: Record<string, Record<string, string>> = {
  // Barre latérale
  'sidebar.title': { fr: 'AcoustiQ', en: 'AcoustiQ' },
  'sidebar.subtitle': { fr: 'Analyse acoustique environnementale', en: 'Environmental acoustic analysis' },
  'sidebar.import': { fr: 'Importer des fichiers', en: 'Import files' },
  'sidebar.loading': { fr: 'Chargement…', en: 'Loading…' },
  'sidebar.importHint': { fr: 'XLSX 831C / 821SE', en: 'XLSX 831C / 821SE' },
  'sidebar.save': { fr: 'Sauvegarder', en: 'Save' },
  'sidebar.open': { fr: 'Ouvrir', en: 'Open' },
  'sidebar.files': { fr: 'Fichiers de mesure', en: 'Measurement files' },
  'sidebar.filesEmpty': { fr: 'Cliquez sur "Importer" ci-dessus', en: 'Click "Import" above' },
  'sidebar.assignPoint': { fr: '— Assigner un point —', en: '— Assign a point —' },
  'sidebar.loadWav': { fr: 'Charger un fichier .wav', en: 'Load a .wav file' },
  'sidebar.remove': { fr: 'Retirer', en: 'Remove' },

  // Onglets
  'tab.visualization': { fr: 'Visualisation', en: 'Visualization' },
  'tab.spectrogram': { fr: 'Spectrogramme', en: 'Spectrogram' },
  'tab.lw': { fr: 'Calcul Lw', en: 'Lw Calculation' },
  'tab.concordance': { fr: 'Concordance', en: 'Concordance' },
  'tab.report': { fr: 'Rapport', en: 'Report' },

  // Graphique
  'chart.day': { fr: 'Journée', en: 'Day' },
  'chart.aggregation': { fr: 'Agrégation', en: 'Aggregation' },
  'chart.points': { fr: 'points', en: 'points' },
  'chart.events': { fr: 'événement(s)', en: 'event(s)' },
  'chart.exportPng': { fr: 'Exporter PNG', en: 'Export PNG' },
  'chart.fullView': { fr: 'Vue complète', en: 'Full view' },
  'chart.noData': { fr: 'Aucune donnée à afficher pour la journée sélectionnée.', en: 'No data for the selected day.' },
  'chart.filesShown': { fr: 'fichier(s) affiché(s)', en: 'file(s) displayed' },

  // Indices
  'indices.title': { fr: 'Indices acoustiques', en: 'Acoustic indices' },
  'indices.fullDay': { fr: 'Pleine journée', en: 'Full day' },
  'indices.custom': { fr: 'Personnalisé', en: 'Custom' },
  'indices.exportExcel': { fr: 'Exporter Excel', en: 'Export Excel' },
  'indices.index': { fr: 'Indice', en: 'Index' },

  // Projet
  'project.new': { fr: 'Nouveau projet', en: 'New project' },
  'project.recent': { fr: 'Projets récents', en: 'Recent projects' },
  'project.untitled': { fr: 'Projet sans titre', en: 'Untitled project' },
  'project.missingFiles': { fr: 'Projet chargé — fichiers manquants', en: 'Project loaded — missing files' },
  'project.loadError': { fr: 'Erreur de chargement du projet', en: 'Project load error' },
  'project.autoSaved': { fr: 'Sauvegarde automatique…', en: 'Auto-saving…' },

  // Paramètres
  'settings.title': { fr: 'Paramètres', en: 'Settings' },
  'settings.pointColors': { fr: 'Couleurs des points', en: 'Point colors' },
  'settings.yAxis': { fr: 'Axe Y par défaut', en: 'Default Y axis' },
  'settings.min': { fr: 'Min', en: 'Min' },
  'settings.max': { fr: 'Max', en: 'Max' },
  'settings.aggregation': { fr: 'Intervalle d\'agrégation', en: 'Aggregation interval' },
  'settings.minutes': { fr: 'minutes', en: 'minutes' },
  'settings.company': { fr: 'Nom de l\'entreprise', en: 'Company name' },
  'settings.language': { fr: 'Langue', en: 'Language' },

  // Raccourcis
  'shortcuts.title': { fr: 'Raccourcis clavier', en: 'Keyboard shortcuts' },
  'shortcuts.space': { fr: 'Lecture / pause audio', en: 'Play / pause audio' },
  'shortcuts.arrows': { fr: 'Déplacer le graphique', en: 'Pan chart' },
  'shortcuts.zoom': { fr: 'Zoom + / -', en: 'Zoom + / -' },
  'shortcuts.save': { fr: 'Sauvegarder le projet', en: 'Save project' },
  'shortcuts.openProject': { fr: 'Ouvrir un projet', en: 'Open project' },
  'shortcuts.escape': { fr: 'Fermer le panneau', en: 'Close panel' },

  // Rapport
  'report.title': { fr: 'Générateur de rapport', en: 'Report generator' },
  'report.project': { fr: 'Projet', en: 'Project' },
  'report.copy': { fr: 'Copier le rapport', en: 'Copy report' },
  'report.exportTxt': { fr: 'Exporter .txt', en: 'Export .txt' },

  // Audio
  'audio.title': { fr: 'Audio', en: 'Audio' },
  'audio.removeAudio': { fr: 'Retirer l\'audio', en: 'Remove audio' },

  // Chargement
  'loading.parsing': { fr: 'Analyse du fichier…', en: 'Parsing file…' },
  'loading.aggregating': { fr: 'Agrégation des données…', en: 'Aggregating data…' },

  // Général
  'general.close': { fr: 'Fermer', en: 'Close' },
  'general.loadFile': { fr: 'Chargez un fichier et assignez-lui un point de mesure', en: 'Load a file and assign it to a measurement point' },
  'general.waitingAssign': { fr: 'en attente d\'assignation', en: 'waiting for assignment' },
}

let currentLang: 'fr' | 'en' = 'fr'

export function setLanguage(lang: 'fr' | 'en') {
  currentLang = lang
}

export function getLanguage(): 'fr' | 'en' {
  return currentLang
}

export function t(key: string): string {
  return translations[key]?.[currentLang] ?? key
}
