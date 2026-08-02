/**
 * Détection des colonnes de spectre 1/3 (et 1/1) d'octave dans les exports G4
 * des sonomètres Larson Davis (831C / 821SE).
 *
 * Les en-têtes réels sont préfixés par le type de spectre et la fréquence
 * centrale, p. ex. :
 *   « 1/3 LZeq 6.3 », « 1/3 LZeq 1000 », « 1/3 LZFmax 6.3 », « 1/1 LZeq 8.0 »…
 *
 * DEUX PONDÉRATIONS existent selon l'export :
 *   - Z (linéaire) : « 1/3 LZeq … » — 831C, 821SE xlsx « Historique de mesure »
 *   - A            : « 1/3 LAeq … » — 821SE CSV « Histoire du temps », qui ne
 *     fournit AUCUNE colonne LZeq : le spectre n'existe qu'en dB(A).
 * La pondération détectée est remontée (`weighting`) pour que le parser
 * dépondère A → Z en amont ; `DataPoint.spectra` reste TOUJOURS du LZeq.
 *
 * DÉCIMALE : les libellés G4 français portent une VIRGULE (« 1/3 LAeq 6,3 »,
 * « 1/3 LZeq 31,5 »), les anglais un point, et les bandes ≥ 100 Hz sont des
 * entiers nus (« 1/3 LAeq 1000 »). Le groupe fréquence accepte les deux
 * séparateurs et reste GOURMAND : « 1/3 LAeq 8,0 » vaut 8 — jamais un match
 * tronqué sur « 8 » qui laisserait la colonne à moitié reconnue.
 *
 * Priorité de sélection du jeu de bandes « Leq » :
 *   1. 1/3 LZeq  (tiers d'octave MESURÉ en Z — standard acoustique, 36 bandes)
 *   2. 1/3 LAeq  (tiers d'octave en A — dépondéré vers Z par le parser)
 *   3. 1/1 LZeq / 1/1 LAeq  (octave — 12 bandes, fallback)
 *   4. colonne nommée par un nombre seul (autres exports, supposée Z)
 * Z passe AVANT A : quand les deux jeux coexistent, on prend la mesure native
 * plutôt qu'une reconstruction. Il n'y a donc jamais de mélange A/Z dans un
 * même spectre — le jeu Fmax est apparié sur la MÊME pondération que le Leq.
 *
 * Le jeu LZFmax/LAFmax correspondant (mêmes fréquences) est également repéré
 * pour alimenter `DataPoint.spectraMax` (panneau « Spectre instantané »).
 */

/** Pondération fréquentielle portée par un en-tête de bande. */
export type SpectrumWeighting = 'A' | 'Z'

export type SpectrumColType =
  | '1/3 LZeq' | '1/3 LZFmax' | '1/3 LZFmin'
  | '1/1 LZeq' | '1/1 LZFmax'
  | '1/3 LAeq' | '1/3 LAFmax' | '1/3 LAFmin'
  | '1/1 LAeq' | '1/1 LAFmax'
  | 'number'

/**
 * Pondération de chaque type de colonne. `number` (en-tête = fréquence nue) est
 * supposé Z — comportement historique conservé, aucun export connu n'y met du A.
 */
const WEIGHTING_OF: Record<SpectrumColType, SpectrumWeighting> = {
  '1/3 LZeq': 'Z', '1/3 LZFmax': 'Z', '1/3 LZFmin': 'Z',
  '1/1 LZeq': 'Z', '1/1 LZFmax': 'Z',
  '1/3 LAeq': 'A', '1/3 LAFmax': 'A', '1/3 LAFmin': 'A',
  '1/1 LAeq': 'A', '1/1 LAFmax': 'A',
  'number': 'Z',
}

/**
 * Fréquence centrale d'un libellé de bande. Accepte la décimale VIRGULE (G4 FR)
 * comme le POINT (G4 EN) ; jamais `parseFloat` brut, qui tronquerait « 12,5 »
 * en 12 et désalignerait la bande de sa clé de pondération.
 */
function parseFreqLabel(raw: string): number | null {
  const s = raw.replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null // 2 séparateurs, vide… → refusé
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Reconnaît un en-tête de colonne de spectre et en extrait le type, la
 * fréquence centrale et la pondération. Retourne `{ type: null }` si l'en-tête
 * n'est pas une bande de spectre (LAeq large bande, LCeq, L90, Date/heure…).
 */
export function parseSpectrumColumn(header: unknown): {
  type: SpectrumColType | null
  freq: number | null
  weighting: SpectrumWeighting | null
} {
  const s = String(header ?? '').trim()
  if (!s) return { type: null, freq: null, weighting: null }
  // Groupe fréquence GOURMAND, virgule OU point (cf. en-tête du module).
  const patterns: Array<{ regex: RegExp; type: SpectrumColType }> = [
    // Tiers d'octave (1/3) en Z — EN + variante FR « 1/3 Leq Z »
    { regex: /^1\/3\s+LZeq\s+([\d.,]+)$/i, type: '1/3 LZeq' },
    { regex: /^1\/3\s+Leq\s*Z\s+([\d.,]+)$/i, type: '1/3 LZeq' },
    { regex: /^1\/3\s+LZF?max\s+([\d.,]+)$/i, type: '1/3 LZFmax' },
    { regex: /^1\/3\s+LZF?min\s+([\d.,]+)$/i, type: '1/3 LZFmin' },
    // Tiers d'octave (1/3) en A — 821SE CSV (« 1/3 LAeq 6,3 », « 1/3 LAFmax 1000 »)
    { regex: /^1\/3\s+LAeq\s+([\d.,]+)$/i, type: '1/3 LAeq' },
    { regex: /^1\/3\s+Leq\s*A\s+([\d.,]+)$/i, type: '1/3 LAeq' },
    { regex: /^1\/3\s+LAF?max\s+([\d.,]+)$/i, type: '1/3 LAFmax' },
    { regex: /^1\/3\s+LAF?min\s+([\d.,]+)$/i, type: '1/3 LAFmin' },
    // Octave (1/1)
    { regex: /^1\/1\s+LZeq\s+([\d.,]+)$/i, type: '1/1 LZeq' },
    { regex: /^1\/1\s+Leq\s*Z\s+([\d.,]+)$/i, type: '1/1 LZeq' },
    { regex: /^1\/1\s+LZF?max\s+([\d.,]+)$/i, type: '1/1 LZFmax' },
    { regex: /^1\/1\s+LAeq\s+([\d.,]+)$/i, type: '1/1 LAeq' },
    { regex: /^1\/1\s+Leq\s*A\s+([\d.,]+)$/i, type: '1/1 LAeq' },
    { regex: /^1\/1\s+LAF?max\s+([\d.,]+)$/i, type: '1/1 LAFmax' },
    // Fallback : nom = juste un nombre (avec suffixe k/Hz toléré)
    { regex: /^([\d.,]+)\s*k?\s*(?:hz)?$/i, type: 'number' },
  ]
  for (const p of patterns) {
    const m = s.match(p.regex)
    if (m) {
      const parsed = parseFreqLabel(m[1])
      if (parsed === null) continue
      let freq = parsed
      if (/k/i.test(s) && !/^1\/[13]/.test(s)) freq *= 1000 // « 1k » / « 16k »
      if (freq >= 6 && freq <= 20000) return { type: p.type, freq, weighting: WEIGHTING_OF[p.type] }
    }
  }
  return { type: null, freq: null, weighting: null }
}

/**
 * Cherche l'index de colonne d'une métrique large bande (LAeq, LAFmax, LCeq…)
 * par NOM d'en-tête. La comparaison ignore la casse et toute ponctuation /
 * espace (« LAF Max », « LAF_max », « LAFmax » → identiques). Les en-têtes de
 * spectre (suffixés d'une fréquence, « LZFmax 1000 ») ne matchent jamais.
 *
 * @param headers ligne d'en-têtes
 * @param aliases variantes acceptées de la métrique
 * @returns 1er index de colonne correspondant, ou null
 */
export function detectMetricColumn(headers: unknown[], aliases: string[]): number | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_./()-]+/g, '')
  const want = new Set(aliases.map(norm))
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c]
    if (h == null) continue
    if (want.has(norm(String(h)))) return c
  }
  return null
}

export interface FreqColumns {
  /** Indices de colonnes du jeu Leq, triés par fréquence croissante. */
  cols: number[]
  /** Fréquences centrales correspondantes (même ordre que `cols`). */
  freqs: number[]
  /** Indices de colonnes LZFmax/LAFmax alignés sur `freqs` (si présents). */
  maxCols?: number[]
  /**
   * Pondération du jeu retenu — `cols` ET `maxCols` la partagent (appariement
   * sur la même pondération). 'A' ⇒ le parser doit dépondérer vers Z.
   */
  weighting: SpectrumWeighting
}

/** Ordre de préférence du jeu « Leq » : Z natif d'abord, A ensuite. */
const LEQ_PRIORITY: SpectrumColType[] = ['1/3 LZeq', '1/3 LAeq', '1/1 LZeq', '1/1 LAeq', 'number']

/** Jeu « Fmax » apparié à un jeu « Leq » — TOUJOURS de la même pondération. */
const MAX_OF: Partial<Record<SpectrumColType, SpectrumColType>> = {
  '1/3 LZeq': '1/3 LZFmax',
  '1/3 LAeq': '1/3 LAFmax',
  '1/1 LZeq': '1/1 LZFmax',
  '1/1 LAeq': '1/1 LAFmax',
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

  // Choix du jeu Leq par priorité (Z natif avant A reconstruit).
  const leqType = LEQ_PRIORITY.find((t) => byType.has(t)) ?? null
  if (!leqType) return null
  const leq = dedupSortByFreq(byType.get(leqType)!)
  if (leq.length < minBands) return null

  // Jeu Fmax correspondant — MÊME pondération, aligné sur les fréquences du Leq.
  const maxType = MAX_OF[leqType] ?? null
  let maxCols: number[] | undefined
  if (maxType && byType.has(maxType)) {
    const maxByFreq = new Map(dedupSortByFreq(byType.get(maxType)!).map((x) => [x.freq, x.col]))
    if (leq.every((x) => maxByFreq.has(x.freq))) {
      maxCols = leq.map((x) => maxByFreq.get(x.freq)!)
    }
  }

  return {
    cols: leq.map((x) => x.col),
    freqs: leq.map((x) => x.freq),
    maxCols,
    weighting: WEIGHTING_OF[leqType],
  }
}

/**
 * Cœur d'extraction spectrale par ACCESSEUR de cellule (colonne → valeur).
 * Découplé de toute représentation de ligne : réutilisable par le parser dense
 * (tableau) ET par un lecteur en flux (map colonne épars). Renvoie un tableau
 * aligné uniquement si TOUTES les cellules sont finies (spectre complet) — sinon
 * null, pour garantir l'alignement bande↔fréquence.
 */
export function extractSpectrumCells(getCell: (colIndex: number) => unknown, cols: number[]): number[] | null {
  const out: number[] = []
  for (const c of cols) {
    const v = getCell(c)
    const num = typeof v === 'number' ? v : parseFloat(String(v))
    if (!Number.isFinite(num)) return null
    out.push(num)
  }
  return out
}

/**
 * Extrait les valeurs d'une ligne (tableau) pour une liste d'indices de colonnes.
 * Adaptateur byte-identique au-dessus de `extractSpectrumCells`.
 */
export function extractSpectrumRow(row: unknown[], cols: number[]): number[] | null {
  return extractSpectrumCells((c) => row[c], cols)
}
