/**
 * Module Carrière / Sablière — parsing et calculs
 *
 * Trois sources d'entrée Excel :
 *   1. Time History 821SE (export G4 SoundAdvisor) — onglet "DATA_Time History_1"
 *      Données à 1 seconde (LAeq, LASmin/max, LCeq, LZeq + percentiles LAF
 *      optionnels).
 *   2. Registre camionnage Englobe — onglet "A"
 *      Donne les heures de départ de chaque camion ; filtres "À enlever" et
 *      "Départ seul".
 *   3. Données météo Environnement Canada — onglet "Données météo"
 *      Données horaires (température, vitesse vent, précipitations).
 *
 * Sortie : pour chaque heure couverte par le Time History, un `HourlyResult`
 * avec niveaux acoustiques agrégés, comptage de passages camions, statut
 * A/R (actif/résiduel), validité météo, et inclusion finale. Calcule ensuite
 * Bp par période (Jour / Soir / Nuit).
 */
import * as XLSX from 'xlsx'

// ─── Paramètres ─────────────────────────────────────────────────────────────
export interface CarriereParams {
  /** Délai trajet carrière → point de mesure (minutes) */
  delaiCamionnageMin: number
  /** Vitesse vent maximale tolérée (km/h) — au-delà, l'heure est exclue */
  ventMaxKmh: number
  /** Période jour : début (heure) inclusive */
  jourStartH: number
  /** Période jour : fin (heure) exclusive */
  jourEndH: number
  soirStartH: number
  soirEndH: number
  nuitStartH: number
  nuitEndH: number
}

export const DEFAULT_CARRIERE_PARAMS: CarriereParams = {
  delaiCamionnageMin: 20,
  ventMaxKmh: 20,
  jourStartH: 7,
  jourEndH: 19,
  soirStartH: 19,
  soirEndH: 22,
  nuitStartH: 22,
  nuitEndH: 7,
}

// ─── Types ──────────────────────────────────────────────────────────────────
export interface RawTimeHistoryRow {
  /** Date/Heure complet (timestamp) */
  date: Date
  laeq: number
  /** LAFmax / LASmax si présent dans le fichier (sinon calculé sur LAeq) */
  lafmax?: number
  /** Percentiles LAF si présents dans le fichier (sinon calculés depuis LAeq) */
  laf10?: number
  laf50?: number
  laf90?: number
}

export interface CamionEvent {
  /** Heure de passage au point de mesure = heure de départ + délai */
  passageAt: Date
}

export interface MeteoHourRow {
  date: Date
  precipitationMm: number
  ventKmh: number
}

export type Activity = 'A' | 'R'

export interface HourlyResult {
  /** Clé de bucket "YYYY-MM-DDTHH" */
  hourKey: string
  date: string
  hour: number
  laeq1h: number
  laf10: number
  laf50: number
  laf90: number
  lafmax: number
  countSamples: number
  camionsCount: number
  /** Activité automatique d'après le registre — peut être surchargée par l'utilisateur */
  activity: Activity
  meteoOk: boolean
  meteoReason?: string
  /** Inclus dans le calcul de Bp ? (= meteoOk) */
  included: boolean
}

export interface BpPeriode {
  label: 'Jour' | 'Soir' | 'Nuit'
  rangeLabel: string
  laeqAmb: number | null
  laeqRes: number | null
  bp: number | null
  hoursA: number
  hoursR: number
}

export interface CarriereResult {
  hours: HourlyResult[]
  bpJour: BpPeriode
  bpSoir: BpPeriode
  bpNuit: BpPeriode
}

/**
 * Slot d'upload typé pour un fichier Excel donné — utilisé par la page
 * Carrière et lifté dans App pour conserver l'état au switch d'onglet.
 */
export interface FileSlot<T> {
  name: string | null
  data: T | null
  error: string | null
}

/** État persistant de la page Carrière (lifté dans App). */
export interface CarrierePageState {
  timeHistory: FileSlot<RawTimeHistoryRow[]>
  camionnage: FileSlot<CamionEvent[]>
  meteo: FileSlot<MeteoHourRow[]>
  params: CarriereParams
  result: CarriereResult | null
}

export const EMPTY_CARRIERE_STATE: CarrierePageState = {
  timeHistory: { name: null, data: null, error: null },
  camionnage: { name: null, data: null, error: null },
  meteo: { name: null, data: null, error: null },
  params: DEFAULT_CARRIERE_PARAMS,
  result: null,
}

// ─── Helpers d'extraction ───────────────────────────────────────────────────
function getHeaderIndex(headers: string[], needles: string[]): number {
  const lower = headers.map((h) => h.toLowerCase())
  for (const n of needles) {
    const nl = n.toLowerCase()
    const idx = lower.findIndex((h) => h.includes(nl))
    if (idx >= 0) return idx
  }
  return -1
}

function parseExcelCellAsDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  if (typeof v === 'number') {
    // Excel serial date — convert via SheetJS SSF helper
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    return new Date(d.y, (d.m ?? 1) - 1, d.d ?? 1, d.H ?? 0, d.M ?? 0, Math.floor(d.S ?? 0))
  }
  if (typeof v === 'string' && v.trim()) {
    const t = Date.parse(v)
    if (!isNaN(t)) return new Date(t)
  }
  return null
}

interface HMS { h: number; m: number; s: number }

function parseExcelCellAsTime(v: unknown): HMS | null {
  if (typeof v === 'number') {
    // Fraction de jour Excel
    const totalSec = Math.round(v * 86400) % 86400
    return {
      h: Math.floor(totalSec / 3600),
      m: Math.floor((totalSec % 3600) / 60),
      s: totalSec % 60,
    }
  }
  if (typeof v === 'string') {
    const m = v.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/)
    if (m) {
      return { h: parseInt(m[1], 10), m: parseInt(m[2], 10), s: parseInt(m[3] ?? '0', 10) }
    }
  }
  if (v instanceof Date) {
    return { h: v.getHours(), m: v.getMinutes(), s: v.getSeconds() }
  }
  return null
}

function combineDateAndTime(date: Date | null, time: HMS | null): Date | null {
  if (!date) return null
  const d = new Date(date.getTime())
  d.setHours(time?.h ?? 0, time?.m ?? 0, time?.s ?? 0, 0)
  return d
}

export function dateToHourKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}`
}

function findSheet(wb: XLSX.WorkBook, exact: string, fallbackContains: string[]): XLSX.WorkSheet | null {
  if (wb.Sheets[exact]) return wb.Sheets[exact]
  for (const name of wb.SheetNames) {
    const lower = name.toLowerCase()
    if (fallbackContains.some((f) => lower.includes(f.toLowerCase()))) {
      return wb.Sheets[name]
    }
  }
  return null
}

// ─── 1. Parsing Time History 821SE ──────────────────────────────────────────
export function parseTimeHistorySheet(buffer: ArrayBuffer): RawTimeHistoryRow[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = findSheet(wb, 'DATA_Time History_1', ['time history', 'time_history', 'historique temporel'])
  if (!sheet) {
    throw new Error(
      'Onglet "DATA_Time History_1" introuvable dans le fichier sonomètre. Vérifiez l\'export.',
    )
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
  if (rows.length < 2) {
    throw new Error('Onglet "DATA_Time History_1" vide.')
  }
  const headerRow = (rows[0] ?? []) as unknown[]
  const headers = headerRow.map((h) => String(h ?? ''))

  const colDate = getHeaderIndex(headers, ['Date/Time', 'Date / heure', 'Date/heure', 'datetime', 'date', 'heure', 'time'])
  const colLAeq = getHeaderIndex(headers, ['LAeq', 'LA eq', 'Leq'])
  if (colDate < 0) throw new Error('Colonne "Date/Time" manquante dans Time History')
  if (colLAeq < 0) throw new Error('Colonne "LAeq" manquante dans Time History')

  const colLAFmax = getHeaderIndex(headers, ['LASmax', 'LAFmax', 'LA max'])
  const colLAF10 = getHeaderIndex(headers, ['LAF 10', 'LAF10'])
  const colLAF50 = getHeaderIndex(headers, ['LAF 50', 'LAF50'])
  const colLAF90 = getHeaderIndex(headers, ['LAF 90', 'LAF90'])

  const out: RawTimeHistoryRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const date = parseExcelCellAsDate(row[colDate])
    if (!date) continue
    const laeqRaw = row[colLAeq]
    const laeq = typeof laeqRaw === 'number' ? laeqRaw : parseFloat(String(laeqRaw))
    if (!Number.isFinite(laeq)) continue

    const r: RawTimeHistoryRow = { date, laeq }
    if (colLAFmax >= 0) {
      const v = Number(row[colLAFmax])
      if (Number.isFinite(v)) r.lafmax = v
    }
    if (colLAF10 >= 0) {
      const v = Number(row[colLAF10])
      if (Number.isFinite(v)) r.laf10 = v
    }
    if (colLAF50 >= 0) {
      const v = Number(row[colLAF50])
      if (Number.isFinite(v)) r.laf50 = v
    }
    if (colLAF90 >= 0) {
      const v = Number(row[colLAF90])
      if (Number.isFinite(v)) r.laf90 = v
    }
    out.push(r)
  }
  if (out.length === 0) {
    throw new Error('Aucune ligne LAeq valide dans le Time History.')
  }
  return out
}

// ─── 2. Parsing Registre camionnage ─────────────────────────────────────────
export function parseCamionnageSheet(buffer: ArrayBuffer, delaiMin: number): CamionEvent[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = wb.Sheets['A'] ?? wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('Aucune feuille trouvée dans le registre camionnage.')

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
  if (rows.length < 2) return []

  // Trouver la ligne d'en-tête (peut ne pas être ligne 0)
  let headerRow = 0
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const txt = (rows[i] ?? []).map((v) => String(v ?? '').toLowerCase()).join('|')
    if (txt.includes('arrivée') || txt.includes('départ') || txt.includes('depart')) {
      headerRow = i
      break
    }
  }
  const headers = (rows[headerRow] ?? []).map((h) => String(h ?? ''))
  const headersLower = headers.map((h) => h.toLowerCase())

  // Le registre Englobe contient typiquement 4 colonnes consécutives :
  // Arrivée (date) | Heure (time) | Départ (date) | Heure (time)
  // On trouve la colonne "Départ" et on prend la suivante comme heure départ.
  const colDepartDate = headersLower.findIndex(
    (h, i) => (h.includes('départ') || h.includes('depart')) && !headersLower[i].includes('seul'),
  )
  if (colDepartDate < 0) {
    throw new Error(
      'Colonne "Départ" introuvable dans le registre camionnage. Vérifiez les en-têtes.',
    )
  }
  const colDepartHeure = colDepartDate + 1
  const colExclude = getHeaderIndex(headers, ['à enlever', 'enlever', 'exclure'])
  const colDepartSeul = headersLower.findIndex(
    (h) => h.includes('seul') || h.includes('vide'),
  )

  const events: CamionEvent[] = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    if (colExclude >= 0) {
      const v = String(row[colExclude] ?? '').trim().toLowerCase()
      if (v === 'x' || v === 'X') continue
    }
    if (colDepartSeul >= 0) {
      const v = row[colDepartSeul]
      if (v === 1 || String(v).trim() === '1') continue
    }

    const date = parseExcelCellAsDate(row[colDepartDate])
    const heure = parseExcelCellAsTime(row[colDepartHeure])
    const combined = combineDateAndTime(date, heure)
    if (!combined) continue

    const passage = new Date(combined.getTime() + delaiMin * 60_000)
    events.push({ passageAt: passage })
  }
  return events
}

// ─── 3. Parsing Données météo ───────────────────────────────────────────────
export function parseMeteoSheet(buffer: ArrayBuffer): MeteoHourRow[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = findSheet(wb, 'Données météo', ['météo', 'meteo', 'weather'])
  if (!sheet) {
    throw new Error('Onglet "Données météo" introuvable dans le fichier météo.')
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
  if (rows.length < 2) return []

  // Détecter la ligne d'en-tête (les fichiers EnvCanada ont souvent quelques
  // lignes d'en-tête de description avant la vraie ligne d'en-tête).
  let headerRow = 0
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const txt = (rows[i] ?? []).map((v) => String(v ?? '').toLowerCase()).join('|')
    if (txt.includes('heure') && (txt.includes('vent') || txt.includes('température') || txt.includes('temperature'))) {
      headerRow = i
      break
    }
  }
  const headers = (rows[headerRow] ?? []).map((h) => String(h ?? ''))

  const colHeure = getHeaderIndex(headers, ['heure', 'date', 'time'])
  const colPrecip = getHeaderIndex(headers, ['précipitation', 'precipitation', 'pluie'])
  const colVent = getHeaderIndex(headers, ['vitesse', 'vent', 'wind'])

  if (colHeure < 0) {
    throw new Error('Colonne "HEURE" manquante dans la météo.')
  }

  const out: MeteoHourRow[] = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const d = parseExcelCellAsDate(row[colHeure])
    if (!d) continue
    const precipRaw = colPrecip >= 0 ? Number(row[colPrecip]) : 0
    const ventRaw = colVent >= 0 ? Number(row[colVent]) : 0
    out.push({
      date: d,
      precipitationMm: Number.isFinite(precipRaw) ? precipRaw : 0,
      ventKmh: Number.isFinite(ventRaw) ? ventRaw : 0,
    })
  }
  return out
}

// ─── Calculs acoustiques ────────────────────────────────────────────────────
/** Moyenne énergétique. Filtre NaN/null/Infinity en amont. */
function energyMean(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length === 0) return 0
  const sum = valid.reduce((a, v) => a + Math.pow(10, v / 10), 0)
  return 10 * Math.log10(sum / valid.length)
}

/** L_x = niveau dépassé x % du temps → percentile (100 - x) en tri ascendant. */
function lxLevel(values: number[], x: number): number {
  const valid = values.filter((v) => Number.isFinite(v))
  if (valid.length === 0) return 0
  const sorted = [...valid].sort((a, b) => a - b)
  const idx = Math.round(((100 - x) / 100) * (sorted.length - 1))
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

// ─── 4. Agrégation horaire ──────────────────────────────────────────────────
export function computeHourly(rows: RawTimeHistoryRow[]): HourlyResult[] {
  const buckets = new Map<string, RawTimeHistoryRow[]>()
  for (const r of rows) {
    const key = dateToHourKey(r.date)
    const arr = buckets.get(key)
    if (arr) arr.push(r)
    else buckets.set(key, [r])
  }

  const out: HourlyResult[] = []
  for (const [key, list] of buckets) {
    const laeqs = list.map((r) => r.laeq)

    // Si percentiles LAF présents pour TOUTES les lignes → moyenne énergétique,
    // sinon les calculer depuis la distribution des LAeq 1s.
    const hasLaf10 = list.every((r) => typeof r.laf10 === 'number')
    const hasLaf50 = list.every((r) => typeof r.laf50 === 'number')
    const hasLaf90 = list.every((r) => typeof r.laf90 === 'number')
    const hasLafmax = list.every((r) => typeof r.lafmax === 'number')

    const laf10 = hasLaf10
      ? energyMean(list.map((r) => r.laf10 as number))
      : lxLevel(laeqs, 10)
    const laf50 = hasLaf50
      ? energyMean(list.map((r) => r.laf50 as number))
      : lxLevel(laeqs, 50)
    const laf90 = hasLaf90
      ? energyMean(list.map((r) => r.laf90 as number))
      : lxLevel(laeqs, 90)
    const lafmax = hasLafmax
      ? Math.max(...list.map((r) => r.lafmax as number))
      : Math.max(...laeqs)

    const [datePart, hourPart] = key.split('T')
    out.push({
      hourKey: key,
      date: datePart,
      hour: parseInt(hourPart, 10),
      laeq1h: energyMean(laeqs),
      laf10,
      laf50,
      laf90,
      lafmax,
      countSamples: list.length,
      camionsCount: 0,
      activity: 'R',
      meteoOk: true,
      included: true,
    })
  }
  out.sort((a, b) => a.hourKey.localeCompare(b.hourKey))
  return out
}

// ─── 5. Marquage A/R via le registre camionnage ─────────────────────────────
export function tagActivity(hours: HourlyResult[], camions: CamionEvent[]): HourlyResult[] {
  const counts = new Map<string, number>()
  for (const c of camions) {
    const key = dateToHourKey(c.passageAt)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return hours.map((h) => {
    const c = counts.get(h.hourKey) ?? 0
    return { ...h, camionsCount: c, activity: c > 0 ? 'A' : 'R' }
  })
}

// ─── 6. Filtrage météo ──────────────────────────────────────────────────────
export function tagMeteo(
  hours: HourlyResult[],
  meteo: MeteoHourRow[],
  ventMaxKmh: number,
): HourlyResult[] {
  const map = new Map<string, MeteoHourRow>()
  for (const m of meteo) map.set(dateToHourKey(m.date), m)

  return hours.map((h) => {
    const m = map.get(h.hourKey)
    if (!m) {
      return { ...h, meteoOk: false, meteoReason: 'données manquantes', included: false }
    }
    if (m.precipitationMm > 0) {
      return {
        ...h,
        meteoOk: false,
        meteoReason: `précipitations (${m.precipitationMm.toFixed(1)} mm)`,
        included: false,
      }
    }
    if (m.ventKmh > ventMaxKmh) {
      return {
        ...h,
        meteoOk: false,
        meteoReason: `vent ${m.ventKmh.toFixed(0)} km/h`,
        included: false,
      }
    }
    return { ...h, meteoOk: true, meteoReason: undefined, included: true }
  })
}

// ─── 7. Calcul de Bp par période ────────────────────────────────────────────
function isInPeriode(hour: number, start: number, end: number): boolean {
  if (start <= end) return hour >= start && hour < end
  // wrap (nuit 22 → 7)
  return hour >= start || hour < end
}

function aggregatePeriode(
  label: 'Jour' | 'Soir' | 'Nuit',
  start: number,
  end: number,
  hours: HourlyResult[],
): BpPeriode {
  const inP = hours.filter((h) => h.included && isInPeriode(h.hour, start, end))
  const ambHours = inP.filter((h) => h.activity === 'A').map((h) => h.laeq1h)
  const resHours = inP.filter((h) => h.activity === 'R').map((h) => h.laeq1h)

  const laeqAmb = ambHours.length > 0 ? energyMean(ambHours) : null
  const laeqRes = resHours.length > 0 ? energyMean(resHours) : null

  let bp: number | null = null
  if (laeqAmb !== null && laeqRes !== null && laeqAmb > laeqRes) {
    const diff = Math.pow(10, laeqAmb / 10) - Math.pow(10, laeqRes / 10)
    if (diff > 0) bp = 10 * Math.log10(diff)
  }

  const rangeLabel =
    start <= end ? `${start}h – ${end}h` : `${start}h – ${end}h (passage minuit)`

  return {
    label,
    rangeLabel,
    laeqAmb,
    laeqRes,
    bp,
    hoursA: ambHours.length,
    hoursR: resHours.length,
  }
}

export function computeBpAllPeriodes(
  hours: HourlyResult[],
  params: CarriereParams,
): { bpJour: BpPeriode; bpSoir: BpPeriode; bpNuit: BpPeriode } {
  return {
    bpJour: aggregatePeriode('Jour', params.jourStartH, params.jourEndH, hours),
    bpSoir: aggregatePeriode('Soir', params.soirStartH, params.soirEndH, hours),
    bpNuit: aggregatePeriode('Nuit', params.nuitStartH, params.nuitEndH, hours),
  }
}

// ─── Pipeline complet ───────────────────────────────────────────────────────
export function runCarriereAnalysis(
  timeHistory: RawTimeHistoryRow[],
  camions: CamionEvent[],
  meteo: MeteoHourRow[],
  params: CarriereParams,
): CarriereResult {
  let hours = computeHourly(timeHistory)
  hours = tagActivity(hours, camions)
  hours = tagMeteo(hours, meteo, params.ventMaxKmh)
  const bp = computeBpAllPeriodes(hours, params)
  return { hours, ...bp }
}

// ─── Export CSV ─────────────────────────────────────────────────────────────
function csvCell(s: string | number): string {
  const str = String(s)
  if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

/**
 * Résumé global "live" calculé sur les heures incluses (toutes périodes confondues).
 * Sert au footer du tableau de filtrage qui doit se mettre à jour à chaque
 * toggle A/R utilisateur.
 */
export interface LiveBpSummary {
  hoursIncluded: number
  laeqAmb: number | null
  laeqRes: number | null
  bp: number | null
}

export function computeLiveBpSummary(hours: HourlyResult[]): LiveBpSummary {
  const incl = hours.filter((h) => h.included)
  const ambVals = incl.filter((h) => h.activity === 'A').map((h) => h.laeq1h)
  const resVals = incl.filter((h) => h.activity === 'R').map((h) => h.laeq1h)
  const laeqAmb = ambVals.length > 0 ? energyMean(ambVals) : null
  const laeqRes = resVals.length > 0 ? energyMean(resVals) : null
  let bp: number | null = null
  if (laeqAmb !== null && laeqRes !== null && laeqAmb > laeqRes) {
    const diff = Math.pow(10, laeqAmb / 10) - Math.pow(10, laeqRes / 10)
    if (diff > 0) bp = 10 * Math.log10(diff)
  }
  return { hoursIncluded: incl.length, laeqAmb, laeqRes, bp }
}

export function hoursToCSV(hours: HourlyResult[], periodes?: BpPeriode[]): string {
  const headers = [
    'Date',
    'Heure',
    'LAeq1h dB(A)',
    'LAF10',
    'LAF50',
    'LAF90',
    'LAFmax',
    'Camions/h',
    'Activité',
    'Météo OK',
    'Motif exclusion',
    'Inclus',
  ]
  const lines = [headers.join(';')]
  for (const h of hours) {
    lines.push(
      [
        h.date,
        `${String(h.hour).padStart(2, '0')}h`,
        h.laeq1h.toFixed(1),
        h.laf10.toFixed(1),
        h.laf50.toFixed(1),
        h.laf90.toFixed(1),
        h.lafmax.toFixed(1),
        h.camionsCount,
        h.activity,
        h.meteoOk ? 'Oui' : 'Non',
        h.meteoReason ?? '',
        h.included ? 'Oui' : 'Non',
      ]
        .map(csvCell)
        .join(';'),
    )
  }

  // Pied de page : Bp par période + résumé global
  if (periodes && periodes.length > 0) {
    lines.push('')
    lines.push(['', 'Bp par période (Lignes directrices MELCCFP 2026)'].map(csvCell).join(';'))
    lines.push(
      ['Période', 'Plage', 'LAeq amb. dB(A)', 'LAeq rés. dB(A)', 'Bp dB(A)', 'Heures A', 'Heures R']
        .map(csvCell)
        .join(';'),
    )
    const f = (n: number | null) => (n === null ? '' : n.toFixed(1))
    for (const p of periodes) {
      lines.push(
        [p.label, p.rangeLabel, f(p.laeqAmb), f(p.laeqRes), f(p.bp), p.hoursA, p.hoursR]
          .map(csvCell)
          .join(';'),
      )
    }
    const live = computeLiveBpSummary(hours)
    lines.push('')
    lines.push(['', 'Résumé global (heures incluses)'].map(csvCell).join(';'))
    lines.push(['Heures incluses', live.hoursIncluded].map(csvCell).join(';'))
    lines.push(['LAeq ambiant (énerg.)', f(live.laeqAmb)].map(csvCell).join(';'))
    lines.push(['LAeq résiduel (énerg.)', f(live.laeqRes)].map(csvCell).join(';'))
    lines.push(['Bp global', f(live.bp)].map(csvCell).join(';'))
  }
  // BOM UTF-8 pour Excel français
  return '\uFEFF' + lines.join('\n')
}
