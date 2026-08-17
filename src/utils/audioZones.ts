/**
 * Bandes de surbrillance audio du graphique LAeq.
 *
 * Transforme les plages de couverture audio (une par fichier chargé, produites
 * par `computeAudioCoverage`) en bandes prêtes à rendre : tronquées aux bornes
 * du graphique, puis fusionnées quand elles se chevauchent ou se touchent.
 *
 * Pourquoi fusionner : deux `ReferenceArea` superposées additionnent leurs
 * opacités. La partie commune apparaîtrait plus foncée que le reste sans
 * qu'aucune information ne le justifie, et masquerait la courbe LAeq.
 * `computeAudioCoverage` reste inchangé — la fusion est locale au rendu.
 *
 * Les unités sont celles de l'axe X du chart : minutes depuis minuit, avec
 * l'offset `dayIndex × 1440` déjà appliqué en mode multi-jours. Aucune
 * conversion n'est faite ici.
 */
import type { AudioCoverageRange } from '../hooks/useAudioSync'

export interface AudioZone {
  /** Clé React stable — identifiants des fichiers réunis dans cette bande */
  key: string
  /** Borne gauche, minutes axe X, déjà tronquée à la plage du graphique */
  x1: number
  /** Borne droite, minutes axe X, déjà tronquée */
  x2: number
  /** Fichiers couverts par la bande (1 seul, ou plusieurs après fusion) */
  entryIds: string[]
}

/**
 * Deux bandes séparées par moins que cet écart sont tenues pour jointives.
 *
 * Les fichiers d'une session contiguë sont calés par accumulation de durées
 * (`deriveStartTimesFromSequence`) : la fin de l'un et le début du suivant
 * peuvent différer d'un epsilon de flottant. 1e-9 minute = 60 nanosecondes,
 * ce n'est pas un trou dans l'enregistrement.
 */
const TOUCH_EPS = 1e-9

/**
 * @param coverage plages de couverture audio, dans l'ordre quelconque
 * @param fullRange bornes du graphique (minutes axe X)
 * @returns bandes tronquées et fusionnées, triées par borne gauche.
 *          Tableau vide si aucun fichier audio, ou si aucun ne recoupe la
 *          plage de mesure — l'appelant s'en sert pour ne rendre ni bande ni
 *          entrée de légende.
 */
export function buildAudioZones(
  coverage: AudioCoverageRange[],
  fullRange: { startMin: number; endMin: number },
): AudioZone[] {
  if (coverage.length === 0) return []

  // 1. Troncature aux bornes du graphique. Une plage entièrement hors champ
  //    est écartée ; l'axe n'est jamais étendu (cf. ifOverflow="hidden" côté
  //    rendu, qui couvre le cas du zoom).
  const clamped = coverage
    .filter((r) => r.endMin >= fullRange.startMin && r.startMin <= fullRange.endMin)
    .map((r) => ({
      x1: Math.max(fullRange.startMin, r.startMin),
      x2: Math.min(fullRange.endMin, r.endMin),
      entryId: r.entryId,
    }))
    // Une plage réduite à un point après troncature ne se voit pas : inutile
    // de la rendre, et elle fausserait la fusion.
    .filter((r) => r.x2 > r.x1)
    .sort((a, b) => a.x1 - b.x1)

  if (clamped.length === 0) return []

  // 2. Fusion des bandes qui se chevauchent ou se touchent. Les plages
  //    réellement disjointes restent distinctes.
  const zones: AudioZone[] = []
  let cur = {
    x1: clamped[0].x1,
    x2: clamped[0].x2,
    entryIds: [clamped[0].entryId],
  }
  for (let i = 1; i < clamped.length; i++) {
    const r = clamped[i]
    if (r.x1 <= cur.x2 + TOUCH_EPS) {
      // Chevauchement ou contact : on étend la bande courante. Math.max est
      // nécessaire — une plage courte peut être entièrement incluse dans une
      // plage longue qui la précède.
      cur.x2 = Math.max(cur.x2, r.x2)
      cur.entryIds.push(r.entryId)
    } else {
      zones.push({ ...cur, key: cur.entryIds.join('+') })
      cur = { x1: r.x1, x2: r.x2, entryIds: [r.entryId] }
    }
  }
  zones.push({ ...cur, key: cur.entryIds.join('+') })

  return zones
}
