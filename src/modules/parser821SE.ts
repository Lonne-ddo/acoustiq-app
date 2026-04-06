/**
 * Parser pour fichiers XLSX du sonomètre 821SE / SoundExpert (Larson Davis)
 * Structure similaire au 831C mais avec des noms de feuilles différents
 */
import * as XLSX from 'xlsx'
import type { MeasurementFile, DataPoint } from '../types'

/**
 * Convertit une heure au format "HH:MM:SS" ou fraction Excel en minutes depuis minuit
 */
function timeToMinutes(value: unknown): number {
  if (typeof value === 'number') {
    return value * 24 * 60
  }
  if (typeof value === 'string') {
    const parts = value.split(':').map(Number)
    return parts[0] * 60 + (parts[1] ?? 0) + (parts[2] ?? 0) / 60
  }
  return 0
}

/**
 * Formate une fraction Excel de date en "YYYY-MM-DD"
 */
function excelDateToISO(value: unknown): string {
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value)
    const y = date.y
    const m = String(date.m).padStart(2, '0')
    const d = String(date.d).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'string') {
    return value
  }
  return ''
}

/**
 * Extrait une chaîne depuis une cellule
 */
function cellValue(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const addr = XLSX.utils.encode_cell({ r: row, c: col })
  const cell = sheet[addr]
  return cell ? String(cell.v) : ''
}

/**
 * Détecte si un fichier XLSX provient d'un 821SE / SoundExpert
 */
export function detect821SE(workbook: XLSX.WorkBook): boolean {
  const summary = workbook.Sheets['Summary']
  if (!summary) return false
  // Parcourir les premières lignes pour détecter le modèle
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 5; c++) {
      const v = cellValue(summary, r, c).toLowerCase()
      if (v.includes('821se') || v.includes('soundexpert')) return true
    }
  }
  return false
}

/**
 * Trouve la feuille contenant l'historique temporel
 * Priorité : "Time History" > première feuille avec colonnes temps + LAeq
 */
function findHistorySheet(workbook: XLSX.WorkBook): { sheet: XLSX.WorkSheet; name: string } | null {
  // Essai direct "Time History"
  if (workbook.Sheets['Time History']) {
    return { sheet: workbook.Sheets['Time History'], name: 'Time History' }
  }

  // Recherche heuristique dans les autres feuilles
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'Summary') continue
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
    if (rows.length < 2) continue

    // Vérifier si la feuille contient des colonnes temps + LAeq
    const header = rows[0]
    if (!header) continue
    const headerStr = header.map((h) => String(h ?? '').toLowerCase())
    const hasTime = headerStr.some((h) => h.includes('time') || h.includes('date') || h.includes('heure'))
    const hasLaeq = headerStr.some((h) => h.includes('laeq') || h.includes('la eq') || h.includes('leq'))
    if (hasTime && hasLaeq) {
      return { sheet, name: sheetName }
    }
  }

  return null
}

/**
 * Lit un fichier XLSX 821SE et retourne un objet MeasurementFile
 */
export function parse821SE(buffer: ArrayBuffer, fileName: string): MeasurementFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  // --- Feuille Summary ---
  const summarySheet = workbook.Sheets['Summary']
  if (!summarySheet) {
    throw new Error('Feuille "Summary" introuvable dans le fichier 821SE')
  }

  const model = cellValue(summarySheet, 1, 1) || '821SE'
  const serial = cellValue(summarySheet, 2, 1)
  const startRaw = cellValue(summarySheet, 3, 1)
  const stopRaw = cellValue(summarySheet, 4, 1)

  const [startDate, startTimePart] = startRaw.split(' ')
  const [, stopTimePart] = stopRaw.split(' ')

  // --- Feuille d'historique ---
  const history = findHistorySheet(workbook)
  if (!history) {
    throw new Error('Aucune feuille d\'historique temporel trouvée dans le fichier 821SE')
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(history.sheet, {
    header: 1,
    defval: null,
  }) as unknown[][]

  // Détecter dynamiquement les colonnes temps et LAeq
  const headerRow = rows[0] as unknown[] | undefined
  let timeCol = 2  // par défaut comme le 831C
  let laeqCol = 4
  let recordTypeCol = 1
  let spectraStart = 41
  let spectraEnd = 67

  if (headerRow) {
    const headers = headerRow.map((h) => String(h ?? '').toLowerCase())
    // Recherche de la colonne temps
    const tIdx = headers.findIndex((h) => h.includes('time') || h.includes('date') || h.includes('heure'))
    if (tIdx >= 0) timeCol = tIdx
    // Recherche de la colonne LAeq
    const lIdx = headers.findIndex((h) => h.includes('laeq') || h.includes('la eq') || h.includes('leq'))
    if (lIdx >= 0) laeqCol = lIdx
    // Recherche de la colonne Record Type
    const rIdx = headers.findIndex((h) => h.includes('record') || h.includes('type'))
    if (rIdx >= 0) recordTypeCol = rIdx
    // Recherche des colonnes de spectre (LZeq)
    const specStart = headers.findIndex((h) => h.includes('lzeq') || h.includes('lz eq'))
    if (specStart >= 0) {
      spectraStart = specStart
      // Trouver la fin des colonnes spectrales consécutives
      let end = specStart
      for (let c = specStart + 1; c < headers.length; c++) {
        if (headers[c].includes('lzeq') || headers[c].includes('lz eq')) {
          end = c
        } else {
          break
        }
      }
      spectraEnd = end
    }
  }

  const data: DataPoint[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    // Ignorer les lignes avec un Record Type non vide
    const recordType = row[recordTypeCol]
    if (recordType !== null && recordType !== '' && recordType !== undefined) {
      continue
    }

    const timeVal = row[timeCol]
    const t = timeToMinutes(timeVal) % 1440 // Ramener au cycle 24h

    const laeqVal = row[laeqCol]
    const laeq = typeof laeqVal === 'number' ? laeqVal : parseFloat(String(laeqVal))
    if (isNaN(laeq)) continue

    // Spectres 1/3 octave si disponibles
    const spectra: number[] = []
    for (let c = spectraStart; c <= spectraEnd && c < row.length; c++) {
      const v = row[c]
      const num = typeof v === 'number' ? v : parseFloat(String(v))
      if (!isNaN(num)) spectra.push(num)
    }

    data.push({
      t,
      laeq,
      ...(spectra.length > 0 ? { spectra } : {}),
    })
  }

  if (data.length === 0) {
    throw new Error(`Aucune donnée LAeq valide trouvée dans "${fileName}" (821SE)`)
  }

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model: model.includes('821') || model.toLowerCase().includes('soundexpert') ? model : '821SE',
    serial,
    date: startDate ?? excelDateToISO(null),
    startTime: startTimePart?.slice(0, 5) ?? '00:00',
    stopTime: stopTimePart?.slice(0, 5) ?? '00:00',
    point: null,
    data,
    rowCount: data.length,
  }
}
