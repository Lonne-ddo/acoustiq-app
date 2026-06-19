/**
 * Parser pour fichiers XLSX du sonomètre SoundAdvisor 831C (Larson Davis)
 */
import * as XLSX from 'xlsx'
import type { MeasurementFile, DataPoint } from '../types'
import { findSummarySheet, findHistorySheet } from './parser821SE'
import { detectFreqColumns, extractSpectrumRow, detectMetricColumn } from '../utils/spectraColumns'

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
 * Convertit une heure / datetime en minutes depuis minuit. Robuste à tous
 * les formats : Date JS, sériel Excel, datetime "YYYY-MM-DD HH:MM:SS",
 * heure pure "HH:MM:SS". Retourne NaN si impossible (la ligne sera sautée).
 */
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

/**
 * Formate une valeur cellule (sériel Excel, datetime string, Date JS) en
 * date ISO "YYYY-MM-DD". Retourne "" si impossible.
 */
function excelDateToISO(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = XLSX.SSF.parse_date_code(value)
    if (!date) return ''
    const y = date.y
    const m = String(date.m).padStart(2, '0')
    const d = String(date.d).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    // Already ISO ?
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    // Sériel sous forme de string ?
    const num = parseFloat(trimmed)
    if (!isNaN(num) && /^[\d.]+$/.test(trimmed)) {
      return excelDateToISO(num)
    }
    // dd/mm/yyyy
    const fr = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
    return trimmed
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

/** Extrait la valeur brute (number, Date, string) d'une cellule Summary. */
function summaryCellRaw(sheet: XLSX.WorkSheet, row: number, col: number): unknown {
  const addr = XLSX.utils.encode_cell({ r: row, c: col })
  const cell = sheet[addr]
  return cell ? cell.v : undefined
}

/**
 * Lit un fichier XLSX 831C et retourne un objet MeasurementFile
 * @param buffer - contenu binaire du fichier
 * @param fileName - nom du fichier original
 */
export function parse831C(buffer: ArrayBuffer, fileName: string): MeasurementFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  // --- Feuille Summary / Sommaire ---
  const summarySheet = findSummarySheet(workbook)
  if (!summarySheet) {
    throw new Error('Feuille "Summary" ou "Sommaire" introuvable dans le fichier de mesure')
  }

  // Lecture des métadonnées (positions à adapter selon la version du firmware)
  const model = summaryCell(summarySheet, 1, 1)
  const serial = summaryCell(summarySheet, 2, 1)
  const startRawValue = summaryCellRaw(summarySheet, 3, 1)
  const stopRawValue = summaryCellRaw(summarySheet, 4, 1)

  // Date au format ISO via excelDateToISO (gère sériel Excel, datetime
  // string, Date JS). Heure extraite séparément si la cellule est une string.
  const startDate = excelDateToISO(startRawValue)
  const startStr = typeof startRawValue === 'string' ? startRawValue : ''
  const stopStr = typeof stopRawValue === 'string' ? stopRawValue : ''
  const startTimeMatch = startStr.match(/(\d{1,2}:\d{1,2}(?::\d{1,2})?)/)
  const stopTimeMatch = stopStr.match(/(\d{1,2}:\d{1,2}(?::\d{1,2})?)/)
  const startTimePart = startTimeMatch ? startTimeMatch[1] : '00:00:00'
  const stopTimePart = stopTimeMatch ? stopTimeMatch[1] : '00:00:00'

  // --- Feuille Time History (utilise la détection partagée) ---
  const historyResult = findHistorySheet(workbook)
  if (!historyResult) {
    throw new Error('Feuille de données temporelles introuvable dans le fichier de mesure')
  }
  const historySheet = historyResult.sheet

  const rows: unknown[][] = XLSX.utils.sheet_to_json(historySheet, {
    header: 1,
    defval: null,
  }) as unknown[][]

  // Détection prioritaire des colonnes de spectre nommées par fréquence
  // (exports G4 récents : en-têtes « 6.3 », « 1000 », « 16000 »…). À défaut,
  // on retombe sur le bloc positionnel historique 41–67 (LZeq).
  const headerRow0 = (rows[0] as unknown[] | undefined) ?? []
  const freqCols = detectFreqColumns(headerRow0)
  // Colonne LAFmax 1 s (Fast) détectée par en-tête — requise pour le Ki 98-01
  // (LAFTM5). Si absente, `lafmax` reste indéfini → Ki indisponible (jamais de
  // proxy LAImax silencieux).
  const lafmaxCol = detectMetricColumn(headerRow0, ['LAFmax', 'LAFMx', 'LAF Max', 'LAFMax'])

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
    const tRaw = timeToMinutes(timeVal)
    if (!Number.isFinite(tRaw)) continue
    const t = tRaw % 1440 // Ramener au cycle 24h

    // Colonne index 4 : LAeq
    const laeqVal = row[4]
    const laeq = typeof laeqVal === 'number' ? laeqVal : parseFloat(String(laeqVal))
    if (!Number.isFinite(laeq)) continue

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

    // LAFmax 1 s (Fast) — détecté par en-tête (col variable). Requis pour Ki 98-01.
    let lafmax: number | undefined
    if (lafmaxCol != null) {
      const lv = row[lafmaxCol]
      const ln = typeof lv === 'number' ? lv : parseFloat(String(lv))
      lafmax = Number.isFinite(ln) ? ln : undefined
    }

    // Spectres : colonnes 1/3 (ou 1/1) LZeq détectées par en-tête, sinon bloc
    // positionnel historique 41–67 (LZeq, 6.3 Hz – 20 kHz).
    let spectra: number[] = []
    let spectraMax: number[] | undefined
    if (freqCols) {
      spectra = extractSpectrumRow(row, freqCols.cols) ?? []
      if (freqCols.maxCols) spectraMax = extractSpectrumRow(row, freqCols.maxCols) ?? undefined
    } else {
      for (let c = 41; c <= 67 && c < row.length; c++) {
        const v = row[c]
        const num = typeof v === 'number' ? v : parseFloat(String(v))
        if (!isNaN(num)) spectra.push(num)
      }
    }

    data.push({
      t,
      laeq,
      ...(lceq !== undefined ? { lceq } : {}),
      ...(laftEq !== undefined ? { laftEq } : {}),
      ...(lafmax !== undefined ? { lafmax } : {}),
      ...(spectra.length > 0 ? { spectra } : {}),
      ...(spectraMax && spectraMax.length > 0 ? { spectraMax } : {}),
    })
  }

  if (data.length === 0) {
    throw new Error(`Aucune donnée LAeq valide trouvée dans "${fileName}"`)
  }

  // Fréquences des bandes : issues des en-têtes si détection par fréquence,
  // sinon bloc positionnel historique 41-67 (27 bandes 50 Hz → 20 kHz, LZeq).
  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0
  const spectraFreqs = freqCols
    ? freqCols.freqs
    : nBands === SE831C_FREQ_BANDS.length
      ? SE831C_FREQ_BANDS
      : SE831C_FREQ_BANDS.slice(0, nBands)

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model: model || 'Sonomètre',
    serial,
    date: startDate || excelDateToISO(startRawValue),
    startTime: startTimePart?.slice(0, 5) ?? '00:00',
    stopTime: stopTimePart?.slice(0, 5) ?? '00:00',
    point: null,
    data,
    rowCount: data.length,
    ...(nBands > 0 ? { spectraFreqs } : {}),
  }
}
