/**
 * Détecteurs de format d'export sonomètre — architecture ouverte.
 *
 * RÈGLE CENTRALE (non négociable) : un détecteur accepte un fichier UNIQUEMENT
 * s'il reconnaît POSITIVEMENT sa structure (noms d'onglets / en-têtes
 * caractéristiques / pas temporel réel). Jamais « accepté parce que ça n'a pas
 * planté ». Une lecture qui réussit n'est pas une lecture correcte.
 *
 * Chaque format est une entrée de la table `DETECTORS` exposant une fonction
 * `scan(workbook)` isolée (« ce fichier est-il le mien ? » + mapping de colonnes
 * propre). Ajouter un format = ajouter un détecteur, sans toucher aux autres.
 *
 * La sélection (`selectFormat`) applique la règle 1/0/plusieurs :
 *   - exactement 1 reconnaît           → on parse avec celui-là
 *   - 0 reconnaît                      → « format non reconnu » + feuilles/en-têtes vus
 *   - un reconnaît mais seulement des agrégats horaires → message explicite
 *   - plusieurs reconnaissent          → ambiguïté signalée, on ne devine pas
 *
 * Le parsing lui-même (`parseWithMatch`) est UNIQUE et paramétré par le mapping
 * du détecteur retenu — plus de logique recopiée entre main-thread et worker.
 */
import * as XLSX from 'xlsx'
import type { MeasurementFile, DataPoint } from '../types'
import { detectFreqColumns, detectMetricColumn, extractSpectrumRow } from '../utils/spectraColumns'

// ───────────────────────────────────────────────────────────────────────────
// Constantes
// ───────────────────────────────────────────────────────────────────────────

/** Bandes 1/3 d'octave 831C (bloc positionnel 41-67, fallback historique). */
const SE831C_FREQ_BANDS: number[] = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
  500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
  5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

/**
 * Seuil de séparation pas-à-pas / agrégat, en secondes. Le pas-à-pas 831C/821SE
 * est de l'ordre de la seconde ; la feuille d'agrégats (« Historique de mesure »
 * / « Measurement History ») est horaire (~3600 s). Tout pas médian ≤ ce seuil
 * est considéré pas-à-pas. Choisi large (5 min) pour tolérer des enregistrements
 * au pas 1 s → 1 min sans jamais confondre avec de l'horaire.
 */
const STEPWISE_MAX_SEC = 300

// ───────────────────────────────────────────────────────────────────────────
// Helpers de lecture cellule / feuille
// ───────────────────────────────────────────────────────────────────────────

function sheetToRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
}

function headerStrings(rows: unknown[][]): string[] {
  const h = rows[0] as unknown[] | undefined
  return h ? h.map((v) => String(v ?? '')) : []
}

/** Un jeton d'en-tête est-il présent à l'IDENTIQUE (casse/espaces ignorés) ? */
function hasExactHeader(headers: string[], token: string): boolean {
  const norm = (s: string) => s.toLowerCase().trim()
  const t = norm(token)
  return headers.some((h) => norm(h) === t)
}

function num(v: unknown): number {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v))
  return n
}

/**
 * Convertit une cellule temporelle en jours-sériels Excel (jour entier +
 * fraction de journée). Nombre → tel quel ; string sériel → parseFloat ;
 * string « HH:MM:SS » → fraction de journée seule (le jour vient d'ailleurs).
 * NaN si illisible (cellule vide, marqueur) — la ligne sera sautée en amont.
 */
function toSerialDays(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return NaN
    if (/^[\d.]+$/.test(s)) {
      const n = parseFloat(s)
      return Number.isFinite(n) ? n : NaN
    }
    const t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (t) {
      return (parseInt(t[1], 10) * 3600 + parseInt(t[2], 10) * 60 + parseInt(t[3] ?? '0', 10)) / 86400
    }
  }
  return NaN
}

/** jours-sériels → minutes depuis minuit (0..1440), robuste au passage minuit. */
function serialDaysToMin(days: number): number {
  if (!Number.isFinite(days)) return NaN
  const frac = ((days % 1) + 1) % 1
  return ((frac * 1440) % 1440 + 1440) % 1440
}

/** jours-sériels → date ISO YYYY-MM-DD (via SSF). '' si impossible. */
function serialDaysToISO(days: number): string {
  if (!Number.isFinite(days)) return ''
  const d = XLSX.SSF.parse_date_code(days)
  if (!d) return ''
  return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
}

/**
 * Convertit une valeur cellule (sériel Excel, datetime string, Date JS) en ISO.
 * Portée verbatim du parser 831C historique pour non-régression des métadonnées.
 */
function excelDateToISO(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return serialDaysToISO(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    const n = parseFloat(trimmed)
    if (!isNaN(n) && /^[\d.]+$/.test(trimmed)) return serialDaysToISO(n)
    const fr = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
    return trimmed
  }
  return ''
}

function findSummarySheet(wb: XLSX.WorkBook): XLSX.WorkSheet | undefined {
  for (const name of wb.SheetNames) {
    const l = name.toLowerCase()
    if (l === 'summary' || l === 'sommaire') return wb.Sheets[name]
  }
  return undefined
}

interface Meta { model: string; serial: string; startDate: string; startTime: string; stopTime: string }

/**
 * Métadonnées depuis Summary/Sommaire (OPTIONNEL — contrairement au 831C
 * historique qui échouait sans). Reproduit la lecture 831C (cellules 1..4 en
 * col 1) pour la non-régression du chemin anglais.
 */
function readMeta(wb: XLSX.WorkBook): Meta {
  const sheet = findSummarySheet(wb)
  if (!sheet) return { model: 'Sonomètre', serial: '', startDate: '', startTime: '00:00', stopTime: '00:00' }
  const cell = (r: number, c: number): string => {
    const a = XLSX.utils.encode_cell({ r, c })
    const x = sheet[a]
    return x ? String(x.v) : ''
  }
  const raw = (r: number, c: number): unknown => {
    const a = XLSX.utils.encode_cell({ r, c })
    const x = sheet[a]
    return x ? x.v : undefined
  }
  const startRaw = raw(3, 1)
  const stopRaw = raw(4, 1)
  const startStr = typeof startRaw === 'string' ? startRaw : ''
  const stopStr = typeof stopRaw === 'string' ? stopRaw : ''
  const sm = startStr.match(/(\d{1,2}:\d{1,2}(?::\d{1,2})?)/)
  const em = stopStr.match(/(\d{1,2}:\d{1,2}(?::\d{1,2})?)/)
  return {
    model: cell(1, 1) || 'Sonomètre',
    serial: cell(2, 1),
    startDate: excelDateToISO(startRaw),
    startTime: (sm ? sm[1] : '00:00:00').slice(0, 5),
    stopTime: (em ? em[1] : '00:00:00').slice(0, 5),
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Mapping de colonnes
// ───────────────────────────────────────────────────────────────────────────

type SpectraPlan =
  | { kind: 'freq'; cols: number[]; freqs: number[]; maxCols?: number[] }
  | { kind: 'positional'; start: number; end: number; bands: number[] }
  | { kind: 'none' }

export interface ColumnMap {
  recordTypeCol: number      // -1 si absent ; ligne à cellule non vide = marqueur → sautée
  laeqCol: number            // -1 si absent (⇒ feuille non éligible)
  lceqCol: number
  lafmaxCol: number          // LAFmax 1 s (Ki 98-01)
  laftEqCol: number          // LAImax (proxy LAFTeq, Ki 2026)
  /** jours-sériels du timestamp de la ligne, NaN si illisible. */
  readTimeDays(row: unknown[]): number
  spectra: SpectraPlan
}

/** Stratégie de mapping temps propre à un format. */
type TimeStrategy =
  | { kind: 'single'; dateAlias: string }                 // une colonne = datetime complet (EN)
  | { kind: 'combine'; dateAlias: string; timeAlias: string } // Date + Temps séparés (FR)

interface FormatSpec {
  recordTypeAliases: string[]
  timeStrategy: TimeStrategy
  /** Bloc spectral positionnel de repli si aucune bande nommée détectée. */
  positionalSpectra?: { start: number; end: number; bands: number[] }
}

/** Construit le mapping de colonnes d'une feuille selon la spec de format. */
function buildColumnMap(headers: string[], spec: FormatSpec): ColumnMap {
  const col = (aliases: string[]) => detectMetricColumn(headers, aliases) ?? -1
  const recordTypeCol = col(spec.recordTypeAliases)
  const laeqCol = col(['LAeq'])
  const lceqCol = col(['LCeq'])
  const lafmaxCol = col(['LAFmax', 'LAFMx', 'LAF Max', 'LAFMax'])
  const laftEqCol = col(['LAImax'])

  let readTimeDays: (row: unknown[]) => number
  if (spec.timeStrategy.kind === 'single') {
    const dateCol = col([spec.timeStrategy.dateAlias])
    readTimeDays = (row) => (dateCol < 0 ? NaN : toSerialDays(row[dateCol]))
  } else {
    const dateCol = col([spec.timeStrategy.dateAlias])
    const timeCol = col([spec.timeStrategy.timeAlias])
    // Combine : jour entier depuis « Date », fraction de journée depuis « Temps ».
    // Robuste que « Date » soit date-seule OU datetime complet.
    readTimeDays = (row) => {
      const dDays = dateCol < 0 ? NaN : toSerialDays(row[dateCol])
      const tDays = timeCol < 0 ? NaN : toSerialDays(row[timeCol])
      if (!Number.isFinite(dDays) && !Number.isFinite(tDays)) return NaN
      const dayPart = Number.isFinite(dDays) ? Math.floor(dDays) : 0
      const fracPart = Number.isFinite(tDays) ? ((tDays % 1) + 1) % 1 : 0
      return dayPart + fracPart
    }
  }

  const freq = detectFreqColumns(headers)
  const spectra: SpectraPlan = freq
    ? { kind: 'freq', cols: freq.cols, freqs: freq.freqs, maxCols: freq.maxCols }
    : spec.positionalSpectra
      ? { kind: 'positional', ...spec.positionalSpectra }
      : { kind: 'none' }

  return { recordTypeCol, laeqCol, lceqCol, lafmaxCol, laftEqCol, readTimeDays, spectra }
}

// ───────────────────────────────────────────────────────────────────────────
// Mesure du pas temporel réel (critère de sélection de feuille — POINT #4)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Pas temporel médian d'une feuille, en secondes, mesuré sur les premières
 * lignes de DONNÉES (marqueurs sautés). Infinity si indéterminable (< 2 points).
 * C'est ce critère — pas l'ordre d'une liste de noms — qui distingue la feuille
 * pas-à-pas de la feuille d'agrégats horaires.
 */
function measureStepSec(rows: unknown[][], cm: ColumnMap, sampleRows = 40): number {
  const days: number[] = []
  for (let i = 1; i < rows.length && days.length < sampleRows; i++) {
    const row = rows[i]
    if (!row) continue
    if (cm.recordTypeCol >= 0) {
      const rt = row[cm.recordTypeCol]
      if (rt !== null && rt !== '' && rt !== undefined) continue // marqueur
    }
    const d = cm.readTimeDays(row)
    if (!Number.isFinite(d)) continue
    if (cm.laeqCol < 0 || !Number.isFinite(num(row[cm.laeqCol]))) continue
    days.push(d)
  }
  if (days.length < 2) return Infinity
  const deltas: number[] = []
  for (let i = 1; i < days.length; i++) {
    const dt = (days[i] - days[i - 1]) * 86400
    if (dt > 0 && Number.isFinite(dt)) deltas.push(dt)
  }
  if (deltas.length === 0) return Infinity
  deltas.sort((a, b) => a - b)
  return deltas[Math.floor(deltas.length / 2)] // médiane
}

// ───────────────────────────────────────────────────────────────────────────
// Détecteurs
// ───────────────────────────────────────────────────────────────────────────

/** Résultat du scan d'un détecteur sur un classeur. */
export type DetectorScan =
  | { kind: 'match'; sheetName: string; columnMap: ColumnMap; stepSec: number; reason: string; dateStrategy: 'summary-first' | 'data-first' }
  | { kind: 'aggregate-only'; sheetName: string; reason: string }
  | null

export interface FormatDetector {
  id: string
  label: string
  scan(wb: XLSX.WorkBook): DetectorScan
}

/**
 * Fabrique un détecteur à partir d'une spec + prédicat d'appartenance de feuille.
 * Reconnaissance POSITIVE : une feuille appartient au format si ses en-têtes
 * portent la signature de langue du format (ex. « laeq » + « time » EN, jamais
 * par absence d'échec). Parmi les feuilles appartenantes, la feuille pas-à-pas
 * est retenue par PAS TEMPOREL réel ; si seule une agrégée existe → aggregate-only.
 */
function makeDetector(cfg: {
  id: string
  label: string
  spec: FormatSpec
  belongs(headers: string[]): boolean
  dateStrategy: 'summary-first' | 'data-first'
  reasonFor(sheetName: string, stepSec: number): string
}): FormatDetector {
  return {
    id: cfg.id,
    label: cfg.label,
    scan(wb) {
      const candidates: Array<{ name: string; cm: ColumnMap; stepSec: number }> = []
      for (const name of wb.SheetNames) {
        const rows = sheetToRows(wb.Sheets[name])
        if (rows.length < 2) continue
        const headers = headerStrings(rows)
        if (!cfg.belongs(headers)) continue
        const cm = buildColumnMap(headers, cfg.spec)
        if (cm.laeqCol < 0) continue // signature incomplète
        candidates.push({ name, cm, stepSec: measureStepSec(rows, cm) })
      }
      if (candidates.length === 0) return null

      // Feuille pas-à-pas = plus petit pas ≤ seuil. Sinon : agrégats seuls.
      const stepwise = candidates
        .filter((c) => c.stepSec <= STEPWISE_MAX_SEC)
        .sort((a, b) => a.stepSec - b.stepSec)
      if (stepwise.length > 0) {
        const best = stepwise[0]
        return {
          kind: 'match',
          sheetName: best.name,
          columnMap: best.cm,
          stepSec: best.stepSec,
          reason: cfg.reasonFor(best.name, best.stepSec),
          dateStrategy: cfg.dateStrategy,
        }
      }
      // Format reconnu mais uniquement des agrégats (pas horaire) → explicite.
      const finest = candidates.sort((a, b) => a.stepSec - b.stepSec)[0]
      return {
        kind: 'aggregate-only',
        sheetName: finest.name,
        reason: `pas temporel ~${Math.round(finest.stepSec)} s (agrégats, pas de pas-à-pas)`,
      }
    },
  }
}

/**
 * G4 ANGLAIS — signature : feuille avec en-têtes anglais « LAeq » + « Time »
 * (colonne « Date » = datetime complet). Formalise le comportement historique
 * de `parse831C` (positions LAeq=4/LCeq=9/LAImax=8/temps=col Date, spectres
 * nommés puis bloc 41-67). Parsing IDENTIQUE à aujourd'hui pour ces fichiers.
 */
const g4EnDetector: FormatDetector = makeDetector({
  id: 'g4-en',
  label: 'G4 anglais (Time History)',
  spec: {
    recordTypeAliases: ['Record Type'],
    timeStrategy: { kind: 'single', dateAlias: 'Date' },
    positionalSpectra: { start: 41, end: 67, bands: SE831C_FREQ_BANDS },
  },
  // Anglais : présence des colonnes « LAeq » ET « Time » ET « Date », SANS « Temps ».
  belongs: (h) => hasExactHeader(h, 'LAeq') && hasExactHeader(h, 'Time') && hasExactHeader(h, 'Date') && !hasExactHeader(h, 'Temps'),
  dateStrategy: 'summary-first',
  reasonFor: (name, step) => `onglet « ${name} » : en-têtes EN (LAeq, Date, Time, Record Type), pas temporel ~${step < 2 ? '1' : Math.round(step)} s`,
})

/**
 * Table des détecteurs. Ajouter un format = ajouter une entrée ici, sans
 * modifier les autres.
 */
export const DETECTORS: FormatDetector[] = [g4EnDetector]

// ───────────────────────────────────────────────────────────────────────────
// Sélection
// ───────────────────────────────────────────────────────────────────────────

export type SelectOutcome =
  | { kind: 'ok'; detectorId: string; detectorLabel: string; sheetName: string; columnMap: ColumnMap; reason: string; dateStrategy: 'summary-first' | 'data-first' }
  | { kind: 'none'; seenSheets: string[]; sampleHeaders: string[] }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'aggregate-only'; detectorId: string; sheetName: string }

/** Applique la règle 1/0/plusieurs sur la table des détecteurs. */
export function selectFormat(wb: XLSX.WorkBook): SelectOutcome {
  const scans = DETECTORS.map((d) => ({ d, scan: d.scan(wb) }))
  const matches = scans.filter((s): s is { d: FormatDetector; scan: Extract<DetectorScan, { kind: 'match' }> } => s.scan?.kind === 'match')

  if (matches.length === 1) {
    const { d, scan } = matches[0]
    return { kind: 'ok', detectorId: d.id, detectorLabel: d.label, sheetName: scan.sheetName, columnMap: scan.columnMap, reason: scan.reason, dateStrategy: scan.dateStrategy }
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', ids: matches.map((m) => m.d.id) }
  }

  // Aucun match pas-à-pas : format reconnu en agrégats seuls ?
  const agg = scans.find((s) => s.scan?.kind === 'aggregate-only')
  if (agg && agg.scan?.kind === 'aggregate-only') {
    return { kind: 'aggregate-only', detectorId: agg.d.id, sheetName: agg.scan.sheetName }
  }

  // Diagnostic : feuilles vues + en-têtes d'une feuille de données plausible.
  const seenSheets = wb.SheetNames.slice()
  let sampleHeaders: string[] = []
  for (const name of wb.SheetNames) {
    const rows = sheetToRows(wb.Sheets[name])
    if (rows.length >= 2) {
      const hs = headerStrings(rows).filter((h) => h.trim() !== '')
      if (hs.length > sampleHeaders.length) sampleHeaders = hs
    }
  }
  return { kind: 'none', seenSheets, sampleHeaders: sampleHeaders.slice(0, 20) }
}

// ───────────────────────────────────────────────────────────────────────────
// Parsing unique paramétré par le mapping
// ───────────────────────────────────────────────────────────────────────────

export interface ParseOptions {
  onProgress?: (fraction: number) => void
}

/** Boucle d'extraction UNIQUE, paramétrée par le mapping du détecteur retenu. */
export function parseWithMatch(
  wb: XLSX.WorkBook,
  match: Extract<SelectOutcome, { kind: 'ok' }>,
  fileName: string,
  opts: ParseOptions = {},
): MeasurementFile {
  const cm = match.columnMap
  const rows = sheetToRows(wb.Sheets[match.sheetName])
  const total = rows.length
  const data: DataPoint[] = []
  let firstDays = NaN

  for (let i = 1; i < total; i++) {
    const row = rows[i]
    if (!row) continue

    // Marqueur (« Départ », « Run », « Calibration Change »…) → sauté proprement.
    if (cm.recordTypeCol >= 0) {
      const rt = row[cm.recordTypeCol]
      if (rt !== null && rt !== '' && rt !== undefined) continue
    }

    const days = cm.readTimeDays(row)
    if (!Number.isFinite(days)) continue
    const t = serialDaysToMin(days)

    const laeq = num(row[cm.laeqCol])
    if (!Number.isFinite(laeq)) continue

    if (!Number.isFinite(firstDays)) firstDays = days

    const dp: DataPoint = { t, laeq }
    if (cm.lceqCol >= 0) { const v = num(row[cm.lceqCol]); if (Number.isFinite(v)) dp.lceq = v }
    if (cm.laftEqCol >= 0) { const v = num(row[cm.laftEqCol]); if (Number.isFinite(v)) dp.laftEq = v }
    if (cm.lafmaxCol >= 0) { const v = num(row[cm.lafmaxCol]); if (Number.isFinite(v)) dp.lafmax = v }

    if (cm.spectra.kind === 'freq') {
      const s = extractSpectrumRow(row, cm.spectra.cols)
      if (s && s.length > 0) dp.spectra = s
      if (cm.spectra.maxCols) {
        const sm = extractSpectrumRow(row, cm.spectra.maxCols)
        if (sm && sm.length > 0) dp.spectraMax = sm
      }
    } else if (cm.spectra.kind === 'positional') {
      const s: number[] = []
      for (let c = cm.spectra.start; c <= cm.spectra.end && c < row.length; c++) {
        const v = num(row[c])
        if (Number.isFinite(v)) s.push(v)
      }
      if (s.length > 0) dp.spectra = s
    }

    data.push(dp)

    if (opts.onProgress && i % 5000 === 0) opts.onProgress(i / total)
  }

  if (data.length === 0) {
    // Ne devrait pas arriver après un match (signature validée) — garde de sûreté.
    throw new Error(
      `Aucune donnée exploitable dans la feuille « ${match.sheetName} » de "${fileName}" ` +
      `(format ${match.detectorId} reconnu mais lignes illisibles).`,
    )
  }

  const meta = readMeta(wb)
  const firstDataDate = serialDaysToISO(firstDays)
  const date = match.dateStrategy === 'summary-first'
    ? (meta.startDate || firstDataDate || '')
    : (firstDataDate || meta.startDate || '')

  // Fréquences des bandes présentes (pour aligner l'affichage/analyse Kt).
  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0
  let spectraFreqs: number[] | undefined
  if (cm.spectra.kind === 'freq') spectraFreqs = cm.spectra.freqs
  else if (cm.spectra.kind === 'positional' && nBands > 0) {
    spectraFreqs = nBands === cm.spectra.bands.length ? cm.spectra.bands : cm.spectra.bands.slice(0, nBands)
  }

  return {
    id: crypto.randomUUID(),
    name: fileName,
    model: meta.model,
    serial: meta.serial,
    date,
    startTime: meta.startTime,
    stopTime: meta.stopTime,
    point: null,
    data,
    rowCount: data.length,
    ...(nBands > 0 && spectraFreqs ? { spectraFreqs } : {}),
  }
}

/** Erreur de format porteuse d'un diagnostic (feuilles/en-têtes vus). */
export class FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatError'
  }
}

/**
 * Sélectionne le format d'un classeur déjà lu puis parse. Séparé de
 * `parseWorkbook` pour la testabilité (fixtures en mémoire, sans sérialisation).
 * Lève une `FormatError` explicite — jamais un rejet muet — pour
 * none / ambiguous / aggregate-only.
 */
export function parseWorkbookFromWb(wb: XLSX.WorkBook, fileName: string, opts: ParseOptions = {}): MeasurementFile {
  const outcome = selectFormat(wb)
  switch (outcome.kind) {
    case 'ok':
      return parseWithMatch(wb, outcome, fileName, opts)
    case 'aggregate-only':
      throw new FormatError(
        `Ce fichier ne contient que des agrégats horaires (feuille « ${outcome.sheetName} »). ` +
        `Exportez l'historique temporel pas-à-pas depuis G4.`,
      )
    case 'ambiguous':
      throw new FormatError(
        `Format ambigu : "${fileName}" reconnu par plusieurs détecteurs (${outcome.ids.join(', ')}). ` +
        `Import annulé pour éviter une lecture incorrecte.`,
      )
    case 'none': {
      const sheets = outcome.seenSheets.length ? outcome.seenSheets.join(', ') : '(aucune)'
      const heads = outcome.sampleHeaders.length ? outcome.sampleHeaders.join(' | ') : '(aucun en-tête lisible)'
      throw new FormatError(
        `Format non reconnu : "${fileName}". Aucun détecteur connu (G4 anglais, G4 français) n'a ` +
        `reconnu de structure pas-à-pas.\nFeuilles vues : ${sheets}.\nEn-têtes vus : ${heads}.`,
      )
    }
  }
}

/**
 * Point d'entrée UNIQUE (buffer) : lit le classeur puis délègue. Utilisé par le
 * main-thread ET le worker — même code, plus de logique recopiée.
 */
export function parseWorkbook(buffer: ArrayBuffer, fileName: string, opts: ParseOptions = {}): MeasurementFile {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
  return parseWorkbookFromWb(wb, fileName, opts)
}
