/**
 * Parser universel "intelligent" — sondage de fichiers de mesure acoustique
 * non formatés 831C / 821SE. Détecte automatiquement la ligne d'en-tête
 * et les colonnes utiles (nom de source, Lp/LAeq, distance) dans chaque
 * onglet d'un classeur XLSX/XLS/XLSM/CSV/TSV.
 *
 * Portée actuelle : scope réduit aux besoins du module Calcul Lw.
 * Ne détecte pas encore les spectres 1/3 octave ni les percentiles —
 * à étendre lors de l'intégration dans le pipeline d'import principal.
 */
import * as XLSX from 'xlsx'

export interface DetectedLpRow {
  /** Index 0-based de la ligne dans l'onglet d'origine. */
  rowIndex: number
  name?: string
  lp: number
  distance?: number
}

export interface ParsedSheetSummary {
  name: string
  headerRow: number
  columns: {
    name?: number
    lp?: number
    distance?: number
  }
  rows: DetectedLpRow[]
  /** Nombre de lignes de données examinées (hors en-tête). */
  totalRowsScanned: number
  warning?: string
}

export interface UniversalParseResult {
  fileName: string
  sheets: ParsedSheetSummary[]
}

/**
 * Parse un fichier (XLSX/XLS/XLSM/CSV/TSV) et retourne la synthèse de
 * chaque onglet contenant au moins une colonne Lp détectée.
 */
export async function parseLpFile(file: File): Promise<UniversalParseResult> {
  const buf = await file.arrayBuffer()
  // SheetJS détecte automatiquement le format (xlsx, xls, xlsm, csv…)
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })

  const sheets: ParsedSheetSummary[] = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(ws, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false,
    }) as Array<Array<string | number | null>>
    const summary = analyzeSheet(sheetName, rows)
    if (summary) sheets.push(summary)
  }
  return { fileName: file.name, sheets }
}

/** Analyse un onglet : trouve l'en-tête, identifie Lp/distance/nom, extrait les lignes. */
function analyzeSheet(
  name: string,
  rows: Array<Array<string | number | null>>,
): ParsedSheetSummary | null {
  if (rows.length < 2) return null

  const headerRowIdx = findHeaderRow(rows)
  if (headerRowIdx < 0) return null

  const headers = (rows[headerRowIdx] ?? []).map((c) => String(c ?? '').trim())
  const columns = detectColumns(headers)
  if (columns.lp === undefined) return null

  const out: DetectedLpRow[] = []
  let scanned = 0
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    scanned++
    const lp = toNum(r[columns.lp])
    if (lp === undefined || lp < 0 || lp > 140) continue
    const row: DetectedLpRow = { rowIndex: i, lp }
    if (columns.name !== undefined) {
      const nm = String(r[columns.name] ?? '').trim()
      if (nm) row.name = nm
    }
    if (columns.distance !== undefined) {
      const d = toNum(r[columns.distance])
      if (d !== undefined && d > 0) row.distance = d
    }
    out.push(row)
  }

  if (out.length < 1) {
    return {
      name,
      headerRow: headerRowIdx,
      columns,
      rows: [],
      totalRowsScanned: scanned,
      warning: 'En-tête détecté mais aucune ligne de données exploitable (Lp hors plage ou vide).',
    }
  }

  return { name, headerRow: headerRowIdx, columns, rows: out, totalRowsScanned: scanned }
}

/**
 * Heuristique : parcourt les 20 premières lignes et choisit celle qui
 * contient le plus de cellules "ressemblant à des labels" (lettres,
 * pas purement numérique/date).
 */
function findHeaderRow(rows: Array<Array<string | number | null>>): number {
  let bestIdx = -1
  let bestScore = 0
  const maxScan = Math.min(20, rows.length)
  for (let i = 0; i < maxScan; i++) {
    const row = rows[i] || []
    let labels = 0
    for (const c of row) {
      const s = String(c ?? '').trim()
      if (!s) continue
      const hasLetters = /[a-zA-ZéèêàùîôÉÈÊÀÙÎÔçÇ]/.test(s)
      const isNumericOrDate = /^[0-9.,/\s:-]+$/.test(s)
      if (hasLetters && !isNumericOrDate) labels++
    }
    if (labels > bestScore) {
      bestScore = labels
      bestIdx = i
    }
  }
  return bestScore >= 2 ? bestIdx : (rows.length > 0 ? 0 : -1)
}

/** Match sur les libellés d'en-tête (insensible à la casse, ignore les unités entre parenthèses). */
function detectColumns(headers: string[]): { name?: number; lp?: number; distance?: number } {
  const out: { name?: number; lp?: number; distance?: number } = {}
  headers.forEach((h, idx) => {
    const raw = h.toLowerCase()
    // Retire les suffixes d'unité "(dB)", "(m)", etc.
    const stripped = raw.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
    if (out.lp === undefined && /\b(laeq|la\s*eq|lp|leq|niveau|level)\b/.test(stripped)) out.lp = idx
    else if (out.distance === undefined && /\b(dist|distance)\b/.test(stripped)) out.distance = idx
    else if (out.name === undefined && /\b(nom|name|source|point|identifiant|id)\b/.test(stripped)) out.name = idx
  })
  return out
}

/** Parse un nombre avec virgule ou point comme séparateur décimal. */
function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'number') return isFinite(v) ? v : undefined
  const s = String(v).replace(/\s/g, '').replace(',', '.').trim()
  if (!s) return undefined
  const n = parseFloat(s)
  return isNaN(n) ? undefined : n
}
