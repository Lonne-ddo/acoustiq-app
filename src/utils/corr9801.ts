/**
 * Correctifs Note 98-01 — classification DIFFÉRENCIÉE des causes d'indisponibilité.
 *
 * Aujourd'hui kt/ki/kb valent `null` pour des raisons distinctes mais l'UI
 * affiche « indispo » avec un libellé unique — même défaut que le message ECCC
 * trompeur. Cette fonction PURE mappe les faits d'entrée (déjà connus au site de
 * calcul, cf. IndicesPanel.corr9801ByPoint) vers une cause typée + un libellé
 * acousticien. Doctrine `classifyEcccFailure` : `unknown` = filet, jamais un
 * kind spécifique par défaut.
 *
 * Causes réelles produites par le code (recon) :
 *   - Kb null ⟺ LCeq absent            → 'no-lceq'
 *   - Ki null ⟺ LAFmax absent          → 'no-lafmax'
 *          OU ⟺ LAFmax présent mais LAFTM5 null (valeurs non finies) → 'invalid-values'
 *   - Kt null ⟺ spectre 1/3 d'octave absent → 'no-spectrum'
 *   - fenêtre vide (les 3 null)         → 'no-data'   [ajouté hors liste initiale]
 */

export type Corr9801Term = 'kt' | 'ki' | 'kb'

export type Corr9801Cause =
  | 'no-lceq'
  | 'no-lafmax'
  | 'no-spectrum'
  | 'invalid-values'
  | 'no-data'
  | 'unknown'

/** Faits d'entrée connus au site de calcul (aucun recalcul de correctif). */
export interface Corr9801Facts {
  /** La fenêtre contient au moins un point de mesure. */
  hasData: boolean
  /** Au moins une valeur LCeq numérique (Kb). */
  hasLceq: boolean
  /** Au moins une valeur LAFmax numérique (Ki). */
  hasLafmax: boolean
  /** LAFTM5 est null alors que des LAFmax existaient (valeurs non finies). */
  laftm5IsNull: boolean
  /** Au moins un spectre 1/3 d'octave (Kt). */
  hasSpectrum: boolean
}

/**
 * Cause d'indisponibilité d'un terme (PURE). N'a de sens que lorsque la valeur
 * du terme est `null`. Un cas inattendu (tous les faits présents) → 'unknown',
 * jamais un kind spécifique.
 */
export function classifyCorr9801(term: Corr9801Term, facts: Corr9801Facts): Corr9801Cause {
  if (!facts.hasData) return 'no-data'
  if (term === 'kb') return facts.hasLceq ? 'unknown' : 'no-lceq'
  if (term === 'kt') return facts.hasSpectrum ? 'unknown' : 'no-spectrum'
  // ki
  if (!facts.hasLafmax) return 'no-lafmax'
  if (facts.laftm5IsNull) return 'invalid-values'
  return 'unknown'
}

const TERM_LABEL: Record<Corr9801Term, string> = { kt: 'Kt', ki: 'Ki', kb: 'Kb' }

/** Libellé acousticien : ce qui manque + comment agir (réexport depuis G4). */
export function corr9801CauseMessage(term: Corr9801Term, cause: Corr9801Cause): string {
  const t = TERM_LABEL[term]
  switch (cause) {
    case 'no-lceq':
      return `${t} indisponible — LCeq absent du fichier source`
    case 'no-lafmax':
      return `${t} indisponible — LAFmax 1 s absent du fichier source`
    case 'no-spectrum':
      return `${t} indisponible — spectre 1/3 d'octave absent du fichier source`
    case 'invalid-values':
      return `${t} indisponible — LAFmax 1 s présent mais sans valeur exploitable`
    case 'no-data':
      return `${t} indisponible — aucune donnée sur la fenêtre sélectionnée`
    case 'unknown':
      return `${t} indisponible — cause inconnue`
  }
}
