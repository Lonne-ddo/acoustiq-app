/**
 * Lecteur CSV G4 EN FLUX (Phase 4) — réutilise le mapping/détection prouvés :
 *  1. échantillon borné → SheetSource (`csvSource`) → `selectFormatFromSource`
 *  2. flux complet → `rowToDataPoint(getCell, cm)` ligne par ligne, SANS jamais
 *     matérialiser le tableau des lignes brutes.
 *
 * Les cellules respectent le CONTRAT SheetSource (Phase 1) via `normalizeCell` :
 * number / sériel Excel / string / null. Aucun UI, aucun routage (Phases 5-6).
 * Métadonnées (modèle/série/heures) = défauts pour l'instant → Phase 5 (Résumé.csv).
 */
import { streamBlobLines } from '../utils/csvLineStream'
import { sniffDialect, splitLine, normalizeCell, type CsvDialect } from '../utils/csvDialect'
import {
  selectFormatFromSource,
  rowToDataPoint,
  serialDaysToISO,
  FormatError,
  type SheetSource,
  type SelectOutcome,
} from './formatDetectors'
import type { MeasurementFile, DataPoint } from '../types'

/** Nombre de lignes lues pour la détection (couvre le scan 60 lignes + en-tête). */
const DETECT_LINES = 64

const CSV_SHEET = 'CSV'

// ───────────────────────────────────────────────────────────────────────────
// Normalisation de ligne (conforme au contrat SheetSource)
// ───────────────────────────────────────────────────────────────────────────

/** Ligne d'en-têtes : cellules gardées en STRING (trim + quotes) — jamais typées
 *  en nombre (parité exacte avec le xlsx où les en-têtes sont du texte). Vide → null. */
function headerRow(line: string, dialect: CsvDialect, width: number): unknown[] {
  const row: unknown[] = splitLine(line, dialect).map((f) => {
    let s = f
    if (s.length >= 2 && s[0] === dialect.quote && s[s.length - 1] === dialect.quote) s = s.slice(1, -1)
    s = s.trim()
    return s === '' ? null : s
  })
  while (row.length < width) row.push(null)
  return row
}

/** Ligne de données : chaque champ normalisé (number/sériel/string/null), paddée. */
function dataRow(line: string, dialect: CsvDialect, width: number): unknown[] {
  const row: unknown[] = splitLine(line, dialect).map((f) => normalizeCell(f, dialect))
  while (row.length < width) row.push(null)
  return row
}

// ───────────────────────────────────────────────────────────────────────────
// Adaptateur SheetSource + échantillon de détection
// ───────────────────────────────────────────────────────────────────────────

/**
 * SheetSource au-dessus de lignes DÉJÀ lues et normalisées (feuille unique).
 * Synchrone : la lecture async bornée est faite en amont (`readCsvSampleRows`).
 */
export function csvSource(rows: unknown[][], sheetName: string = CSV_SHEET): SheetSource {
  return {
    sheetNames: [sheetName],
    sampleRows: (_name, maxRows) => rows.slice(0, maxRows),
  }
}

/**
 * Lit (en flux, borné à `maxLines`) l'en-tête + un échantillon de données, sniffe
 * le dialecte, et renvoie les lignes NORMALISÉES (paddées à largeur constante).
 */
export async function readCsvSampleRows(blob: Blob, maxLines: number = DETECT_LINES): Promise<{ dialect: CsvDialect; rows: unknown[][] }> {
  const rawLines: string[] = []
  for await (const line of streamBlobLines(blob)) {
    rawLines.push(line)
    if (rawLines.length >= maxLines) break
  }
  const dialect = sniffDialect(rawLines)
  const width = rawLines.length > 0 ? splitLine(rawLines[0], dialect).length : 0
  const rows = rawLines.map((line, i) => (i === 0 ? headerRow(line, dialect, width) : dataRow(line, dialect, width)))
  return { dialect, rows }
}

// ───────────────────────────────────────────────────────────────────────────
// Parse complet en flux
// ───────────────────────────────────────────────────────────────────────────

function formatErrorFor(outcome: Exclude<SelectOutcome, { kind: 'ok' }>, fileName: string): FormatError {
  switch (outcome.kind) {
    case 'aggregate-only':
      return new FormatError(
        `Ce CSV ne contient que des agrégats horaires (${outcome.detectorId}). ` +
        `Exportez l'historique temporel pas-à-pas depuis G4.`,
      )
    case 'ambiguous':
      return new FormatError(`Format ambigu : "${fileName}" reconnu par plusieurs détecteurs (${outcome.ids.join(', ')}).`)
    case 'none':
      return new FormatError(
        `Format non reconnu : "${fileName}". En-têtes vus : ` +
        `${outcome.sampleHeaders.length ? outcome.sampleHeaders.join(' | ') : '(aucun)'}.`,
      )
  }
}

/**
 * Parse un CSV G4 en flux et produit un MeasurementFile. Détection via SheetSource,
 * extraction via le mapping UNIQUE `rowToDataPoint`. Deux passages sur le Blob :
 * (1) échantillon borné pour la détection, (2) flux complet pour les données.
 */
export async function parseCsv(blob: Blob, fileName: string): Promise<MeasurementFile> {
  const { dialect, rows: sample } = await readCsvSampleRows(blob, DETECT_LINES)
  const outcome = selectFormatFromSource(csvSource(sample))
  if (outcome.kind !== 'ok') throw formatErrorFor(outcome, fileName)

  const cm = outcome.columnMap
  const width = sample.length > 0 ? sample[0].length : 0

  const data: DataPoint[] = []
  let firstDays = NaN
  let idx = 0
  for await (const line of streamBlobLines(blob)) {
    if (idx++ === 0) continue // en-tête déjà consommé par la détection
    const cells = dataRow(line, dialect, width)
    const getCell = (c: number) => cells[c]
    const dp = rowToDataPoint(getCell, cm)
    if (!dp) continue
    if (!Number.isFinite(firstDays)) firstDays = cm.readTimeDays(getCell)
    data.push(dp)
  }

  if (data.length === 0) {
    throw new FormatError(`Aucune donnée exploitable dans "${fileName}" (format ${outcome.detectorId} reconnu mais lignes illisibles).`)
  }

  // Alignement spectral (même logique que parseWithMatch).
  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0
  let spectraFreqs: number[] | undefined
  if (cm.spectra.kind === 'freq') spectraFreqs = cm.spectra.freqs
  else if (cm.spectra.kind === 'positional' && nBands > 0) {
    spectraFreqs = nBands === cm.spectra.bands.length ? cm.spectra.bands : cm.spectra.bands.slice(0, nBands)
  }

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model: 'Sonomètre', // défaut — Phase 5 : Résumé.csv
    serial: '',
    date: serialDaysToISO(firstDays), // data-first (pas de Résumé en Phase 4)
    startTime: '00:00',
    stopTime: '00:00',
    point: null,
    data,
    rowCount: data.length,
    ...(nBands > 0 && spectraFreqs ? { spectraFreqs } : {}),
  }
}
