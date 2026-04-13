/**
 * Parser pour fichiers XLSX du sonomètre 821SE / SoundExpert (Larson Davis).
 *
 * Structure réelle (vérifiée 2026-04-08) :
 * - Onglet `Summary` cellule A1 = "SoundExpert 821 Summary" (signature)
 * - Onglet Time History (nom variable) :
 *     ligne 0 = en-têtes  ·  données à partir de la ligne 1 (1 entrée/seconde)
 *     col 1  = Date/Time  (datetime complet "YYYY-MM-DD HH:MM:SS")
 *     col 2  = LAeq  (déjà A-pondéré, dB(A))
 *     cols 37-62 = LZeq 1/3 d'octave 31.5 Hz → 10 kHz (26 bandes, Z-pondéré)
 */
import * as XLSX from 'xlsx'
import type { MeasurementFile, DataPoint } from '../types'

/**
 * Bandes 1/3 d'octave émises par le 821SE (cols 37 à 62, 26 bandes).
 * Z-pondérées au parsing — l'A-weighting est appliqué à l'affichage par
 * `Spectrogram.tsx` pour la cohérence visuelle.
 */
export const SE821_FREQ_BANDS: number[] = [
  31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250,
  315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500,
  3150, 4000, 5000, 6300, 8000, 10000,
]

/**
 * Convertit une heure / datetime en minutes depuis minuit.
 *  - number (sériel Excel) → fraction de jour × 1440
 *  - string "HH:MM:SS"     → simple parse
 *  - string "YYYY-MM-DD HH:MM:SS" → extrait la partie heure via regex
 *  - Date                  → composantes locales
 */
function timeToMinutes(value: unknown): number {
  if (value instanceof Date) {
    return value.getHours() * 60 + value.getMinutes() + value.getSeconds() / 60
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * 24 * 60
  }
  if (typeof value === 'string') {
    // Match HH:MM[:SS] anywhere — gère "09:01:13" comme "2026-03-09 09:01:13"
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
 * Trouve l'onglet Summary/Sommaire dans un workbook.
 * Retourne le sheet ou undefined.
 */
export function findSummarySheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | undefined {
  // Exact match first
  if (workbook.Sheets['Summary']) return workbook.Sheets['Summary']
  if (workbook.Sheets['Sommaire']) return workbook.Sheets['Sommaire']
  // Case-insensitive fallback
  for (const name of workbook.SheetNames) {
    const lower = name.toLowerCase()
    if (lower === 'summary' || lower === 'sommaire') return workbook.Sheets[name]
  }
  return undefined
}

/**
 * Détecte si un fichier XLSX provient d'un 821SE / SoundExpert.
 * Critère : onglet Summary/Sommaire existe ET contient
 * "SoundExpert 821" dans les premières cellules.
 */
export function detect821SE(workbook: XLSX.WorkBook): boolean {
  const summary = findSummarySheet(workbook)
  if (!summary) return false
  const a1 = cellValue(summary, 0, 0)
  if (/soundexpert\s*821/i.test(a1)) return true
  // Tolérance : ancienne signature "821SE" / "SoundExpert" ailleurs dans
  // les premières cellules — utile pour les exports plus anciens.
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 5; c++) {
      const v = cellValue(summary, r, c).toLowerCase()
      if (v.includes('821se') || v.includes('soundexpert')) return true
    }
  }
  return false
}

/**
 * Trouve la feuille contenant l'historique temporel.
 * Priorité :
 *  1. Nom contenant "Time History" (831C anglais)
 *  2. Nom contenant "Historique temporel" (821SE français G4)
 *  3. Nom contenant "Time" ou "Historique"
 *  4. Première feuille avec colonnes temps + LAeq
 */
function findHistorySheet(workbook: XLSX.WorkBook): { sheet: XLSX.WorkSheet; name: string } | null {
  const summaryNames = ['summary', 'sommaire', 'paramètres', 'parametres',
    'journal de session', 'session log']

  // 1. Exact / substring match by priority
  const priorities: RegExp[] = [
    /time\s*history/i,
    /historique\s*temporel/i,
    /\btime\b/i,
    /\bhistorique\b/i,
  ]
  for (const re of priorities) {
    for (const sheetName of workbook.SheetNames) {
      if (re.test(sheetName)) {
        return { sheet: workbook.Sheets[sheetName], name: sheetName }
      }
    }
  }

  // 2. Heuristic: first sheet with time + LAeq columns
  for (const sheetName of workbook.SheetNames) {
    if (summaryNames.includes(sheetName.toLowerCase())) continue
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
    if (rows.length < 2) continue
    const header = rows[0]
    if (!header) continue
    const headerStr = header.map((h) => String(h ?? '').toLowerCase())
    const hasTime = headerStr.some((h) =>
      h.includes('time') || h.includes('date') || h.includes('heure'))
    const hasLaeq = headerStr.some((h) =>
      h.includes('laeq') || h.includes('la eq') || h.includes('leq'))
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

  // --- Feuille Summary / Sommaire ---
  const summarySheet = findSummarySheet(workbook)
  if (!summarySheet) {
    throw new Error('Feuille "Summary" ou "Sommaire" introuvable dans le fichier de mesure')
  }

  const model = cellValue(summarySheet, 1, 1) || 'Sonomètre'
  const serial = cellValue(summarySheet, 2, 1)
  const startRaw = cellValue(summarySheet, 3, 1)
  const stopRaw = cellValue(summarySheet, 4, 1)

  const [startDate, startTimePart] = startRaw.split(' ')
  const [, stopTimePart] = stopRaw.split(' ')

  // --- Feuille d'historique ---
  const history = findHistorySheet(workbook)
  if (!history) {
    throw new Error('Aucune feuille d\'historique temporel trouvée dans le fichier de mesure')
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(history.sheet, {
    header: 1,
    defval: null,
  }) as unknown[][]

  // Défauts 821SE — structure réelle vérifiée 2026-04-08 :
  // col 1 = Date/Time · col 2 = LAeq · cols 37-62 = LZeq 26 bandes
  let timeCol = 1
  let laeqCol = 2
  let recordTypeCol = -1  // pas de colonne Record Type sur 821SE
  let spectraStart = 37
  let spectraEnd = 62

  // Affinage par les en-têtes si présents et explicites
  // Variantes FR : "Date / heure", "Type d'enregistrement", "Batterie (%)", "Externe (V)", "Surcharge"
  const headerRow = rows[0] as unknown[] | undefined
  if (headerRow) {
    const headers = headerRow.map((h) => String(h ?? '').toLowerCase())
    const tIdx = headers.findIndex((h) =>
      h.includes('time') || h.includes('date') || h.includes('heure'))
    if (tIdx >= 0) timeCol = tIdx
    const lIdx = headers.findIndex((h) =>
      h === 'laeq' || h.includes('la eq') || (h.includes('leq') && !h.includes('lzeq') && !h.includes('lceq')))
    if (lIdx >= 0) laeqCol = lIdx
    const rIdx = headers.findIndex((h) =>
      h.includes('record') || h.includes('enregistrement') || h.includes('type'))
    if (rIdx >= 0) recordTypeCol = rIdx
    const specStart = headers.findIndex((h) => h.includes('lzeq') || h.includes('lz eq'))
    if (specStart >= 0) {
      spectraStart = specStart
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

    // 821SE n'a pas de colonne Record Type — n'appliquer le filtre que si
    // explicitement détectée par les en-têtes.
    if (recordTypeCol >= 0) {
      const recordType = row[recordTypeCol]
      if (recordType !== null && recordType !== '' && recordType !== undefined) {
        continue
      }
    }

    const timeVal = row[timeCol]
    const t = timeToMinutes(timeVal) % 1440 // Ramener au cycle 24h

    const laeqVal = row[laeqCol]
    const laeq = typeof laeqVal === 'number' ? laeqVal : parseFloat(String(laeqVal))
    if (!Number.isFinite(laeq)) continue

    // Spectres 1/3 octave LZeq (Z-pondéré). L'A-pondération est appliquée
    // par le composant Spectrogram à l'affichage uniquement.
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
    throw new Error(
      `Aucune donnée LAeq valide trouvée dans "${fileName}". ` +
      `Vérifiez les colonnes Date/Time et LAeq dans l'onglet Time History.`,
    )
  }

  // Aligner spectraFreqs sur le nombre réel de bandes lues (26 si défauts).
  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0
  const spectraFreqs =
    nBands === SE821_FREQ_BANDS.length
      ? SE821_FREQ_BANDS
      : SE821_FREQ_BANDS.slice(0, nBands)

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model: model || 'Sonomètre',
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
