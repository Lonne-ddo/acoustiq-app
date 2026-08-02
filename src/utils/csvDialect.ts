/**
 * Primitives PURES pour l'ingestion des exports CSV G4 (Larson Davis 831C/821SE).
 * Aucun I/O, aucun flux, aucune UI : uniquement des transformations chaîne→valeur.
 *
 * Contexte format CSV G4 (mesuré sur exports réels) :
 *  - encodage latin-1/cp1252 (le décodage bytes→string est fait en amont, Phase 3)
 *  - G4 FR : délimiteur virgule ET séparateur décimal virgule → valeurs entre
 *    guillemets ("72,5") ; découpage naïf donnerait 274 champs au lieu de 140
 *  - G4 EN (probable) : séparateur décimal point → on DÉTECTE, on ne suppose pas
 *  - en-têtes identiques au xlsx mais paddés d'espaces
 *  - cellule vide '' , numérique en chaîne, date '2025-07-03  11:13:42' (double espace)
 *
 * Ces primitives alimenteront un adaptateur SheetSource (Phase 4) dont les
 * cellules DOIVENT respecter le contrat figé en Phase 1 (cf. JSDoc SheetSource) :
 * numérique→number, date(cellDates:false)→sériel Excel number, texte→string,
 * vide→null.
 */

export interface CsvDialect {
  /** Séparateur de champs (souvent ',', parfois ';' ou tabulation). */
  delimiter: string
  /** Séparateur décimal des nombres — DÉTECTÉ, jamais supposé. */
  decimal: ',' | '.'
  /** Caractère de guillemet encadrant les champs. */
  quote: string
  /** Format de date reconnu (ISO « YYYY-MM-DD[ HH:MM:SS] » pour l'instant). */
  dateFormat: 'iso'
}

/** Epoch du système de dates Excel 1900 (1899-12-30 = sériel 0), en ms UTC. */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30)

// ───────────────────────────────────────────────────────────────────────────
// (b) Parseur de ligne — respecte les guillemets
// ───────────────────────────────────────────────────────────────────────────

/**
 * Découpe une ligne CSV en champs en respectant les guillemets : un champ
 * `"72,5"` reste UN champ même si le délimiteur est la virgule. Les guillemets
 * encadrants sont consommés (contenu retourné sans quotes) ; `""` interne =
 * guillemet littéral échappé. Aucune interprétation de type ici.
 */
export function splitLine(line: string, dialect: CsvDialect): string[] {
  const { delimiter, quote } = dialect
  const out: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === quote) {
        if (line[i + 1] === quote) { field += quote; i++ } // "" → " littéral
        else inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === quote) {
      inQuotes = true
    } else if (ch === delimiter) {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}

// ───────────────────────────────────────────────────────────────────────────
// (c) Normalisateur de cellule — conforme au contrat SheetSource
// ───────────────────────────────────────────────────────────────────────────

/** Convertit une chaîne numérique (décimale selon dialecte) en number, ou null. */
function tryNumber(s: string, decimal: ',' | '.'): number | null {
  // Motif STRICT : signe optionnel, chiffres, séparateur décimal du dialecte.
  const re = decimal === ',' ? /^[+-]?\d+(?:,\d+)?$/ : /^[+-]?\d+(?:\.\d+)?$/
  if (!re.test(s)) return null
  // IMPORTANT : parseFloat('72,5') === 72 (tronque à la virgule) → on remplace d'abord.
  const n = Number(decimal === ',' ? s.replace(',', '.') : s)
  return Number.isFinite(n) ? n : null
}

/**
 * Convertit une date/heure ISO « YYYY-MM-DD[ +HH:MM[:SS]] » (séparateur = 1+
 * espaces, tolère le double espace G4) en SÉRIEL EXCEL, même époque et même
 * naïveté TZ que XLSX.read{cellDates:false} (vérifié : delta 0). Sinon null.
 */
function tryDateToSerial(s: string): number | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  const h = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, se = m[6] ? +m[6] : 0
  const days = (Date.UTC(y, mo - 1, d) - EXCEL_EPOCH_UTC_MS) / 86_400_000
  return days + (h * 3600 + mi * 60 + se) / 86_400
}

/**
 * Normalise un champ CSV brut vers le type attendu par le contrat SheetSource :
 *   '' (ou seulement des espaces)     → null   (JAMAIS undefined, JAMAIS '')
 *   date/heure ISO                    → number (sériel Excel)
 *   numérique (décimale du dialecte)  → number
 *   sinon                             → string (guillemets retirés, trimé)
 * Ordre volontaire : date AVANT numérique (une date n'est jamais un nombre seul).
 */
export function normalizeCell(raw: string, dialect: CsvDialect): number | string | null {
  // Défensif : retire des guillemets encadrants résiduels, puis trim (en-têtes paddés).
  let s = raw
  if (s.length >= 2 && s[0] === dialect.quote && s[s.length - 1] === dialect.quote) {
    s = s.slice(1, -1)
  }
  s = s.trim()
  if (s === '') return null

  const serial = tryDateToSerial(s)
  if (serial !== null) return serial

  const n = tryNumber(s, dialect.decimal)
  if (n !== null) return n

  return s
}

// ───────────────────────────────────────────────────────────────────────────
// (a) Sniffer de dialecte
// ───────────────────────────────────────────────────────────────────────────

/**
 * Détecte le dialecte CSV sur les premières lignes, SANS supposer la virgule.
 * Heuristique délimiteur : celui qui donne une LARGEUR DE CHAMPS CONSTANTE (et
 * plausible) sur l'échantillon (le découpage respectant les guillemets).
 * Décimale : virgule si des champs numériques à virgule dominent, sinon point.
 */
export function sniffDialect(firstLines: string[]): CsvDialect {
  const lines = firstLines.filter((l) => l.trim() !== '')
  const quote = '"'
  const candidates = [',', ';', '\t']

  let delimiter = ','
  let bestWidth = -1
  for (const delim of candidates) {
    const probe: CsvDialect = { delimiter: delim, decimal: '.', quote, dateFormat: 'iso' }
    const counts = lines.map((l) => splitLine(l, probe).length)
    if (counts.length === 0) continue
    const w = counts[0]
    const constant = w > 1 && counts.every((c) => c === w)
    if (constant && w > bestWidth) { bestWidth = w; delimiter = delim }
  }

  // Décimale : inspecter les champs des lignes de DONNÉES (hors en-têtes = ligne 0).
  const base: CsvDialect = { delimiter, decimal: '.', quote, dateFormat: 'iso' }
  let comma = 0, dot = 0
  for (let li = 1; li < lines.length; li++) {
    for (const f of splitLine(lines[li], base)) {
      const t = f.trim()
      if (/^[+-]?\d+,\d+$/.test(t)) comma++
      else if (/^[+-]?\d+\.\d+$/.test(t)) dot++
    }
  }
  const decimal: ',' | '.' = comma > 0 && comma >= dot ? ',' : '.'

  return { delimiter, decimal, quote, dateFormat: 'iso' }
}
