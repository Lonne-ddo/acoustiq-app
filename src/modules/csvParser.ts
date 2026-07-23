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
// Métadonnées (Résumé.csv) — petit fichier lu EN ENTIER, recherche PAR CLÉ
// ───────────────────────────────────────────────────────────────────────────

export interface CsvMeta {
  model: string
  serial: string
  startTime: string // HH:MM
  stopTime: string // HH:MM
}

/** Défauts si Résumé absent/illisible — jamais bloquant (cf. readMeta xlsx). */
export const DEFAULT_CSV_META: CsvMeta = { model: 'Sonomètre', serial: '', startTime: '00:00', stopTime: '00:00' }

/** Retire les octets NUL (U+0000) de padding G4 + trim. */
const cleanCell = (v: unknown): string => String(v ?? '').split(String.fromCharCode(0)).join('').trim()

/** Extrait HH:MM d'une valeur datetime (tolère espace simple OU double). */
function toHHMM(value: string): string | null {
  const m = value.match(/(\d{1,2}):(\d{2})(?::\d{2})?/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/**
 * Parse (PUR) les métadonnées d'un Résumé G4 depuis ses lignes + dialecte.
 * Recherche PAR CLÉ (col0), pas par index — la structure du Résumé varie. Modèle
 * en col1 / sériel en col2 de la ligne « Mètre » ; heures depuis « Heure de
 * départ » / « Temps d'arrêt » (col1). Champs manquants → défauts.
 */
export function parseResumeMeta(lines: string[], dialect: CsvDialect): CsvMeta {
  const meta: CsvMeta = { ...DEFAULT_CSV_META }
  for (const line of lines) {
    const f = splitLine(line, dialect)
    const key = cleanCell(f[0]).toLowerCase()
    if (key === 'mètre') {
      const model = cleanCell(f[1]); if (model) meta.model = model
      const serial = cleanCell(f[2]); if (serial) meta.serial = serial // NUL déjà strippé
    } else if (key === 'heure de départ') {
      const t = toHHMM(cleanCell(f[1])); if (t) meta.startTime = t
    } else if (key === "temps d'arrêt") {
      const t = toHHMM(cleanCell(f[1])); if (t) meta.stopTime = t
    }
  }
  return meta
}

/** Lit un Résumé.csv (petit) en ENTIER (cp1252) et en extrait les métadonnées. */
export async function readResumeMeta(blob: Blob): Promise<CsvMeta> {
  const lines: string[] = []
  for await (const l of streamBlobLines(blob)) lines.push(l)
  return parseResumeMeta(lines, sniffDialect(lines))
}

/** Vrai si le nom ressemble à un Résumé (FR « Résumé » / EN « Summary »). */
function isResumeName(name: string): boolean {
  return /r[eé]sum[eé]|summary/i.test(name)
}

/**
 * Préfixe de session commun à deux noms. VALIDE uniquement si leur plus long
 * préfixe commun se termine SUR une frontière de segment '_' — c.-à-d. les deux
 * partagent l'INTÉGRALITÉ de « <session>_ » puis diffèrent sur le descripteur.
 *
 * Un LCP finissant en plein milieu d'un segment (ex. deux sessions du même
 * instrument dont les dates divergent : « …-25|0703 » vs « …-25|0919 ») = sessions
 * DIFFÉRENTES → '' (pas d'appariement partiel sur « 821SE_40489- »). Robuste aux
 * '_' internes du descripteur « Histoire_du_temps » (on ne découpe pas au 1er '_').
 */
function commonSessionPrefix(a: string, b: string): string {
  let i = 0
  const min = Math.min(a.length, b.length)
  while (i < min && a[i] === b[i]) i++
  const lcp = a.slice(0, i)
  return lcp.endsWith('_') ? lcp.slice(0, -1) : ''
}

/**
 * Trouve le Résumé apparié à un Histoire parmi des noms candidats : celui, nommé
 * « Résumé »/« Summary », qui partage le plus long préfixe de session. undefined
 * si aucun (→ le fichier se charge quand même avec les défauts).
 */
export function pairResume(histoireName: string, candidateNames: string[]): string | undefined {
  let best: string | undefined
  let bestLen = 0
  for (const c of candidateNames) {
    if (c === histoireName || !isResumeName(c)) continue
    const len = commonSessionPrefix(histoireName, c).length
    if (len > bestLen) { bestLen = len; best = c }
  }
  return best
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
 *
 * `resumeBlob` (optionnel) : le Résumé.csv apparié → modèle/série/heures. Absent →
 * défauts (`Sonomètre`/`''`/`00:00`). La DATE reste data-first (depuis les données).
 */
export async function parseCsv(blob: Blob, fileName: string, resumeBlob?: Blob): Promise<MeasurementFile> {
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

  // Métadonnées depuis le Résumé apparié, sinon défauts (jamais bloquant).
  const meta = resumeBlob ? await readResumeMeta(resumeBlob) : DEFAULT_CSV_META

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model: meta.model,
    serial: meta.serial,
    date: serialDaysToISO(firstDays), // data-first (la date vient des données)
    startTime: meta.startTime,
    stopTime: meta.stopTime,
    point: null,
    data,
    rowCount: data.length,
    ...(nBands > 0 && spectraFreqs ? { spectraFreqs } : {}),
  }
}
