/**
 * Détection des colonnes de spectre 1/3 d'octave nommées par leur fréquence
 * centrale (en-têtes « 6.3 », « 1000 », « 16000 », « 1k », « 1000 Hz »…).
 *
 * Les exports G4 récents (831C / 821SE) nomment chaque bande par sa fréquence
 * au lieu d'un bloc « LZeq… » contigu ou de positions fixes. Sans cette
 * détection, le spectre ressortait vide ou à une seule bande et le
 * spectrogramme s'écrasait en bande 1D. Helper partagé par les parsers
 * 831C / 821SE et le worker de parsing.
 */

/** Fréquences centrales 1/3 d'octave normalisées (CEI 61260), 6.3 Hz – 20 kHz. */
export const THIRD_OCTAVE_CENTERS: number[] = [
  6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150,
  4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

/**
 * Convertit un en-tête de colonne en fréquence centrale si — et seulement si —
 * son libellé est *essentiellement un nombre* dans [6, 20000] Hz (suffixe
 * d'unité k / kHz / Hz toléré). Retourne null sinon.
 *
 * Le préfixe alphabétique obligatoire des indices (« LAeq », « LCeq », « L10 »,
 * « L90 »…) les fait rejeter : seule une colonne nommée purement par un nombre
 * est considérée comme une bande de fréquence, conformément à la règle
 * « le nom est un nombre entre 6 et 20000 ».
 */
export function headerToFreq(header: unknown): number | null {
  const s = String(header ?? '').trim()
  if (!s) return null
  // Le nom doit être un nombre seul, éventuellement suivi de k / kHz / Hz.
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(k|khz)?\s*(hz)?$/i)
  if (!m) return null
  let val = parseFloat(m[1].replace(',', '.'))
  if (m[2]) val *= 1000 // suffixe k / kHz
  if (!Number.isFinite(val) || val < 6 || val > 20000) return null
  // Caler sur la bande normalisée la plus proche (tolérance ~6 % en log2) pour
  // garder des fréquences propres (axe Y, pondération A). Hors tolérance : on
  // conserve la valeur brute (toujours une bande valide au sens de la règle).
  let best = val
  let bestErr = Infinity
  for (const c of THIRD_OCTAVE_CENTERS) {
    const err = Math.abs(Math.log2(val / c))
    if (err < bestErr) { bestErr = err; best = c }
  }
  return bestErr <= 0.08 ? best : val
}

export interface FreqColumns {
  /** Indices de colonnes, triés par fréquence croissante. */
  cols: number[]
  /** Fréquences centrales correspondantes, même ordre que `cols`. */
  freqs: number[]
}

/**
 * Détecte les colonnes de spectre nommées par fréquence dans une ligne
 * d'en-têtes. Retourne null si moins de `minBands` bandes plausibles sont
 * trouvées (évite un faux positif sur une colonne isolée nommée « 100 »).
 */
export function detectFreqColumns(headers: unknown[], minBands = 6): FreqColumns | null {
  const found: Array<{ col: number; freq: number }> = []
  const seen = new Set<number>()
  headers.forEach((h, col) => {
    const f = headerToFreq(h)
    if (f !== null && !seen.has(f)) {
      seen.add(f)
      found.push({ col, freq: f })
    }
  })
  if (found.length < minBands) return null
  found.sort((a, b) => a.freq - b.freq)
  return { cols: found.map((x) => x.col), freqs: found.map((x) => x.freq) }
}

/**
 * Extrait le spectre d'une ligne de données à partir des colonnes détectées.
 * Renvoie un tableau aligné sur `cols.freqs` uniquement si TOUTES les cellules
 * sont finies (spectre complet) — sinon null, pour garantir l'alignement
 * bande↔fréquence sans introduire de trous (NaN) dans le heatmap.
 */
export function extractSpectrumRow(row: unknown[], cols: FreqColumns): number[] | null {
  const out: number[] = []
  for (const c of cols.cols) {
    const v = row[c]
    const num = typeof v === 'number' ? v : parseFloat(String(v))
    if (!Number.isFinite(num)) return null
    out.push(num)
  }
  return out
}
