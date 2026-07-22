/**
 * Correctifs Note 98-01 — calcul par point + classification DIFFÉRENCIÉE des
 * causes d'indisponibilité.
 *
 * Deux affirmations distinctes ne doivent pas être confondues : un correctif
 * NUL (0,0 dB, sous la porte) et un correctif INDISPONIBLE (donnée manquante ou
 * invalide). Le filtre de sélection utilise `Number.isFinite` : une valeur non
 * finie (NaN, Infinity) ne produit PAS un correctif de 0 — elle produit
 * l'indisponibilité `invalid-values`.
 *
 * Doctrine `classifyEcccFailure` : `unknown` = filet, jamais un kind spécifique
 * par défaut.
 */
import {
  laeqAvg,
  computeKb9801,
  computeKi9801,
  computeLaftm5,
  analyzeKt9801,
  type KtAnalysis,
} from './acoustics'
import type { DataPoint } from '../types'

export type Corr9801Term = 'kt' | 'ki' | 'kb'

export type Corr9801Cause =
  | 'no-lceq'
  | 'no-lafmax'
  | 'no-spectrum'
  | 'invalid-values'
  | 'no-data'
  | 'unknown'

/** Faits d'entrée (déterminés au calcul, aucun recalcul de correctif). */
export interface Corr9801Facts {
  /** La fenêtre contient au moins un point de mesure. */
  hasData: boolean
  /** Kb : au moins une valeur LCeq de type number (finie OU non). */
  lceqPresent: boolean
  /** Kb : au moins une valeur LCeq FINIE. */
  lceqFinite: boolean
  /** Ki : au moins une valeur LAFmax de type number (finie OU non). */
  lafmaxPresent: boolean
  /** Ki : LAFTM5 null (aucune valeur LAFmax finie malgré présence). */
  laftm5IsNull: boolean
  /** Kt : au moins un spectre 1/3 d'octave présent. */
  spectrumPresent: boolean
  /** Kt : toutes les bandes du spectre moyen ont au moins une valeur finie. */
  spectrumValid: boolean
}

/**
 * Cause d'indisponibilité d'un terme (PURE). N'a de sens que si la valeur est
 * `null`. Un cas inattendu (tous les faits présents) → 'unknown'.
 */
export function classifyCorr9801(term: Corr9801Term, facts: Corr9801Facts): Corr9801Cause {
  if (!facts.hasData) return 'no-data'
  if (term === 'kb') {
    if (!facts.lceqPresent) return 'no-lceq'
    if (!facts.lceqFinite) return 'invalid-values'
    return 'unknown'
  }
  if (term === 'kt') {
    if (!facts.spectrumPresent) return 'no-spectrum'
    if (!facts.spectrumValid) return 'invalid-values'
    return 'unknown'
  }
  // ki
  if (!facts.lafmaxPresent) return 'no-lafmax'
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
      return `${t} indisponible — valeurs présentes mais non exploitables (non finies)`
    case 'no-data':
      return `${t} indisponible — aucune donnée sur la fenêtre sélectionnée`
    case 'unknown':
      return `${t} indisponible — cause inconnue`
  }
}

/** Détail 98-01 CONSERVÉ par terme (valeurs intermédiaires déjà calculées). */
export interface Corr9801TermDetail {
  value: number | null
  cause: Corr9801Cause | null
  /** LAeq (dBAvg) de la fenêtre ; null si aucune donnée. Commun aux 3 termes. */
  laeq: number | null
  /** Kb : LCeq conservé (écart LCeq−LAeq et porte 20 dB dérivés à l'affichage). */
  lceq?: number | null
  /** Ki : LAFTM5 conservé (écart LAFTM5−LAeq et porte 2 dBA dérivés à l'affichage). */
  laftm5?: number | null
  /** Kt : analyse spectrale complète (bandes, écarts, seuils 15/8/5, bande retenue). */
  analysis?: KtAnalysis | null
}

/**
 * Correctifs 98-01 d'un point, sur les points déjà filtrés (fenêtre + périodes).
 * Filtre `Number.isFinite` : NaN/Infinity ⇒ indisponible (`invalid-values`),
 * jamais un correctif de 0. Ne modifie AUCUNE valeur calculée sur données finies
 * (laeqAvg ignorait déjà les non-finies — seul le cas « tout non fini » change).
 */
export function computeCorr9801Point(
  dps: DataPoint[],
): Record<Corr9801Term, Corr9801TermDetail> {
  const hasData = dps.length > 0
  const laeqWin = hasData ? laeqAvg(dps.map((d) => d.laeq)) : 0
  const laeq = hasData ? laeqWin : null

  // ── Kb = LCeq − LAeq ──────────────────────────────────────────────────────
  const lceqNums = dps.map((d) => d.lceq).filter((v): v is number => typeof v === 'number')
  const lceqPresent = lceqNums.length > 0
  const lceqFin = lceqNums.filter((v) => Number.isFinite(v))
  const hasFiniteLceq = lceqFin.length > 0
  const lceq = hasFiniteLceq ? laeqAvg(lceqFin) : null
  const kbVal = hasFiniteLceq ? computeKb9801(lceq, laeqWin) : null

  // ── Ki = LAFTM5 − LAeq ────────────────────────────────────────────────────
  // Échantillons LAFmax HORODATÉS (t en minutes → secondes) : les blocs de 5 s
  // sont alignés sur la grille temporelle absolue, indépendamment du pas.
  const lafSamples = dps
    .filter((d): d is DataPoint & { lafmax: number } => typeof d.lafmax === 'number')
    .map((d) => ({ tSec: d.t * 60, lafmax: d.lafmax }))
  const lafmaxPresent = lafSamples.length > 0
  // computeLaftm5 filtre déjà Number.isFinite en interne (null si aucune finie).
  const laftm5 = lafmaxPresent ? computeLaftm5(lafSamples) : null
  const kiVal = lafmaxPresent && laftm5 !== null ? computeKi9801(laftm5, laeqWin) : null

  // ── Kt tonal ──────────────────────────────────────────────────────────────
  const specs = dps.map((d) => d.spectra).filter((s): s is number[] => Array.isArray(s))
  const spectrumPresent = specs.length > 0
  let ktAnalysis: KtAnalysis | null = null
  let spectrumValid = false
  if (spectrumPresent) {
    const nBands = specs[0].length
    const avgSpec: number[] = []
    spectrumValid = true
    for (let i = 0; i < nBands; i++) {
      const finiteBand = specs.map((s) => s[i]).filter((v): v is number => Number.isFinite(v))
      if (finiteBand.length === 0) {
        spectrumValid = false // une bande sans aucune valeur finie ⇒ spectre invalide
        break
      }
      avgSpec.push(laeqAvg(finiteBand))
    }
    if (spectrumValid) ktAnalysis = analyzeKt9801(avgSpec, laeqWin)
  }
  const ktVal = ktAnalysis ? ktAnalysis.kt : null

  const facts: Corr9801Facts = {
    hasData,
    lceqPresent,
    lceqFinite: hasFiniteLceq,
    lafmaxPresent,
    laftm5IsNull: laftm5 === null,
    spectrumPresent,
    spectrumValid,
  }
  const causeOf = (term: Corr9801Term, val: number | null): Corr9801Cause | null =>
    val === null ? classifyCorr9801(term, facts) : null

  return {
    kt: { value: ktVal, cause: causeOf('kt', ktVal), laeq, analysis: ktAnalysis },
    ki: { value: kiVal, cause: causeOf('ki', kiVal), laeq, laftm5 },
    kb: { value: kbVal, cause: causeOf('kb', kbVal), laeq, lceq },
  }
}
