/**
 * Web Worker pour le parsing de fichiers XLSX en arrière-plan.
 * Évite de bloquer le thread principal pour les gros fichiers (28000+ lignes).
 *
 * Supporte 831C (EN) et 821SE (EN + FR G4) sans dépendre d'un onglet Summary.
 */
import * as XLSX from 'xlsx'
import type { MeasurementFile } from '../types'

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
  return NaN
}

const SE831C_FREQS = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
  500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
  5000, 6300, 8000, 10000, 12500, 16000, 20000,
]
const SE821_FREQS = [
  31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250,
  315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500,
  3150, 4000, 5000, 6300, 8000, 10000,
]

function cellValue(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const addr = XLSX.utils.encode_cell({ r: row, c: col })
  const cell = sheet[addr]
  return cell ? String(cell.v) : ''
}

// ---------------------------------------------------------------------------
// Sheet finders (no hard dependency on Summary)
// ---------------------------------------------------------------------------

function findSummarySheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | undefined {
  if (workbook.Sheets['Summary']) return workbook.Sheets['Summary']
  if (workbook.Sheets['Sommaire']) return workbook.Sheets['Sommaire']
  for (const name of workbook.SheetNames) {
    const lower = name.toLowerCase()
    if (lower === 'summary' || lower === 'sommaire') return workbook.Sheets[name]
  }
  return undefined
}

function findHistorySheet(workbook: XLSX.WorkBook): { sheet: XLSX.WorkSheet; name: string } | null {
  const skipNames = new Set(
    ['summary', 'sommaire', 'paramètres', 'parametres', 'parameters',
     'journal de session', 'session log', 'oba',
     'historique de mesure', 'measurement log']
      .map((s) => s.toLowerCase()),
  )

  // Detect by sheet name priority
  const tests: ((s: string) => boolean)[] = [
    (s) => s.includes('DATA_Time History') || s.includes('DATA_Time_History'),
    (s) => s.toLowerCase().includes('historique temporel'),
    (s) => s.toLowerCase().includes('time history'),
    (s) => s.toLowerCase().includes('time'),
    (s) => s.toLowerCase().includes('historique'),
  ]
  for (const test of tests) {
    const match = workbook.SheetNames.find((s) => !skipNames.has(s.toLowerCase()) && test(s))
    if (match) return { sheet: workbook.Sheets[match], name: match }
  }

  // Fallback: first non-skip sheet with LAeq column
  for (const sheetName of workbook.SheetNames) {
    if (skipNames.has(sheetName.toLowerCase())) continue
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
    if (rows.length < 2) continue
    const header = rows[0]
    if (!header) continue
    if (header.some((h) => {
      const v = String(h ?? '').toLowerCase()
      return v.includes('laeq') || v.includes('la eq') || v.includes('leq')
    })) {
      return { sheet, name: sheetName }
    }
  }

  // Last resort: first non-skip sheet with data
  for (const sheetName of workbook.SheetNames) {
    if (skipNames.has(sheetName.toLowerCase())) continue
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
    if (rows.length >= 2) return { sheet, name: sheetName }
  }

  return null
}

// ---------------------------------------------------------------------------
// Instrument detection
// ---------------------------------------------------------------------------

function detect821SE(workbook: XLSX.WorkBook): boolean {
  const summary = findSummarySheet(workbook)
  if (summary) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 5; c++) {
        const v = cellValue(summary, r, c).toLowerCase()
        if (v.includes('soundexpert') || v.includes('821se') || v.includes('821 se')) return true
      }
    }
  }

  const names = workbook.SheetNames.map((n) => n.toLowerCase())
  if (names.includes('historique temporel') || names.includes('journal de session')) {
    return true
  }

  const history = findHistorySheet(workbook)
  if (history) {
    const rows = XLSX.utils.sheet_to_json(history.sheet, { header: 1, defval: null }) as unknown[][]
    const header = rows[0]
    if (header) {
      const h = header.map((v) => String(v ?? '').toLowerCase())
      if (h.some((x) => x.includes('date / heure') || x.includes('date/heure')) &&
          h.some((x) => x === 'laeq')) {
        return true
      }
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Column detection by header name
// ---------------------------------------------------------------------------

interface ColumnMap {
  timeCol: number
  laeqCol: number
  recordTypeCol: number
  lceqCol: number
  spectraStart: number
  spectraEnd: number
}

function detectColumns(headers: string[]): ColumnMap {
  const h = headers.map((v) => v.toLowerCase())

  const timeCol = h.findIndex((x) =>
    x.includes('date / heure') || x.includes('date/heure') ||
    x.includes('date/time') || x.includes('datetime') ||
    x === 'time' || x === 'heure')

  const laeqCol = h.findIndex((x) =>
    x === 'laeq' || x.includes('la eq') ||
    (x.includes('leq') && !x.includes('lzeq') && !x.includes('lceq')))

  const recordTypeCol = h.findIndex((x) =>
    x.includes('record type') || x.includes("type d'enregistrement") || x.includes('enregistrement'))

  const lceqCol = h.findIndex((x) => x === 'lceq' || x.includes('lc eq'))

  let spectraStart = -1
  let spectraEnd = -1
  const firstLzeq = h.findIndex((x) => x.includes('lzeq') || x.includes('lz eq'))
  if (firstLzeq >= 0) {
    spectraStart = firstLzeq
    spectraEnd = firstLzeq
    for (let c = firstLzeq + 1; c < h.length; c++) {
      if (h[c].includes('lzeq') || h[c].includes('lz eq')) spectraEnd = c
      else break
    }
  }

  return { timeCol, laeqCol, recordTypeCol, lceqCol, spectraStart, spectraEnd }
}

// ---------------------------------------------------------------------------
// Date extraction from data cell (fallback when no Summary)
// ---------------------------------------------------------------------------

function extractDateFromValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = XLSX.SSF.parse_date_code(value)
    if (date) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }
  if (typeof value === 'string') {
    const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    const fr = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  }
  return ''
}

// ---------------------------------------------------------------------------
// Worker message types
// ---------------------------------------------------------------------------

interface ParseResult { type: 'result'; file: MeasurementFile }
interface ParseError { type: 'error'; fileName: string; error: string }
interface ParseProgress { type: 'progress'; fileName: string; percent: number }
type WorkerMessage = ParseResult | ParseError | ParseProgress

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

function parseInWorker(buffer: ArrayBuffer, fileName: string): MeasurementFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  const is821 = detect821SE(workbook)

  // --- Métadonnées optionnelles depuis Summary/Sommaire ---
  const summarySheet = findSummarySheet(workbook)
  let model = 'Sonomètre'
  let serial = ''
  let metaStartDate = ''
  let metaStartTime = '00:00'
  let metaStopTime = '00:00'

  if (summarySheet) {
    model = cellValue(summarySheet, 1, 1) || cellValue(summarySheet, 0, 1) || 'Sonomètre'
    serial = cellValue(summarySheet, 2, 1)
    const startRaw = cellValue(summarySheet, 3, 1)
    const stopRaw = cellValue(summarySheet, 4, 1)
    const [sd, st] = startRaw.split(' ')
    const [, stt] = stopRaw.split(' ')
    metaStartDate = sd ?? ''
    metaStartTime = st?.slice(0, 5) ?? '00:00'
    metaStopTime = stt?.slice(0, 5) ?? '00:00'
  }

  // --- Default column positions by model ---
  let timeCol: number
  let laeqCol: number
  let recordTypeCol: number
  let lceqCol = -1
  let spectraStart: number
  let spectraEnd: number
  if (is821) {
    timeCol = 1; laeqCol = 2; recordTypeCol = -1
    spectraStart = 37; spectraEnd = 62
  } else {
    timeCol = 2; laeqCol = 4; recordTypeCol = 1
    spectraStart = 41; spectraEnd = 67
  }

  // --- Find history sheet ---
  const history = findHistorySheet(workbook)
  if (!history) {
    throw new Error(`Aucune feuille de données temporelles trouvée dans "${fileName}"`)
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(history.sheet, {
    header: 1,
    defval: null,
  }) as unknown[][]

  // --- Detect columns by header name ---
  const headerRow = rows[0] as unknown[] | undefined
  if (headerRow) {
    const headers = headerRow.map((h) => String(h ?? ''))
    const cols = detectColumns(headers)
    if (cols.timeCol >= 0) timeCol = cols.timeCol
    if (cols.laeqCol >= 0) laeqCol = cols.laeqCol
    if (cols.recordTypeCol >= 0) recordTypeCol = cols.recordTypeCol
    if (cols.lceqCol >= 0) lceqCol = cols.lceqCol
    if (cols.spectraStart >= 0) {
      spectraStart = cols.spectraStart
      spectraEnd = cols.spectraEnd
    }
  }

  // --- Parse data rows ---
  const data: MeasurementFile['data'] = []
  const total = rows.length
  let firstDate = ''

  for (let i = 1; i < total; i++) {
    const row = rows[i]
    if (!row) continue

    if (recordTypeCol >= 0) {
      const recordType = row[recordTypeCol]
      if (recordType !== null && recordType !== '' && recordType !== undefined) continue
    }

    const timeVal = row[timeCol]
    const tRaw = timeToMinutes(timeVal)
    if (!Number.isFinite(tRaw)) continue
    const tVal = tRaw % 1440

    const laeqVal = row[laeqCol]
    const laeq = typeof laeqVal === 'number' ? laeqVal : parseFloat(String(laeqVal))
    if (!Number.isFinite(laeq)) continue

    if (!firstDate && timeVal != null) {
      firstDate = extractDateFromValue(timeVal)
    }

    // LCeq optionnel
    let lceqNum: number | undefined
    if (lceqCol >= 0) {
      const v = row[lceqCol]
      const n = typeof v === 'number' ? v : parseFloat(String(v))
      if (Number.isFinite(n)) lceqNum = n
    }

    // Spectres
    const spectra: number[] = []
    if (spectraStart >= 0) {
      for (let c = spectraStart; c <= spectraEnd && c < row.length; c++) {
        const v = row[c]
        const num = typeof v === 'number' ? v : parseFloat(String(v))
        if (!isNaN(num)) spectra.push(num)
      }
    }

    data.push({
      t: tVal,
      laeq,
      ...(lceqNum !== undefined ? { lceq: lceqNum } : {}),
      ...(spectra.length > 0 ? { spectra } : {}),
    })

    if (i % 5000 === 0) {
      self.postMessage({
        type: 'progress',
        fileName,
        percent: Math.round((i / total) * 100),
      } satisfies ParseProgress)
    }
  }

  if (data.length === 0) {
    throw new Error(`Aucune donnée LAeq valide trouvée dans "${fileName}"`)
  }

  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0
  const sourceFreqs = is821 ? SE821_FREQS : SE831C_FREQS
  const spectraFreqs =
    nBands === sourceFreqs.length ? sourceFreqs : sourceFreqs.slice(0, nBands)

  const date = metaStartDate || firstDate || ''

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model,
    serial,
    date,
    startTime: metaStartTime,
    stopTime: metaStopTime,
    point: null,
    data,
    rowCount: data.length,
    ...(nBands > 0 ? { spectraFreqs } : {}),
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  const { buffer, fileName } = e.data
  try {
    const result = parseInWorker(buffer, fileName)
    self.postMessage({ type: 'result', file: result } satisfies WorkerMessage)
  } catch (err) {
    self.postMessage({
      type: 'error',
      fileName,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerMessage)
  }
}
