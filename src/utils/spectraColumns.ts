/**
 * Détection des colonnes de spectre 1/3 (et 1/1) d'octave dans les exports G4
 * des sonomètres Larson Davis (831C / 821SE).
 *
 * Les en-têtes réels sont préfixés par le type de spectre et la fréquence
 * centrale, p. ex. :
 *   « 1/3 LZeq 6.3 », « 1/3 LZeq 1000 », « 1/3 LZFmax 6.3 », « 1/1 LZeq 8.0 »…
 *
 * Priorité de sélection du jeu de bandes « Leq » :
 *   1. 1/3 LZeq  (tiers d'octave — standard acoustique, 36 bandes)
 *   2. 1/1 LZeq  (octave — 12 bandes, fallback)
 *   3. colonne nommée par un nombre seul (autres exports)
 *
 * Le jeu LZFmax correspondant (mêmes fréquences) est également repéré pour
 * alimenter `DataPoint.spectraMax` (utile au panneau « Spectre instantané »).
 */

export type SpectrumColType =
  | '1/3 LZeq' | '1/3 LZFmax' | '1/3 LZFmin'
  | '1/1 LZeq' | '1/1 LZFmax'
  | 'number'

/**
 * Reconnaît un en-tête de colonne de spectre et en extrait le type + la
 * fréquence centrale. Retourne `{ type: null }` si l'en-tête n'est pas une
 * bande de spectre (LAeq, LCeq, L90, Date/heure…).
 */
export function parseSpectrumColumn(header: unknown): { type: SpectrumColType | null; freq: number | null } {
  const s = String(header ?? '').trim()
  if (!s) return { type: null, freq: null }
  const patterns: Array<{ regex: RegExp; type: SpectrumColType }> = [
    // Tiers d'octave (1/3) — EN + variante FR « 1/3 Leq Z »
    { regex: /^1\/3\s+LZeq\s+([\d.]+)$/i, type: '1/3 LZeq' },
    { regex: /^1\/3\s+Leq\s*Z\s+([\d.]+)$/i, type: '1/3 LZeq' },
    { regex: /^1\/3\s+LZF?max\s+([\d.]+)$/i, type: '1/3 LZFmax' },
    { regex: /^1\/3\s+LZF?min\s+([\d.]+)$/i, type: '1/3 LZFmin' },
    // Octave (1/1)
    { regex: /^1\/1\s+LZeq\s+([\d.]+)$/i, type: '1/1 LZeq' },
    { regex: /^1\/1\s+Leq\s*Z\s+([\d.]+)$/i, type: '1/1 LZeq' },
    { regex: /^1\/1\s+LZF?max\s+([\d.]+)$/i, type: '1/1 LZFmax' },
    // Fallback : nom = juste un nombre (avec suffixe k/Hz toléré)
    { regex: /^([\d.]+)\s*k?\s*(?:hz)?$/i, type: 'number' },
  ]
  for (const p of patterns) {
    const m = s.match(p.regex)
    if (m) {
      let freq = parseFloat(m[1])
      if (/k/i.test(s) && !/^1\/[13]/.test(s)) freq *= 1000 // « 1k » / « 16k »
      if (Number.isFinite(freq) && freq >= 6 && freq <= 20000) return { type: p.type, freq }
    }
  }
  return { type: null, freq: null }
}

export interface FreqColumns {
  /** Indices de colonnes du jeu Leq, triés par fréquence croissante. */
  cols: number[]
  /** Fréquences centrales correspondantes (même ordre que `cols`). */
  freqs: number[]
  /** Indices de colonnes LZFmax alignés sur `freqs` (si présents). */
  maxCols?: number[]
}

function dedupSortByFreq(arr: Array<{ col: number; freq: number }>): Array<{ col: number; freq: number }> {
  const seen = new Set<number>()
  const out: Array<{ col: number; freq: number }> = []
  for (const x of arr) {
    if (seen.has(x.freq)) continue
    seen.add(x.freq)
    out.push(x)
  }
  out.sort((a, b) => a.freq - b.freq)
  return out
}

/**
 * Détecte le jeu de bandes de spectre à utiliser dans une ligne d'en-têtes.
 * Retourne null si moins de `minBands` bandes Leq plausibles sont trouvées.
 */
export function detectFreqColumns(headers: unknown[], minBands = 6): FreqColumns | null {
  const byType = new Map<SpectrumColType, Array<{ col: number; freq: number }>>()
  headers.forEach((h, col) => {
    const { type, freq } = parseSpectrumColumn(h)
    if (type && freq != null) {
      if (!byType.has(type)) byType.set(type, [])
      byType.get(type)!.push({ col, freq })
    }
  })

  // Choix du jeu Leq par priorité.
  const leqType: SpectrumColType | null =
    byType.has('1/3 LZeq') ? '1/3 LZeq'
      : byType.has('1/1 LZeq') ? '1/1 LZeq'
        : byType.has('number') ? 'number'
          : null
  if (!leqType) return null
  const leq = dedupSortByFreq(byType.get(leqType)!)
  if (leq.length < minBands) return null

  // Jeu LZFmax correspondant, aligné sur les fréquences du Leq.
  const maxType: SpectrumColType | null =
    leqType === '1/3 LZeq' ? '1/3 LZFmax'
      : leqType === '1/1 LZeq' ? '1/1 LZFmax'
        : null
  let maxCols: number[] | undefined
  if (maxType && byType.has(maxType)) {
    const maxByFreq = new Map(dedupSortByFreq(byType.get(maxType)!).map((x) => [x.freq, x.col]))
    if (leq.every((x) => maxByFreq.has(x.freq))) {
      maxCols = leq.map((x) => maxByFreq.get(x.freq)!)
    }
  }

  return { cols: leq.map((x) => x.col), freqs: leq.map((x) => x.freq), maxCols }
}

/**
 * Extrait les valeurs d'une ligne pour une liste d'indices de colonnes.
 * Renvoie un tableau aligné uniquement si TOUTES les cellules sont finies
 * (spectre complet) — sinon null, pour garantir l'alignement bande↔fréquence.
 */
export function extractSpectrumRow(row: unknown[], cols: number[]): number[] | null {
  const out: number[] = []
  for (const c of cols) {
    const v = row[c]
    const num = typeof v === 'number' ? v : parseFloat(String(v))
    if (!Number.isFinite(num)) return null
    out.push(num)
  }
  return out
}
