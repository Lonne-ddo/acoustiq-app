/**
 * Utilitaires de calcul acoustique
 */

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
 * Calcule la moyenne énergétique (LAeq) d'un tableau de niveaux en dB
 */
export function laeqAvg(values: number[]): number {
  if (values.length === 0) return 0
  const sum = values.reduce((acc, v) => acc + Math.pow(10, v / 10), 0)
  return 10 * Math.log10(sum / values.length)
}

/**
 * Calcule le percentile Lx à partir d'un tableau de niveaux en dB
 * @param values - tableau de niveaux dB
 * @param percentile - percentile souhaité (ex: 90 pour L90)
 */
function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0
  // Tri croissant : L90 = niveau dépassé 90% du temps (bruit de fond, valeur basse)
  // L10 = niveau dépassé 10% du temps (pointes, valeur haute)
  const sorted = [...values].sort((a, b) => a - b)
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
 * Retourne le niveau maximum instantané (LAFmax)
 */
export function computeLAFmax(values: number[]): number {
  if (values.length === 0) return 0
  return Math.max(...values)
}

/**
 * Retourne le niveau minimum instantané (LAFmin)
 */
export function computeLAFmin(values: number[]): number {
  if (values.length === 0) return 0
  return Math.min(...values)
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
 * Centres des bandes de tiers d'octave (Hz), à partir de 6.3 Hz.
 * Aligné sur l'ordre des spectres LZeq fournis par les sonomètres
 * SoundAdvisor 831C / SoundExpert 821SE.
 */
export const THIRD_OCTAVE_CENTERS: number[] = [
  6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250,
  315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300,
  8000, 10000, 12500, 16000, 20000,
]

/**
 * Seuil d'émergence tonale (dB) appliqué à une bande donnée selon sa fréquence.
 * Tableau extrait des Lignes directrices MELCCFP 2026 (méthode 1/3 d'octave).
 */
function tonalThresholdForCenter(fc: number): number {
  if (fc <= 125) return 15
  if (fc <= 400) return 8
  return 5
}

/**
 * Résultat détaillé de la détection tonale Kt — utilisé par l'UI pour afficher
 * la bande qui a déclenché la correction et son émergence.
 */
export interface KtDetection {
  /** Correction tonale en dB (0 ou 5) */
  kt: number
  /** Vrai si une composante tonale a été détectée */
  detected: boolean
  /** Index de la bande tonale dans le spectre fourni (null si rien) */
  bandIndex: number | null
  /** Fréquence centrale de la bande tonale (Hz, null si rien) */
  fc: number | null
  /** Émergence (dB) au-dessus de la plus haute des deux bandes adjacentes */
  emergence: number | null
  /** Seuil appliqué pour la bande déclenchante (dB) */
  threshold: number | null
}

/**
 * Détermine si une composante tonale est présente dans un spectre 1/3 d'octave
 * (LZeq, dB) et retourne un descripteur de détection complet.
 *
 * Critère MELCCFP 2026 (Tableau 2) : une bande est tonale lorsqu'elle dépasse
 * ses DEUX bandes adjacentes d'au moins :
 *   - 15 dB pour fc ≤ 125 Hz
 *   - 8  dB pour 160 Hz ≤ fc ≤ 400 Hz
 *   - 5  dB pour fc ≥ 500 Hz
 *
 * Exception : aucune correction n'est appliquée si le niveau de la bande
 * tonale est ≥ 15 dB en-dessous du niveau global pondéré A (laeqA).
 *
 * @param spectrum - niveaux LZeq par bande de tiers d'octave (dB)
 * @param laeqA    - niveau global A-pondéré sur la même période (optionnel —
 *                   nécessaire pour appliquer l'exception « tonal masqué »)
 */
export function detectKt(spectrum: number[], laeqA?: number | null): KtDetection {
  const empty: KtDetection = {
    kt: 0, detected: false, bandIndex: null, fc: null, emergence: null, threshold: null,
  }
  if (!spectrum || spectrum.length < 3) return empty

  let best: KtDetection | null = null

  for (let i = 1; i < spectrum.length - 1; i++) {
    const fc = THIRD_OCTAVE_CENTERS[i]
    if (fc === undefined) continue
    const threshold = tonalThresholdForCenter(fc)
    const lvl = spectrum[i]
    const left = spectrum[i - 1]
    const right = spectrum[i + 1]
    const minDelta = Math.min(lvl - left, lvl - right)
    if (minDelta < threshold) continue

    // Exception : bande tonale ≥ 15 dB sous le LAeq global → pas de correction
    if (typeof laeqA === 'number' && Number.isFinite(laeqA) && laeqA - lvl >= 15) {
      continue
    }

    // Garde la plus saillante (plus grande émergence relative au seuil)
    const emergence = minDelta
    if (!best || emergence - threshold > (best.emergence! - best.threshold!)) {
      best = { kt: 5, detected: true, bandIndex: i, fc, emergence, threshold }
    }
  }
  return best ?? empty
}

/**
 * Variante historique : retourne uniquement la valeur Kt (0 ou 5).
 * Conservée pour la compatibilité ascendante.
 */
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
