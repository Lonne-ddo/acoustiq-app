/**
 * Utilitaires de calcul acoustique
 */
import type { Period } from '../types'

/**
 * Détecte des candidats d'événement = montées de LAeq ≥ `minDeltaDb`
 * sur une fenêtre glissante de `windowSec` secondes.
 *
 * Retourne pour chaque pic une heure HH:MM, le delta dB par rapport au
 * minimum de la fenêtre et la valeur LAeq au pic. Anti-doublons : un nouvel
 * événement n'est émis qu'après `windowSec` depuis le précédent.
 */
export function detectRisingEvents(
  data: Array<{ t: number; laeq: number }>,
  options: { minDeltaDb?: number; windowSec?: number } = {},
): Array<{ time: string; delta: number; laeq: number; tMin: number }> {
  const minDelta = options.minDeltaDb ?? 6
  const windowSec = options.windowSec ?? 60
  const windowMin = windowSec / 60

  if (data.length < 2) return []
  const sorted = [...data].sort((a, b) => a.t - b.t)

  const out: Array<{ time: string; delta: number; laeq: number; tMin: number }> = []
  let lo = 0
  let lastEmittedT = -Infinity

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]
    // Avancer la borne basse pour respecter la fenêtre
    while (lo < i && sorted[lo].t < cur.t - windowMin) lo++
    if (lo === i) continue
    // min LAeq dans [lo, i-1]
    let minVal = Infinity
    for (let j = lo; j < i; j++) {
      if (sorted[j].laeq < minVal) minVal = sorted[j].laeq
    }
    const delta = cur.laeq - minVal
    if (delta >= minDelta && cur.t - lastEmittedT >= windowMin) {
      const h = Math.floor(cur.t / 60) % 24
      const m = Math.floor(cur.t % 60)
      const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      out.push({ time, delta, laeq: cur.laeq, tMin: cur.t })
      lastEmittedT = cur.t
    }
  }

  return out
}

/**
 * Détection d'événements acoustiquement significatifs sur la base d'une
 * émergence par rapport au bruit de fond local (moyenne glissante 60 s).
 *
 * Algorithme :
 *   1. Pour chaque instant t, calcul d'une moyenne énergétique glissante
 *      sur ±baselineSec/2 secondes (bruit de fond local).
 *   2. Marque les instants où LAeq − baseline ≥ emergenceDb.
 *   3. Conserve les runs continus de durée ≥ minDurationSec.
 *   4. Fusionne deux runs séparés de moins de mergeGapSec.
 *   5. Caractérise chaque événement (LAeq énergétique, LAFmax, émergence).
 *
 * Les données doivent être échantillonnées à 1 s (typique 831C/821SE).
 */
export interface DetectedEvent {
  /** Heure de début HH:MM */
  time: string
  /** Heure de fin HH:MM */
  endTime: string
  /** Minutes depuis minuit (début/fin) */
  tStartMin: number
  tEndMin: number
  /** Durée en secondes */
  durationSec: number
  /** LAeq énergétique sur l'événement (dB(A)) */
  laeq: number
  /** LAFmax sur l'événement (dB(A)) */
  lafmax: number
  /** Bruit de fond local moyen (dB(A)) */
  baseline: number
  /** Émergence (dB) = laeq − baseline */
  emergence: number
}

function fmtHHMM(tMin: number): string {
  const h = Math.floor(tMin / 60) % 24
  const m = Math.floor(tMin % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function detectEmergenceEvents(
  data: Array<{ t: number; laeq: number }>,
  options: {
    /** Seuil d'émergence en dB (défaut 6) */
    emergenceDb?: number
    /** Durée minimale d'émergence continue en s (défaut 10) */
    minDurationSec?: number
    /** Fusion d'événements séparés de moins de N s (défaut 30) */
    mergeGapSec?: number
    /** Fenêtre de calcul du bruit de fond en s (défaut 60) */
    baselineSec?: number
  } = {},
): DetectedEvent[] {
  const emergenceDb = options.emergenceDb ?? 6
  const minDurationSec = options.minDurationSec ?? 10
  const mergeGapSec = options.mergeGapSec ?? 30
  const baselineSec = options.baselineSec ?? 60

  if (data.length < 2) return []
  const sorted = [...data]
    .filter((d) => Number.isFinite(d.t) && Number.isFinite(d.laeq))
    .sort((a, b) => a.t - b.t)
  if (sorted.length < 2) return []

  const halfWinMin = baselineSec / 2 / 60

  // Baseline énergétique glissante (fenêtre ±halfWin) — O(n) avec deux pointeurs.
  const baseline = new Array<number>(sorted.length)
  let lo = 0
  let hi = 0
  let sumLin = 0
  for (let i = 0; i < sorted.length; i++) {
    const tMin = sorted[i].t
    while (hi < sorted.length && sorted[hi].t <= tMin + halfWinMin) {
      sumLin += Math.pow(10, sorted[hi].laeq / 10)
      hi++
    }
    while (lo < hi && sorted[lo].t < tMin - halfWinMin) {
      sumLin -= Math.pow(10, sorted[lo].laeq / 10)
      lo++
    }
    const n = hi - lo
    baseline[i] = n > 0 ? 10 * Math.log10(sumLin / n) : sorted[i].laeq
  }

  // Détection des runs : segments contigus où laeq − baseline ≥ emergenceDb.
  // Tolérance de continuité : on autorise un trou < 2 s (échantillonnage 1 s).
  type Run = { iStart: number; iEnd: number }
  const runs: Run[] = []
  let cur: Run | null = null
  for (let i = 0; i < sorted.length; i++) {
    const above = sorted[i].laeq - baseline[i] >= emergenceDb
    if (above) {
      if (!cur) cur = { iStart: i, iEnd: i }
      else cur.iEnd = i
    } else if (cur) {
      runs.push(cur)
      cur = null
    }
  }
  if (cur) runs.push(cur)

  // Filtre par durée minimale
  const longEnough = runs.filter((r) => {
    const durSec = (sorted[r.iEnd].t - sorted[r.iStart].t) * 60
    return durSec >= minDurationSec
  })

  // Fusion des runs proches
  const merged: Run[] = []
  for (const r of longEnough) {
    const last = merged[merged.length - 1]
    if (last) {
      const gapSec = (sorted[r.iStart].t - sorted[last.iEnd].t) * 60
      if (gapSec < mergeGapSec) {
        last.iEnd = r.iEnd
        continue
      }
    }
    merged.push({ ...r })
  }

  // Caractérisation
  const out: DetectedEvent[] = []
  for (const r of merged) {
    let sumLin2 = 0
    let maxL = -Infinity
    let sumBaseLin = 0
    let n = 0
    for (let i = r.iStart; i <= r.iEnd; i++) {
      sumLin2 += Math.pow(10, sorted[i].laeq / 10)
      sumBaseLin += Math.pow(10, baseline[i] / 10)
      if (sorted[i].laeq > maxL) maxL = sorted[i].laeq
      n++
    }
    if (n === 0) continue
    const laeq = 10 * Math.log10(sumLin2 / n)
    const baseAvg = 10 * Math.log10(sumBaseLin / n)
    const tStartMin = sorted[r.iStart].t
    const tEndMin = sorted[r.iEnd].t
    const durationSec = Math.max(1, Math.round((tEndMin - tStartMin) * 60))
    out.push({
      time: fmtHHMM(tStartMin),
      endTime: fmtHHMM(tEndMin),
      tStartMin,
      tEndMin,
      durationSec,
      laeq,
      lafmax: maxL,
      baseline: baseAvg,
      emergence: laeq - baseAvg,
    })
  }

  return out
}

/**
 * Convertit une date ISO (YYYY-MM-DD) et un temps en minutes depuis minuit
 * en timestamp epoch ms (fuseau local du navigateur).
 */
export function dpTimestampMs(isoDate: string, tMinutes: number): number {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return NaN
  const d = new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
  )
  return d.getTime() + tMinutes * 60_000
}

/** Période pour filtrage (sous-ensemble de src/types Period). */
interface PeriodFilter {
  startMs: number
  endMs: number
  status: 'include' | 'exclude'
}

/**
 * Vrai si au moins un intervalle [startMs, endMs) d'une liste de périodes
 * contient `tsMs`.
 */
function anyRangeContains(ranges: PeriodFilter[], tsMs: number): boolean {
  for (const r of ranges) {
    if (tsMs >= r.startMs && tsMs < r.endMs) return true
  }
  return false
}

/**
 * Filtre un tableau de DataPoints selon une liste de périodes.
 *
 * Règle de sélection :
 *   - Aucune période → garde tout (comportement par défaut).
 *   - Uniquement « exclude » → garde tout SAUF ce qui tombe dans un exclude.
 *   - Au moins une « include » → garde uniquement ce qui est dans un include,
 *     puis retire les points tombant aussi dans un exclude (intersection).
 *
 * `isoDate` est la date du fichier (YYYY-MM-DD). `tMinutes` est dp.t.
 * Le filtre ne dépend pas de dp.t modulo 1440 : les périodes multi-jours
 * sont gérées nativement par l'epoch ms.
 */
export function filterDataByPeriods<T extends { t: number }>(
  data: T[],
  isoDate: string,
  periods: Period[] | undefined | null,
): T[] {
  if (!periods || periods.length === 0) return data
  const includes: PeriodFilter[] = []
  const excludes: PeriodFilter[] = []
  for (const p of periods) {
    const rng: PeriodFilter = { startMs: p.startMs, endMs: p.endMs, status: p.status }
    if (p.status === 'include') includes.push(rng)
    else excludes.push(rng)
  }
  if (includes.length === 0 && excludes.length === 0) return data

  const baseMs = dpTimestampMs(isoDate, 0)
  if (!Number.isFinite(baseMs)) return data

  return data.filter((dp) => {
    const ts = baseMs + dp.t * 60_000
    if (includes.length > 0) {
      if (!anyRangeContains(includes, ts)) return false
    }
    if (anyRangeContains(excludes, ts)) return false
    return true
  })
}

/**
 * Calcule la moyenne énergétique (LAeq) d'un tableau de niveaux en dB.
 * Filtre les valeurs NaN/null/Infinity en amont (robustesse parsing).
 */
export function laeqAvg(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length === 0) return 0
  const sum = valid.reduce((acc, v) => acc + Math.pow(10, v / 10), 0)
  return 10 * Math.log10(sum / valid.length)
}

/**
 * Calcule le percentile Lx à partir d'un tableau de niveaux en dB.
 * Filtre les valeurs NaN/null/Infinity en amont.
 *
 * @param values - tableau de niveaux dB
 * @param percentile - percentile souhaité (ex: 90 pour L90)
 */
function computePercentile(values: number[], percentile: number): number {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length === 0) return 0
  // Tri croissant : L90 = niveau dépassé 90% du temps (bruit de fond, valeur basse)
  // L10 = niveau dépassé 10% du temps (pointes, valeur haute)
  const sorted = [...valid].sort((a, b) => a - b)
  const index = Math.round((percentile / 100) * (sorted.length - 1))
  return sorted[index]
}

/**
 * Calcule le L90 (niveau de bruit résiduel) d'un tableau de niveaux en dB
 */
export function computeL90(values: number[]): number {
  return computePercentile(values, 90)
}

/**
 * Calcule le L10 (niveau de bruit de pointe) d'un tableau de niveaux en dB
 */
export function computeL10(values: number[]): number {
  return computePercentile(values, 10)
}

/**
 * Calcule le L50 (niveau médian) d'un tableau de niveaux en dB
 */
export function computeL50(values: number[]): number {
  return computePercentile(values, 50)
}

/**
 * Calcule la puissance acoustique Lw à partir d'un niveau de pression Lp
 * en champ libre sphérique (atténuation géométrique 6 dB/doublement de distance)
 * @param lp - niveau de pression acoustique en dB(A)
 * @param d  - distance source-récepteur en mètres
 */
export function attenuationFreeField(lp: number, d: number): number {
  return lp + 20 * Math.log10(d) + 11
}

/**
 * Retourne le niveau maximum instantané (LAFmax). Filtre NaN/null/Infinity.
 */
export function computeLAFmax(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length === 0) return 0
  return Math.max(...valid)
}

/**
 * Retourne le niveau minimum instantané (LAFmin). Filtre NaN/null/Infinity.
 */
export function computeLAFmin(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length === 0) return 0
  return Math.min(...valid)
}

/**
 * Calcule la contribution de la source à partir du niveau total et du bruit résiduel
 * Lsource = 10*log10(10^(Ltotal/10) - 10^(Lresiduel/10))
 * Retourne null si le calcul est impossible (résiduel >= total)
 */
export function sourceContribution(lTotal: number, lResidual: number): number | null {
  const diff = Math.pow(10, lTotal / 10) - Math.pow(10, lResidual / 10)
  if (diff <= 0) return null
  return 10 * Math.log10(diff)
}

/* ============================================================================
 * Lignes directrices MELCCFP 2026 — Bruit environnemental
 * En vigueur depuis le 13 janvier 2026 (remplace la NI 98-01)
 * ========================================================================== */

/**
 * Extraction du bruit particulier (Bp) à partir du bruit ambiant (Ba) et du
 * bruit résiduel (Br), méthode énergétique.
 *
 *     Bp = 10·log10( 10^(Ba/10) − 10^(Br/10) )
 *
 * Conformément aux lignes directrices, l'extraction n'est valide que si
 * Ba − Br ≥ 3 dB. En deçà, le bruit particulier ne peut pas être isolé du
 * bruit résiduel et la fonction retourne null.
 */
export function extractBp(ba: number, br: number): number | null {
  if (ba - br < 3) return null
  const diff = Math.pow(10, ba / 10) - Math.pow(10, br / 10)
  if (diff <= 0) return null
  return 10 * Math.log10(diff)
}

/**
 * Centres des bandes de tiers d'octave (Hz) — alignement complet 6.3 Hz → 20 kHz.
 * L'export 831C fournit les colonnes 41–67 = 27 bandes commençant à 50 Hz
 * (sous-ensemble des 27 dernières bandes de cette table). On conserve cette
 * constante pour l'affichage du spectrogramme uniquement.
 */
export const THIRD_OCTAVE_CENTERS: number[] = [
  6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250,
  315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300,
  8000, 10000, 12500, 16000, 20000,
]

/**
 * Bandes 1/3 d'octave utilisées pour l'analyse tonale Kt — Lignes directrices
 * MELCCFP 2026, Tableau 2 (50 Hz → 10 kHz, 24 bandes). Les bandes au-dessus de
 * 10 kHz sont exclues par la méthode et ignorées même si présentes dans le
 * spectre brut.
 *
 * L'index 0 correspond exactement au premier élément du `spectra[]` parsé
 * depuis le 831C (col 41 du Time History).
 */
export const KT_BAND_FREQS: number[] = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
  500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
  5000, 6300, 8000, 10000,
]

/**
 * Pondération A (dB) — décalages à appliquer aux niveaux LZeq pour obtenir
 * les niveaux LAeq par bande. Référence ANSI S1.4 / IEC 61672.
 */
export const A_WEIGHT: Record<number, number> = {
  31.5: -39.4, 40: -34.6,
  50: -30.2, 63: -26.2, 80: -22.5, 100: -19.1, 125: -16.1,
  160: -13.4, 200: -10.9, 250: -8.6, 315: -6.6, 400: -4.8,
  500: -3.2, 630: -1.9, 800: -0.8, 1000: 0.0, 1250: 0.6,
  1600: 1.0, 2000: 1.2, 2500: 1.3, 3150: 1.2, 4000: 1.0,
  5000: 0.5, 6300: -0.1, 8000: -1.1, 10000: -2.5,
}

/**
 * Seuil d'émergence tonale Kt (dB) appliqué selon le centre de bande.
 * Tableau 2 — Lignes directrices MELCCFP 2026, Section 3.7.4.
 */
function ktThreshold(fc: number): number {
  if (fc <= 125) return 15
  if (fc <= 400) return 8
  return 5
}

/** Détail d'analyse tonale par bande 1/3 d'octave (pour affichage UI). */
export interface KtBandRow {
  /** Fréquence centrale (Hz) */
  freq: number
  /** Niveau LZeq de la bande (dB) */
  lzeq: number
  /** Niveau LAeq équivalent de la bande (dB(A)) = LZeq + A-weight */
  laeqBand: number
  /** Δ avec la bande précédente (dB) — null si bande de bord (i = 0) */
  diffPrev: number | null
  /** Δ avec la bande suivante (dB) — null si bande de bord (i = dernière) */
  diffNext: number | null
  /** Seuil d'émergence applicable (dB) */
  threshold: number
  /** Vrai si bande de bord (Δ non calculable) */
  isBoundary: boolean
  /** Vrai si la bande est exclue par l'exception (LAeq global − LAeq_band ≥ 15 dB) */
  excluded: boolean
  /** Vrai si la bande déclenche la correction Kt = 5 dB */
  isTonal: boolean
}

/** Résultat complet de l'analyse spectrale Kt. */
export interface KtAnalysis {
  /** Une ligne par bande analysée (24 bandes au maximum) */
  bands: KtBandRow[]
  /** Correction tonale finale (0 ou 5 dB) */
  kt: number
  /** Index dans `bands` de la première bande tonale, ou null */
  triggeringIndex: number | null
}

/**
 * Analyse complète de la composante tonale Kt — Lignes directrices MELCCFP
 * 2026, Section 3.7.4 et Tableau 2 (méthode 1/3 d'octave). Travaille sur 24
 * bandes 1/3 d'octave de 50 Hz à 10 kHz.
 *
 * Algorithme par bande :
 *   diffPrev = LZeq[i] − LZeq[i−1]   (null si i = 0)
 *   diffNext = LZeq[i] − LZeq[i+1]   (null si i = dernière bande)
 *   isBoundary = diffPrev === null OR diffNext === null
 *   LAeq_band = LZeq + A_WEIGHT[freq]
 *   excluded  = (LAeq_global − LAeq_band) ≥ 15 dB
 *   isTonal   = !isBoundary && diffPrev ≥ seuil && diffNext ≥ seuil && !excluded
 *
 * Résultat : Kt = 5 dB si AU MOINS UNE bande est tonale, sinon Kt = 0.
 *
 * @param spectrum    spectres LZeq par bande 1/3 d'octave (dB), aligné sur
 *                    `KT_BAND_FREQS` (le spectre 831C démarre à 50 Hz).
 *                    Les valeurs au-delà de 10 kHz sont ignorées.
 * @param globalLAeq  niveau global pondéré A de la période (dB(A)), pour
 *                    appliquer l'exception « bande masquée ».
 */
export function analyzeKt(spectrum: number[], globalLAeq: number): KtAnalysis {
  const bands: KtBandRow[] = []
  if (!spectrum || spectrum.length === 0) {
    return { bands, kt: 0, triggeringIndex: null }
  }
  const N = Math.min(KT_BAND_FREQS.length, spectrum.length)

  for (let i = 0; i < N; i++) {
    const freq = KT_BAND_FREQS[i]
    const lzeq = spectrum[i]
    const aw = A_WEIGHT[freq] ?? 0
    const laeqBand = lzeq + aw
    const threshold = ktThreshold(freq)
    const diffPrev = i === 0 ? null : lzeq - spectrum[i - 1]
    const diffNext = i === N - 1 ? null : lzeq - spectrum[i + 1]
    const isBoundary = diffPrev === null || diffNext === null
    const excluded =
      Number.isFinite(globalLAeq) && globalLAeq - laeqBand >= 15
    const isTonal =
      !isBoundary &&
      (diffPrev as number) >= threshold &&
      (diffNext as number) >= threshold &&
      !excluded

    bands.push({
      freq, lzeq, laeqBand, diffPrev, diffNext, threshold,
      isBoundary, excluded, isTonal,
    })
  }

  const triggering = bands.findIndex((b) => b.isTonal)
  return {
    bands,
    kt: triggering >= 0 ? 5 : 0,
    triggeringIndex: triggering >= 0 ? triggering : null,
  }
}

/**
 * Détection compacte de Kt — première bande tonale, fréquence et émergence.
 * Wrapper sur `analyzeKt` pour les cas où on veut juste un résumé d'une ligne.
 */
export interface KtDetection {
  kt: number
  detected: boolean
  bandIndex: number | null
  fc: number | null
  /** Plus petite des deux émergences (Δ préc., Δ suiv.) en dB */
  emergence: number | null
  threshold: number | null
}

export function detectKt(spectrum: number[], laeqA?: number | null): KtDetection {
  const empty: KtDetection = {
    kt: 0, detected: false, bandIndex: null, fc: null, emergence: null, threshold: null,
  }
  if (!spectrum || spectrum.length === 0) return empty
  const analysis = analyzeKt(
    spectrum,
    typeof laeqA === 'number' && Number.isFinite(laeqA) ? laeqA : -Infinity,
  )
  if (analysis.triggeringIndex === null) return empty
  const b = analysis.bands[analysis.triggeringIndex]
  const emergence = Math.min(b.diffPrev as number, b.diffNext as number)
  return {
    kt: 5,
    detected: true,
    bandIndex: analysis.triggeringIndex,
    fc: b.freq,
    emergence,
    threshold: b.threshold,
  }
}

/** Variante historique : ne retourne que la valeur Kt (0 ou 5). */
export function computeKt(spectrum: number[], laeqA?: number | null): number {
  return detectKt(spectrum, laeqA).kt
}

/**
 * Terme correctif basses fréquences Kb (Lignes directrices MELCCFP 2026).
 * Kb = 5 dB lorsque LCeq − LAeq ≥ 20 dB sur la période évaluée.
 */
export function computeKb(lceq: number, laeq: number): number {
  return lceq - laeq >= 20 ? 5 : 0
}

/**
 * Terme correctif d'impulsivité Ki (méthode 1, DIN 45645-1).
 *     Ki = LAFTeq − LAeq    (≥ 0)
 * Conformément aux lignes directrices MELCCFP 2026, Ki n'est appliqué que
 * lorsqu'il est strictement supérieur à 2 dB. Sinon, retourne 0.
 *
 * @param laftEq - niveau équivalent à pondération temporelle "Impulse" (dB(A))
 * @param laeq   - niveau équivalent à pondération temporelle "Fast" (dB(A))
 */
export function computeKi(laftEq: number, laeq: number): number {
  const ki = laftEq - laeq
  return ki > 2 ? ki : 0
}

/**
 * Niveau acoustique d'évaluation horaire LAr,1h selon les Lignes directrices
 * MELCCFP 2026 :
 *
 *     LAr,1h = Bp + max(Kt, Ki, Kb, Ks)
 *
 * Seul le terme correctif le plus élevé est appliqué (et non leur somme).
 *
 * @param bp - bruit particulier (dB(A))
 * @param kt - correction tonale
 * @param ki - correction d'impulsivité
 * @param kb - correction basses fréquences
 * @param ks - correction subjective / spécifique (manuelle)
 */
export function computeLar1h(
  bp: number,
  kt: number,
  ki: number,
  kb: number,
  ks: number,
): number {
  return bp + Math.max(kt, ki, kb, ks)
}
