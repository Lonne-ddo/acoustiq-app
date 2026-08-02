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
import type { MeasurementFile, DataPoint, SpectraBlocker, SpectraSource } from '../types'
import { detectFreqColumns, detectMetricColumn, extractSpectrumCells, type SpectrumWeighting } from '../utils/spectraColumns'
import { deweightAToZ, missingAWeightBands } from '../utils/weighting'
import { FormatError } from '../utils/formatError'

export { FormatError }

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

/**
 * Lit une feuille en tableau de lignes. `maxRows` borne la lecture aux N
 * premières lignes (en-tête + échantillon) — essentiel pour la DÉTECTION : on
 * n'analyse jamais tout un « Historique temporel » de 28 000 lignes juste pour
 * lire ses en-têtes et mesurer son pas. Le parse complet (sans borne) n'a lieu
 * qu'une seule fois, sur la feuille finalement retenue.
 */
function sheetToRows(sheet: XLSX.WorkSheet, maxRows?: number): unknown[][] {
  const opts: XLSX.Sheet2JSONOpts = { header: 1, defval: null }
  if (maxRows != null && sheet['!ref']) {
    const r = XLSX.utils.decode_range(sheet['!ref'])
    opts.range = XLSX.utils.encode_range({
      s: r.s,
      e: { r: Math.min(r.e.r, r.s.r + maxRows - 1), c: r.e.c },
    })
  }
  return XLSX.utils.sheet_to_json(sheet, opts) as unknown[][]
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
export function serialDaysToISO(days: number): string {
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

/**
 * Plan d'extraction spectrale.
 *
 * `blocked` = les bandes ONT été reconnues mais ne peuvent pas être ramenées en
 * LZeq de façon exacte (cf. `SpectraBlocker`). On produit alors un fichier SANS
 * spectre plutôt qu'un spectre faux, en conservant le MOTIF — l'UI doit pouvoir
 * distinguer « ce sonomètre n'exporte pas de spectre » de « le spectre exporté
 * n'est pas exploitable ». Le reste du fichier (LAeq, LCeq, temps) se charge
 * normalement : une pondération non inversible ne justifie pas de perdre la
 * série temporelle.
 */
type SpectraPlan =
  | { kind: 'freq'; cols: number[]; freqs: number[]; maxCols?: number[]; weighting: SpectrumWeighting }
  | { kind: 'positional'; start: number; end: number; bands: number[] }
  | { kind: 'blocked'; reason: SpectraBlocker; detail: string }
  | { kind: 'none' }

export interface ColumnMap {
  recordTypeCol: number      // -1 si absent ; ligne à cellule non vide = marqueur → sautée
  laeqCol: number            // -1 si absent (⇒ feuille non éligible)
  lceqCol: number
  lafmaxCol: number          // LAFmax 1 s (Ki 98-01)
  laftEqCol: number          // LAImax (proxy LAFTeq, Ki 2026)
  /**
   * jours-sériels du timestamp de la ligne, NaN si illisible. Prend un ACCESSEUR
   * de cellule (colonne → valeur) plutôt qu'un tableau ligne, pour être partagé
   * entre le parser dense (getCell = c => row[c]) et un futur lecteur en flux.
   */
  readTimeDays(getCell: (colIndex: number) => unknown): number
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

  let readTimeDays: (getCell: (colIndex: number) => unknown) => number
  if (spec.timeStrategy.kind === 'single') {
    const dateCol = col([spec.timeStrategy.dateAlias])
    readTimeDays = (getCell) => (dateCol < 0 ? NaN : toSerialDays(getCell(dateCol)))
  } else {
    const dateCol = col([spec.timeStrategy.dateAlias])
    const timeCol = col([spec.timeStrategy.timeAlias])
    // Combine : jour entier depuis « Date », fraction de journée depuis « Temps ».
    // Robuste que « Date » soit date-seule OU datetime complet.
    readTimeDays = (getCell) => {
      const dDays = dateCol < 0 ? NaN : toSerialDays(getCell(dateCol))
      const tDays = timeCol < 0 ? NaN : toSerialDays(getCell(timeCol))
      if (!Number.isFinite(dDays) && !Number.isFinite(tDays)) return NaN
      const dayPart = Number.isFinite(dDays) ? Math.floor(dDays) : 0
      const fracPart = Number.isFinite(tDays) ? ((tDays % 1) + 1) % 1 : 0
      return dayPart + fracPart
    }
  }

  // Garde AMONT de la dépondération : un jeu A dont une bande n'a pas de
  // coefficient CEI 61672 est refusé ICI (une fois), jamais silencieusement
  // ramené à 0 dB ligne par ligne.
  const freq = detectFreqColumns(headers)
  const missingA = freq && freq.weighting === 'A' ? missingAWeightBands(freq.freqs) : []
  const spectra: SpectraPlan = freq
    ? (missingA.length > 0
        ? { kind: 'blocked', reason: 'bande-hors-table', detail: `${missingA.join(', ')} Hz` }
        : { kind: 'freq', cols: freq.cols, freqs: freq.freqs, maxCols: freq.maxCols, weighting: freq.weighting })
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
    const d = cm.readTimeDays((c) => row[c])
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

/**
 * Source de feuilles DÉCOUPLÉE du WorkBook SheetJS : la détection n'a besoin que
 * de (a) la liste des noms de feuilles et (b) les N premières lignes d'une
 * feuille (valeurs de cellule brutes, `unknown[][]`). Le parser dense l'implémente
 * via `wbSource(wb)` ; un futur lecteur en flux fournira la même interface sans
 * jamais matérialiser la feuille entière. La LOGIQUE de matching reste identique.
 *
 * ─── CONTRAT (couture streamer ↔ détection) ─────────────────────────────────
 * `sampleRows` DOIT reproduire EXACTEMENT ce que
 * `XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })` produit
 * aujourd'hui via `wbSource` (feuille lue avec `XLSX.read{cellDates:false}`).
 * Une divergence de type y produirait une corruption SILENCIEUSE (colonnes
 * décalées, spectres désalignés). Figé et vérifié par le test de conformité
 * « SheetSource — contrat de wbSource ».
 *
 * Par NATURE de cellule — valeur retournée dans `row[colIndex]` :
 *   - cellule numérique                 → `number`
 *   - date (lue avec cellDates:false)   → `number` (sériel Excel ; JAMAIS un `Date`)
 *   - shared string / inline string     → `string`
 *   - cellule VIDE ou ABSENTE           → `null`  (JAMAIS `undefined`, JAMAIS `''`)
 *
 * Par LIGNE :
 *   - chaque ligne est PADDÉE à LARGEUR CONSTANTE = largeur du range de la feuille
 *     (nb de colonnes de l'en-tête). Trous internes ET de fin comblés par `null`.
 *     Donc `row[c]` est défini (éventuellement `null`) pour tout `c ∈ [0, width)` ;
 *     au-delà, `row[c] === undefined` (hors tableau).
 *   - `row[0]` = en-têtes ; les lignes de données suivent, dans l'ordre du fichier.
 *
 * NB : le mapping aval (`rowToDataPoint`, `measureStepSec`) traite `null` et
 * `undefined` de façon équivalente (`num(null)=num(undefined)=NaN` ; un marqueur
 * `null`/`''`/`undefined` = « pas un marqueur »). Mais la détection de colonnes
 * s'appuie sur la LARGEUR et les TYPES ci-dessus : le contrat reste figé sur `null`.
 */
export interface SheetSource {
  sheetNames: string[]
  /** N premières lignes de la feuille, valeurs brutes alignées par colonne (cf. contrat). */
  sampleRows(sheetName: string, maxRows: number): unknown[][]
}

/** Adaptateur SheetSource au-dessus d'un WorkBook SheetJS (comportement inchangé). */
export function wbSource(wb: XLSX.WorkBook): SheetSource {
  return {
    sheetNames: wb.SheetNames,
    sampleRows: (name, maxRows) => sheetToRows(wb.Sheets[name], maxRows),
  }
}

export interface FormatDetector {
  id: string
  label: string
  scan(src: SheetSource): DetectorScan
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
    scan(src) {
      const candidates: Array<{ name: string; cm: ColumnMap; stepSec: number }> = []
      for (const name of src.sheetNames) {
        // Détection : en-tête + échantillon seulement (jamais toute la feuille).
        const rows = src.sampleRows(name, 60)
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
 * G4 FRANÇAIS — signature : feuille avec en-têtes FR « LAeq » + « Temps » +
 * « Date » (Date et Temps en DEUX colonnes séparées). C'est ce qui débloque le
 * fichier de référence : `combine` recompose l'horodatage (jour entier de
 * « Date » + fraction de « Temps »), là où l'ancien parseur cherchait un
 * datetime combiné anglais et retombait sur la mauvaise colonne.
 *
 * NB : les bandes spectrales du G4-FR sont libellées à décimale VIRGULE
 * (« 1/3 LZeq 6,3 ») ; `parseSpectrumColumn` accepte les deux séparateurs, les
 * bandes basses (6,3–80 Hz) sont donc bien présentes dans le spectre.
 */
const g4FrDetector: FormatDetector = makeDetector({
  id: 'g4-fr',
  label: 'G4 français (Historique temporel)',
  spec: {
    recordTypeAliases: ["Type d'enregistrement"],
    timeStrategy: { kind: 'combine', dateAlias: 'Date', timeAlias: 'Temps' },
  },
  // Français : présence des colonnes « LAeq » ET « Temps » ET « Date ».
  belongs: (h) => hasExactHeader(h, 'LAeq') && hasExactHeader(h, 'Temps') && hasExactHeader(h, 'Date'),
  dateStrategy: 'data-first',
  reasonFor: (name, step) => `onglet « ${name} » : en-têtes FR (LAeq, Date, Temps, Type d'enregistrement), pas temporel ~${step < 2 ? '1' : Math.round(step)} s`,
})

/**
 * G4-FR à colonne DATETIME COMBINÉE — variante d'export (821SE, et le xlsx de la
 * même session) où l'horodatage tient dans UNE seule colonne « Date / heure », au
 * lieu des colonnes « Date » + « Temps » séparées du g4-fr. Tout le reste est du
 * G4-FR (décimales virgule, en-têtes français, date data-first).
 *
 * Stratégie temps = `kind: 'single'` — le MÊME mécanisme que le g4-en sur sa
 * colonne « Date » (datetime complet dans une colonne, lu via toSerialDays) :
 * inutile d'inventer une stratégie, une colonne = un horodatage complet.
 */
const g4FrDatetimeDetector: FormatDetector = makeDetector({
  id: 'g4-fr-datetime-combine',
  label: 'G4 français (Date / heure combinée)',
  spec: {
    recordTypeAliases: ["Type d'enregistrement"],
    timeStrategy: { kind: 'single', dateAlias: 'Date / heure' },
  },
  // « LAeq » ET une colonne « Date / heure » (espaces internes multiples tolérés
  // via collapse \s+, en plus du trim de hasExactHeader). Mutuellement exclusif
  // avec FR/EN qui exigent « Date » + « Temps »/« Time » SÉPARÉES (absentes ici).
  belongs: (h) =>
    hasExactHeader(h, 'LAeq') &&
    h.some((x) => x.toLowerCase().replace(/\s+/g, ' ').trim() === 'date / heure'),
  dateStrategy: 'data-first',
  reasonFor: (name, step) =>
    `onglet « ${name} » : en-têtes FR à datetime combiné (LAeq, Date / heure), pas temporel ~${step < 2 ? '1' : Math.round(step)} s`,
})

/**
 * Table des détecteurs. Ajouter un format = ajouter une entrée ici, sans
 * modifier les autres.
 */
export const DETECTORS: FormatDetector[] = [g4EnDetector, g4FrDetector, g4FrDatetimeDetector]

// ───────────────────────────────────────────────────────────────────────────
// Sélection
// ───────────────────────────────────────────────────────────────────────────

export type SelectOutcome =
  | { kind: 'ok'; detectorId: string; detectorLabel: string; sheetName: string; columnMap: ColumnMap; reason: string; dateStrategy: 'summary-first' | 'data-first' }
  | { kind: 'none'; seenSheets: string[]; sampleHeaders: string[] }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'aggregate-only'; detectorId: string; sheetName: string }

/**
 * Applique la règle 1/0/plusieurs sur la table des détecteurs, à partir d'une
 * SheetSource (découplée du WorkBook). Logique de matching IDENTIQUE.
 */
export function selectFormatFromSource(src: SheetSource): SelectOutcome {
  const scans = DETECTORS.map((d) => ({ d, scan: d.scan(src) }))
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
  const seenSheets = src.sheetNames.slice()
  let sampleHeaders: string[] = []
  for (const name of src.sheetNames) {
    const rows = src.sampleRows(name, 2)
    if (rows.length >= 2) {
      const hs = headerStrings(rows).filter((h) => h.trim() !== '')
      if (hs.length > sampleHeaders.length) sampleHeaders = hs
    }
  }
  return { kind: 'none', seenSheets, sampleHeaders: sampleHeaders.slice(0, 20) }
}

/** Applique la règle 1/0/plusieurs sur un WorkBook SheetJS (adaptateur). */
export function selectFormat(wb: XLSX.WorkBook): SelectOutcome {
  return selectFormatFromSource(wbSource(wb))
}

// ───────────────────────────────────────────────────────────────────────────
// Parsing unique paramétré par le mapping
// ───────────────────────────────────────────────────────────────────────────

export interface ParseOptions {
  onProgress?: (fraction: number) => void
}

/**
 * Mapping UNIQUE ligne → DataPoint, paramétré par le ColumnMap et alimenté par un
 * ACCESSEUR de cellule (colonne → valeur), sans dépendre d'une représentation de
 * ligne. Le chemin dense (SheetJS) l'appelle avec `getCell = c => row[c]` ; un
 * futur lecteur en flux l'appellera avec un accès à sa map colonne épars — MÊME
 * logique, aucune divergence possible.
 *
 * Renvoie null si la ligne doit être ignorée (marqueur d'enregistrement, temps
 * ou LAeq illisibles). Réplique EXACTE de l'ancienne boucle inline.
 */
export function rowToDataPoint(getCell: (colIndex: number) => unknown, cn: ColumnMap): DataPoint | null {
  // Marqueur (« Départ », « Run », « Calibration Change »…) → ligne ignorée.
  if (cn.recordTypeCol >= 0) {
    const rt = getCell(cn.recordTypeCol)
    if (rt !== null && rt !== '' && rt !== undefined) return null
  }

  const days = cn.readTimeDays(getCell)
  if (!Number.isFinite(days)) return null

  const laeq = num(getCell(cn.laeqCol))
  if (!Number.isFinite(laeq)) return null

  const dp: DataPoint = { t: serialDaysToMin(days), laeq }
  if (cn.lceqCol >= 0) { const v = num(getCell(cn.lceqCol)); if (Number.isFinite(v)) dp.lceq = v }
  if (cn.laftEqCol >= 0) { const v = num(getCell(cn.laftEqCol)); if (Number.isFinite(v)) dp.laftEq = v }
  if (cn.lafmaxCol >= 0) { const v = num(getCell(cn.lafmaxCol)); if (Number.isFinite(v)) dp.lafmax = v }

  if (cn.spectra.kind === 'freq') {
    // INVARIANT : `dp.spectra` est du LZeq. Un jeu mesuré en A (821SE CSV) est
    // dépondéré ICI — aucun consommateur aval n'a à connaître la pondération
    // d'origine. La table est validée à la construction du plan : la
    // `FormatError` de `deweightAToZ` est une garde, pas un chemin nominal.
    const toZ = (v: number[]): number[] =>
      cn.spectra.kind === 'freq' && cn.spectra.weighting === 'A' ? deweightAToZ(v, cn.spectra.freqs) : v
    const s = extractSpectrumCells(getCell, cn.spectra.cols)
    if (s && s.length > 0) dp.spectra = toZ(s)
    if (cn.spectra.maxCols) {
      const sm = extractSpectrumCells(getCell, cn.spectra.maxCols)
      if (sm && sm.length > 0) dp.spectraMax = toZ(sm)
    }
  } else if (cn.spectra.kind === 'positional') {
    // Byte-identique à la borne `c < row.length` : hors plage, getCell → undefined
    // → num → NaN → non poussé (idem cellule vide au milieu, alignement préservé).
    const s: number[] = []
    for (let c = cn.spectra.start; c <= cn.spectra.end; c++) {
      const v = num(getCell(c))
      if (Number.isFinite(v)) s.push(v)
    }
    if (s.length > 0) dp.spectra = s
  }

  return dp
}

/**
 * Métadonnées spectrales du MeasurementFile (fréquences + provenance), dérivées
 * du plan de colonnes. Partagé par le chemin dense (xlsx) et le chemin en flux
 * (CSV) : une seule définition de la provenance, aucune divergence possible.
 *
 * `spectraSource` documente si le spectre stocké a été MESURÉ en Z ou
 * RECONSTRUIT depuis du A. Rétention 10 ans : un spectre reconstruit doit rester
 * distinguable d'un spectre mesuré, en UI comme à l'export.
 */
export function spectraMeta(cm: ColumnMap, nBands: number): {
  spectraFreqs?: number[]
  spectraSource?: SpectraSource
  spectraUnavailable?: SpectraBlocker
} {
  if (cm.spectra.kind === 'blocked') return { spectraUnavailable: cm.spectra.reason }
  if (nBands === 0) return {}
  if (cm.spectra.kind === 'freq') {
    return {
      spectraFreqs: cm.spectra.freqs,
      spectraSource: cm.spectra.weighting === 'A' ? 'A-déponderé' : 'Z-natif',
    }
  }
  if (cm.spectra.kind === 'positional') {
    const b = cm.spectra.bands
    return { spectraFreqs: nBands === b.length ? b : b.slice(0, nBands), spectraSource: 'Z-natif' }
  }
  return {}
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
    const getCell = (c: number) => row[c]

    const dp = rowToDataPoint(getCell, cm)
    if (!dp) continue

    // Jours-sériels de la 1ʳᵉ ligne retenue → date du fichier. Re-lecture O(1) (une
    // seule fois) de la même valeur que celle utilisée dans rowToDataPoint.
    if (!Number.isFinite(firstDays)) firstDays = cm.readTimeDays(getCell)

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

  // Fréquences + provenance des bandes présentes (alignement affichage/Kt).
  const nBands = data.find((d) => d.spectra)?.spectra?.length ?? 0

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
    ...spectraMeta(cm, nBands),
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
