/**
 * Web Worker pour le parsing de fichiers XLSX en arrière-plan
 * Évite de bloquer le thread principal pour les gros fichiers (28000+ lignes)
 */
import * as XLSX from 'xlsx'
import type { MeasurementFile } from '../types'

// Reproduire la logique de parsing directement dans le worker
// pour éviter les problèmes d'import circulaire

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

function detect821SE(workbook: XLSX.WorkBook): boolean {
  const summary = workbook.Sheets['Summary']
  if (!summary) return false
  const a1 = cellValue(summary, 0, 0)
  if (/soundexpert\s*821/i.test(a1)) return true
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 5; c++) {
      const v = cellValue(summary, r, c).toLowerCase()
      if (v.includes('821se') || v.includes('soundexpert')) return true
    }
  }
  return false
}

interface ParseResult {
  type: 'result'
  file: MeasurementFile
}

interface ParseError {
  type: 'error'
  fileName: string
  error: string
}

interface ParseProgress {
  type: 'progress'
  fileName: string
  percent: number
}

type WorkerMessage = ParseResult | ParseError | ParseProgress

function parseInWorker(buffer: ArrayBuffer, fileName: string): MeasurementFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  // Déterminer le type de sonomètre
  const is821 = detect821SE(workbook)

  const summarySheet = workbook.Sheets['Summary']
  if (!summarySheet) {
    throw new Error('Feuille "Summary" introuvable')
  }

  const model = cellValue(summarySheet, 1, 1) || (is821 ? '821SE' : '831C')
  const serial = cellValue(summarySheet, 2, 1)
  const startRaw = cellValue(summarySheet, 3, 1)
  const stopRaw = cellValue(summarySheet, 4, 1)
  const [startDate, startTimePart] = startRaw.split(' ')
  const [, stopTimePart] = stopRaw.split(' ')

  // Défauts dépendant du modèle
  let timeCol: number
  let laeqCol: number
  let recordTypeCol: number
  let spectraStart: number
  let spectraEnd: number
  if (is821) {
    timeCol = 1; laeqCol = 2; recordTypeCol = -1
    spectraStart = 37; spectraEnd = 62
  } else {
    timeCol = 2; laeqCol = 4; recordTypeCol = 1
    spectraStart = 41; spectraEnd = 67
  }

  // Trouver la feuille d'historique
  let historySheet = workbook.Sheets['Time History']

  if (!historySheet) {
    // Recherche heuristique
    for (const sheetName of workbook.SheetNames) {
      if (sheetName === 'Summary') continue
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
      if (rows.length < 2) continue
      const header = rows[0]
      if (!header) continue
      const headers = header.map((h) => String(h ?? '').toLowerCase())
      const hasTime = headers.some((h) => h.includes('time') || h.includes('date'))
      const hasLaeq = headers.some((h) => h.includes('laeq') || h.includes('leq'))
      if (hasTime && hasLaeq) {
        historySheet = sheet
        // Détecter les colonnes dynamiquement
        const tIdx = headers.findIndex((h) => h.includes('time') || h.includes('date'))
        if (tIdx >= 0) timeCol = tIdx
        const lIdx = headers.findIndex((h) => h.includes('laeq') || h.includes('leq'))
        if (lIdx >= 0) laeqCol = lIdx
        const rIdx = headers.findIndex((h) => h.includes('record') || h.includes('type'))
        if (rIdx >= 0) recordTypeCol = rIdx
        break
      }
    }
  }

  if (!historySheet) {
    throw new Error('Aucune feuille d\'historique temporel trouvée')
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(historySheet, {
    header: 1,
    defval: null,
  }) as unknown[][]

  const data: MeasurementFile['data'] = []
  const total = rows.length

  for (let i = 1; i < total; i++) {
    const row = rows[i]
    if (!row) continue

    if (recordTypeCol >= 0) {
      const recordType = row[recordTypeCol]
      if (recordType !== null && recordType !== '' && recordType !== undefined) continue
    }

    const timeVal = row[timeCol]
    const tVal = timeToMinutes(timeVal) % 1440 // Ramener au cycle 24h

    const laeqVal = row[laeqCol]
    const laeq = typeof laeqVal === 'number' ? laeqVal : parseFloat(String(laeqVal))
    if (!Number.isFinite(laeq)) continue

    // Spectres
    const spectra: number[] = []
    for (let c = spectraStart; c <= spectraEnd && c < row.length; c++) {
      const v = row[c]
      const num = typeof v === 'number' ? v : parseFloat(String(v))
      if (!isNaN(num)) spectra.push(num)
    }

    data.push({
      t: tVal,
      laeq,
      ...(spectra.length > 0 ? { spectra } : {}),
    })

    // Envoyer la progression tous les 5000 points
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

  // Bandes 1/3 d'octave selon le modèle
  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0
  const sourceFreqs = is821 ? SE821_FREQS : SE831C_FREQS
  const spectraFreqs =
    nBands === sourceFreqs.length ? sourceFreqs : sourceFreqs.slice(0, nBands)

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model,
    serial,
    date: startDate ?? '',
    startTime: startTimePart?.slice(0, 5) ?? '00:00',
    stopTime: stopTimePart?.slice(0, 5) ?? '00:00',
    point: null,
    data,
    rowCount: data.length,
    ...(nBands > 0 ? { spectraFreqs } : {}),
  }
}

// Écouter les messages du thread principal
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
