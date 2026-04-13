/**
 * Parser pour fichiers XLSX du sonomètre 821SE / SoundExpert (Larson Davis).
 *
 * Supporte les exports anglais (G4 EN) et français (G4 FR) :
 *   EN : onglets Summary, Time History — colonnes Date/Time, LAeq, …
 *   FR : onglets Sommaire, Historique temporel — colonnes Date / heure, LAeq, …
 *
 * Le parser ne dépend PAS de l'onglet Summary/Sommaire : il localise
 * directement la feuille de données temporelles et détecte les colonnes
 * par nom d'en-tête. Les métadonnées (modèle, série, dates) sont extraites
 * du Summary/Sommaire si disponible, sinon dérivées des données.
 */
import * as XLSX from 'xlsx'
import type { MeasurementFile, DataPoint } from '../types'

/**
 * Bandes 1/3 d'octave émises par le 821SE (26 bandes, Z-pondéré).
 */
export const SE821_FREQ_BANDS: number[] = [
  31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250,
  315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500,
  3150, 4000, 5000, 6300, 8000, 10000,
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeToMinutes(value: unknown): number {
  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes() + value.getSeconds() / 60
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * 24 * 60
  }
  if (typeof value === 'string') {
    const m = value.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
    if (m) {
      return (
        parseInt(m[1], 10) * 60 +
        parseInt(m[2], 10) +
        parseInt(m[3] ?? '0', 10) / 60
      )
    }
  }
  return 0
}

function excelDateToISO(value: unknown): string {
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value)
    const y = date.y
    const m = String(date.m).padStart(2, '0')
    const d = String(date.d).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'string') {
    const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    return value
  }
  return ''
}

function cellValue(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const addr = XLSX.utils.encode_cell({ r: row, c: col })
  const cell = sheet[addr]
  return cell ? String(cell.v) : ''
}

// ---------------------------------------------------------------------------
// findSummarySheet — optional, used for metadata only
// ---------------------------------------------------------------------------

export function findSummarySheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | undefined {
  if (workbook.Sheets['Summary']) return workbook.Sheets['Summary']
  if (workbook.Sheets['Sommaire']) return workbook.Sheets['Sommaire']
  for (const name of workbook.SheetNames) {
    const lower = name.toLowerCase()
    if (lower === 'summary' || lower === 'sommaire') return workbook.Sheets[name]
  }
  return undefined
}

// ---------------------------------------------------------------------------
// findHistorySheet — finds the time-series data sheet
// ---------------------------------------------------------------------------

/**
 * Détecte le nom de la feuille de données temporelles parmi les noms d'onglets.
 * Ordre de priorité :
 *  1. Contient "DATA_Time History" (831C anglais)
 *  2. Contient "Historique temporel" (821SE français G4)
 *  3. Contient "Time History" (variante)
 *  4. Contient "Time" ou "Historique" (fallback)
 */
function detectTimeSheetName(sheetNames: string[]): string | null {
  const tests: ((s: string) => boolean)[] = [
    (s) => s.includes('DATA_Time History') || s.includes('DATA_Time_History'),
    (s) => s.toLowerCase().includes('historique temporel'),
    (s) => s.toLowerCase().includes('time history'),
    (s) => s.toLowerCase().includes('time'),
    (s) => s.toLowerCase().includes('historique'),
  ]
  const skipNames = new Set(
    ['summary', 'sommaire', 'paramètres', 'parametres', 'parameters',
     'journal de session', 'session log', 'oba',
     'historique de mesure', 'measurement log']
      .map((s) => s.toLowerCase()),
  )
  for (const test of tests) {
    const match = sheetNames.find((s) => !skipNames.has(s.toLowerCase()) && test(s))
    if (match) return match
  }
  return null
}

/** Vérifie si une feuille contient une colonne LAeq dans ses en-têtes. */
function sheetHasLaeq(sheet: XLSX.WorkSheet): boolean {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
  if (rows.length < 2) return false
  const header = rows[0]
  if (!header) return false
  return header.some((h) => {
    const v = String(h ?? '').toLowerCase()
    return v.includes('laeq') || v.includes('la eq') || v.includes('leq')
  })
}

/**
 * Trouve la feuille contenant les données temporelles seconde par seconde.
 * Utilise la détection par nom, puis vérifie que l'onglet contient bien LAeq.
 * Si le match par nom ne contient pas LAeq, tente les onglets restants.
 */
export function findHistorySheet(workbook: XLSX.WorkBook): { sheet: XLSX.WorkSheet; name: string } | null {
  const skipNames = new Set(
    ['summary', 'sommaire', 'paramètres', 'parametres', 'parameters',
     'journal de session', 'session log', 'oba',
     'historique de mesure', 'measurement log']
      .map((s) => s.toLowerCase()),
  )

  // 1. Match by name priority
  const bestName = detectTimeSheetName(workbook.SheetNames)
  if (bestName) {
    const sheet = workbook.Sheets[bestName]
    // Verify LAeq presence; if not, still return (831C has no header row, uses positional cols)
    return { sheet, name: bestName }
  }

  // 2. Fallback: first non-skip sheet with a LAeq column
  for (const sheetName of workbook.SheetNames) {
    if (skipNames.has(sheetName.toLowerCase())) continue
    const sheet = workbook.Sheets[sheetName]
    if (sheetHasLaeq(sheet)) {
      return { sheet, name: sheetName }
    }
  }

  // 3. Last resort: first non-skip sheet with data
  for (const sheetName of workbook.SheetNames) {
    if (skipNames.has(sheetName.toLowerCase())) continue
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
    if (rows.length >= 2) {
      return { sheet, name: sheetName }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// detect821SE — instrument detection (does NOT require Summary)
// ---------------------------------------------------------------------------

/**
 * Détecte si un fichier XLSX provient d'un 821SE / SoundExpert.
 * Essaie d'abord le Summary/Sommaire, puis les noms d'onglets,
 * puis les en-têtes de la feuille de données.
 */
export function detect821SE(workbook: XLSX.WorkBook): boolean {
  // 1. Summary/Sommaire exists and mentions SoundExpert 821
  const summary = findSummarySheet(workbook)
  if (summary) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 5; c++) {
        const v = cellValue(summary, r, c).toLowerCase()
        if (v.includes('soundexpert') || v.includes('821se') || v.includes('821 se')) return true
      }
    }
  }

  // 2. Characteristic French 821SE sheet names
  const names = workbook.SheetNames.map((n) => n.toLowerCase())
  if (names.includes('historique temporel') || names.includes('journal de session')) {
    return true
  }

  // 3. History sheet has FR 821SE header signature
  const history = findHistorySheet(workbook)
  if (history) {
    const rows = XLSX.utils.sheet_to_json(history.sheet, { header: 1, defval: null }) as unknown[][]
    const header = rows[0]
    if (header) {
      const h = header.map((v) => String(v ?? '').toLowerCase())
      // FR 821SE has "Date / heure" + "LApk" — 831C has "Record Type" + different col layout
      if (h.some((x) => x.includes('date / heure') || x.includes('date/heure')) &&
          h.some((x) => x === 'laeq')) {
        return true
      }
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Column finder by header name
// ---------------------------------------------------------------------------

interface ColumnMap {
  timeCol: number
  laeqCol: number
  recordTypeCol: number  // -1 if not found
  lceqCol: number        // -1 if not found
  spectraStart: number   // -1 if not found
  spectraEnd: number     // -1 if not found
}

/**
 * Recherche les colonnes par nom d'en-tête (FR + EN).
 * Retourne les indices trouvés ou -1 pour les colonnes absentes.
 */
function detectColumns(headers: string[]): ColumnMap {
  const h = headers.map((v) => v.toLowerCase())

  // timestamp: "Date / heure", "Date/heure", "Date/Time", "DateTime", "Heure", "Time"
  const timeCol = h.findIndex((x) =>
    x.includes('date / heure') || x.includes('date/heure') ||
    x.includes('date/time') || x.includes('datetime') ||
    x === 'time' || x === 'heure')

  // LAeq (identical FR/EN)
  const laeqCol = h.findIndex((x) =>
    x === 'laeq' || x.includes('la eq') ||
    (x.includes('leq') && !x.includes('lzeq') && !x.includes('lceq')))

  // Record type: "Record Type", "Type d'enregistrement"
  const recordTypeCol = h.findIndex((x) =>
    x.includes('record type') || x.includes("type d'enregistrement") || x.includes('enregistrement'))

  // LCeq (identical FR/EN)
  const lceqCol = h.findIndex((x) => x === 'lceq' || x.includes('lc eq'))

  // Spectra LZeq bands (contiguous block)
  let spectraStart = -1
  let spectraEnd = -1
  const firstLzeq = h.findIndex((x) => x.includes('lzeq') || x.includes('lz eq'))
  if (firstLzeq >= 0) {
    spectraStart = firstLzeq
    spectraEnd = firstLzeq
    for (let c = firstLzeq + 1; c < h.length; c++) {
      if (h[c].includes('lzeq') || h[c].includes('lz eq')) {
        spectraEnd = c
      } else {
        break
      }
    }
  }

  return { timeCol, laeqCol, recordTypeCol, lceqCol, spectraStart, spectraEnd }
}

// ---------------------------------------------------------------------------
// Metadata extraction from Summary/Sommaire (optional)
// ---------------------------------------------------------------------------

interface SummaryMeta {
  model: string
  serial: string
  startDate: string
  startTime: string
  stopTime: string
}

function extractSummaryMeta(workbook: XLSX.WorkBook): SummaryMeta | null {
  const sheet = findSummarySheet(workbook)
  if (!sheet) return null

  const model = cellValue(sheet, 1, 1) || cellValue(sheet, 0, 1) || ''
  const serial = cellValue(sheet, 2, 1) || ''
  const startRaw = cellValue(sheet, 3, 1) || ''
  const stopRaw = cellValue(sheet, 4, 1) || ''

  const [startDate, startTimePart] = startRaw.split(' ')
  const [, stopTimePart] = stopRaw.split(' ')

  return {
    model: model || 'Sonomètre',
    serial,
    startDate: startDate ?? '',
    startTime: startTimePart?.slice(0, 5) ?? '00:00',
    stopTime: stopTimePart?.slice(0, 5) ?? '00:00',
  }
}

// ---------------------------------------------------------------------------
// Date extraction from first data row (fallback when no Summary)
// ---------------------------------------------------------------------------

function extractDateFromValue(value: unknown): string {
  if (typeof value === 'number') return excelDateToISO(value)
  if (typeof value === 'string') {
    const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    const fr = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  }
  return ''
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Lit un fichier XLSX 821SE et retourne un objet MeasurementFile.
 * Ne requiert PAS d'onglet Summary/Sommaire — les données sont
 * localisées par nom de feuille puis par en-têtes de colonnes.
 */
export function parse821SE(buffer: ArrayBuffer, fileName: string): MeasurementFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  // --- Métadonnées optionnelles depuis Summary/Sommaire ---
  const meta = extractSummaryMeta(workbook)

  // --- Feuille d'historique temporel (obligatoire) ---
  const history = findHistorySheet(workbook)
  if (!history) {
    throw new Error(
      `Aucune feuille de données temporelles trouvée dans "${fileName}". ` +
      `Attendu : "Time History" ou "Historique temporel".`,
    )
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(history.sheet, {
    header: 1,
    defval: null,
  }) as unknown[][]

  // --- Détection des colonnes par en-tête ---
  const headerRow = rows[0] as unknown[] | undefined
  const headers = headerRow
    ? headerRow.map((h) => String(h ?? ''))
    : []
  const cols = detectColumns(headers)

  // Fallback si les en-têtes ne matchent pas : utiliser les positions par défaut 821SE
  const timeCol = cols.timeCol >= 0 ? cols.timeCol : 1
  const laeqCol = cols.laeqCol >= 0 ? cols.laeqCol : 2
  const recordTypeCol = cols.recordTypeCol  // -1 = pas de filtre
  const spectraStart = cols.spectraStart >= 0 ? cols.spectraStart : 37
  const spectraEnd = cols.spectraEnd >= 0 ? cols.spectraEnd : 62

  if (cols.timeCol < 0 || cols.laeqCol < 0) {
    // Warn but don't block — fallback to positional defaults
    console.warn(
      `[parser821SE] En-têtes timestamp/LAeq non trouvés dans "${history.name}", ` +
      `utilisation des positions par défaut (col ${timeCol} / col ${laeqCol})`,
    )
  }

  // --- Extraction des données ---
  const data: DataPoint[] = []
  let firstDate = ''

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    // Filtre Record Type uniquement si la colonne existe
    if (recordTypeCol >= 0) {
      const recordType = row[recordTypeCol]
      if (recordType !== null && recordType !== '' && recordType !== undefined) {
        continue
      }
    }

    const timeVal = row[timeCol]
    const t = timeToMinutes(timeVal) % 1440

    const laeqVal = row[laeqCol]
    const laeq = typeof laeqVal === 'number' ? laeqVal : parseFloat(String(laeqVal))
    if (!Number.isFinite(laeq)) continue

    // Extraire la date de la première ligne valide
    if (!firstDate && timeVal != null) {
      firstDate = extractDateFromValue(timeVal)
    }

    // LCeq optionnel
    const lceq = cols.lceqCol >= 0 ? (() => {
      const v = row[cols.lceqCol]
      const n = typeof v === 'number' ? v : parseFloat(String(v))
      return Number.isFinite(n) ? n : undefined
    })() : undefined

    // Spectres 1/3 octave LZeq optionnels
    const spectra: number[] = []
    if (spectraStart >= 0) {
      for (let c = spectraStart; c <= spectraEnd && c < row.length; c++) {
        const v = row[c]
        const num = typeof v === 'number' ? v : parseFloat(String(v))
        if (!isNaN(num)) spectra.push(num)
      }
    }

    data.push({
      t,
      laeq,
      ...(lceq !== undefined ? { lceq } : {}),
      ...(spectra.length > 0 ? { spectra } : {}),
    })
  }

  if (data.length === 0) {
    throw new Error(
      `Aucune donnée LAeq valide trouvée dans "${fileName}". ` +
      `Vérifiez les colonnes dans l'onglet "${history.name}".`,
    )
  }

  // Bandes spectrales
  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0
  const spectraFreqs =
    nBands === SE821_FREQ_BANDS.length
      ? SE821_FREQ_BANDS
      : SE821_FREQ_BANDS.slice(0, nBands)

  // Date : préférer Summary, sinon dériver de la première ligne
  const date = meta?.startDate || firstDate || ''

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model: meta?.model || 'Sonomètre',
    serial: meta?.serial || '',
    date,
    startTime: meta?.startTime || '00:00',
    stopTime: meta?.stopTime || '00:00',
    point: null,
    data,
    rowCount: data.length,
    ...(nBands > 0 ? { spectraFreqs } : {}),
  }
}
