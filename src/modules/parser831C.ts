/**
 * Parser pour fichiers XLSX du sonomètre SoundAdvisor 831C (Larson Davis)
 */
import * as XLSX from 'xlsx'
import type { MeasurementFile, DataPoint } from '../types'

/**
 * Bandes 1/3 d'octave émises par le 831C dans les colonnes 41-67 (27 bandes
 * 50 Hz → 20 kHz, Z-pondéré). Utilisé pour aligner les spectres downstream.
 */
export const SE831C_FREQ_BANDS: number[] = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
  500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
  5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

/**
 * Convertit une heure au format "HH:MM:SS" ou fraction Excel en minutes depuis minuit
 */
function timeToMinutes(value: unknown): number {
  if (typeof value === 'number') {
    // fraction Excel : 1.0 = 24h
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
    // supposé déjà au format lisible, on retourne tel quel
    return value
  }
  return ''
}

/**
 * Extrait une chaîne depuis une cellule de la feuille Summary
 */
function summaryCell(sheet: XLSX.WorkSheet, row: number, col: number): string {
  const addr = XLSX.utils.encode_cell({ r: row, c: col })
  const cell = sheet[addr]
  return cell ? String(cell.v) : ''
}

/**
 * Lit un fichier XLSX 831C et retourne un objet MeasurementFile
 * @param buffer - contenu binaire du fichier
 * @param fileName - nom du fichier original
 */
export function parse831C(buffer: ArrayBuffer, fileName: string): MeasurementFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  // --- Feuille Summary ---
  const summarySheet = workbook.Sheets['Summary']
  if (!summarySheet) {
    throw new Error('Feuille "Summary" introuvable dans le fichier 831C')
  }

  // Lecture des métadonnées (positions à adapter selon la version du firmware)
  const model = summaryCell(summarySheet, 1, 1)
  const serial = summaryCell(summarySheet, 2, 1)
  const startRaw = summaryCell(summarySheet, 3, 1)
  const stopRaw = summaryCell(summarySheet, 4, 1)

  // Séparation date / heure (format attendu : "YYYY-MM-DD HH:MM:SS")
  const [startDate, startTimePart] = startRaw.split(' ')
  const [, stopTimePart] = stopRaw.split(' ')

  // --- Feuille Time History ---
  const historySheet = workbook.Sheets['Time History']
  if (!historySheet) {
    throw new Error('Feuille "Time History" introuvable dans le fichier 831C')
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(historySheet, {
    header: 1,
    defval: null,
  }) as unknown[][]

  const data: DataPoint[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    // Colonne index 1 : Record Type — on ignore les lignes non vides
    const recordType = row[1]
    if (recordType !== null && recordType !== '' && recordType !== undefined) {
      continue
    }

    // Colonne index 2 : Date/heure → conversion en minutes depuis minuit
    const timeVal = row[2]
    const t = timeToMinutes(timeVal) % 1440 // Ramener au cycle 24h

    // Colonne index 4 : LAeq
    const laeqVal = row[4]
    const laeq = typeof laeqVal === 'number' ? laeqVal : parseFloat(String(laeqVal))
    if (isNaN(laeq)) continue

    // Colonne index 9 : LCeq (pondération C) — utilisé pour la correction Kb
    // selon les Lignes directrices MELCCFP 2026
    const lceqVal = row[9]
    const lceqNum = typeof lceqVal === 'number' ? lceqVal : parseFloat(String(lceqVal))
    const lceq = isNaN(lceqNum) ? undefined : lceqNum

    // Colonne index 8 : LAImax (utilisé comme proxy de LAFTeq) — correction Ki
    // Note : LAImax et LAFTeq ne sont pas équivalents au sens strict,
    // mais le 831C n'expose pas LAFTeq dans Time History.
    const laftVal = row[8]
    const laftNum = typeof laftVal === 'number' ? laftVal : parseFloat(String(laftVal))
    const laftEq = isNaN(laftNum) ? undefined : laftNum

    // Colonnes index 41–67 : spectres 1/3 octave LZeq (6.3 Hz – 20 kHz)
    const spectra: number[] = []
    for (let c = 41; c <= 67 && c < row.length; c++) {
      const v = row[c]
      const num = typeof v === 'number' ? v : parseFloat(String(v))
      if (!isNaN(num)) spectra.push(num)
    }

    data.push({
      t,
      laeq,
      ...(lceq !== undefined ? { lceq } : {}),
      ...(laftEq !== undefined ? { laftEq } : {}),
      ...(spectra.length > 0 ? { spectra } : {}),
    })
  }

  if (data.length === 0) {
    throw new Error(`Aucune donnée LAeq valide trouvée dans "${fileName}" (831C)`)
  }

  // Bandes 1/3 d'octave 831C : cols 41-67 = 27 bandes 50 Hz → 20 kHz (LZeq)
  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0
  const spectraFreqs =
    nBands === SE831C_FREQ_BANDS.length
      ? SE831C_FREQ_BANDS
      : SE831C_FREQ_BANDS.slice(0, nBands)

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model: model || '831C',
    serial,
    date: startDate ?? excelDateToISO(null),
    startTime: startTimePart?.slice(0, 5) ?? '00:00',
    stopTime: stopTimePart?.slice(0, 5) ?? '00:00',
    point: null,
    data,
    rowCount: data.length,
    ...(nBands > 0 ? { spectraFreqs } : {}),
  }
}
