/**
 * Feature flags — masquage temporaire de modules non finalisés.
 *
 * Chaque module lit son flag et se masque de la navigation si `false`.
 * Le code des modules reste intact : seul l'accès via les onglets est retiré.
 * Repasser un flag à `true` réaffiche l'onglet correspondant (aucune autre
 * modification nécessaire — la navigation est dérivée de ces flags).
 *
 * Voir src/App.tsx (SUBTABS + barre d'onglets primaires) pour le câblage.
 */
export const FEATURES = {
  carriere: false,
  calculLw: false,
  isolement: false,
  concordance: false,
  conformite: false,
  rapport: false,
  parcEcme: false,
  carte: false,
} as const
