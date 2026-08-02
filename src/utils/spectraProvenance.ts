/**
 * Libellés de PROVENANCE du spectre — partagés par l'UI (carte fichier,
 * spectrogramme, spectre instantané) et les exports.
 *
 * Rétention 10 ans : un spectre RECONSTRUIT (mesuré en dB(A) puis dépondéré
 * vers Z) doit rester distinguable d'un spectre MESURÉ en linéaire, longtemps
 * après que l'auteur du rapport ait oublié quel sonomètre exportait quoi. Une
 * source unique de libellés évite que l'écran et l'export ne se contredisent.
 */
import type { SpectraBlocker, SpectraSource } from '../types'

/** Libellé court (badge, en-tête de colonne d'export). */
export const SPECTRA_SOURCE_LABEL: Record<SpectraSource, string> = {
  'Z-natif': 'Spectre Z natif',
  'A-déponderé': 'Spectre A→Z',
}

/** Explication complète (title / infobulle). */
export const SPECTRA_SOURCE_HINT: Record<SpectraSource, string> = {
  'Z-natif': 'Bandes 1/3 d\'octave mesurées en pondération Z (linéaire) par le sonomètre.',
  'A-déponderé':
    'Bandes 1/3 d\'octave mesurées en dB(A) : le sonomètre n\'exporte pas de spectre Z. '
    + 'Le spectre affiché est RECONSTRUIT par dépondération LZ = LA − A(f) (table CEI 61672), '
    + 'exacte à la table mais dérivée d\'une mesure pondérée.',
}

/**
 * Motif de non-calculabilité — volontairement DISTINCT de « Aucune donnée
 * spectrale » : ici les bandes existent, c'est leur conversion qui est refusée.
 */
export const SPECTRA_BLOCKER_MESSAGE: Record<SpectraBlocker, string> = {
  'bande-hors-table':
    'Spectre non calculable : bandes mesurées en dB(A) dont au moins une n\'a pas de '
    + 'coefficient de pondération A normalisé (hors 6,3 Hz – 20 kHz). Le spectre n\'est pas '
    + 'reconstruit — aucune valeur n\'est inventée.',
}
