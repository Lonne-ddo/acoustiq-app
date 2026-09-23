/**
 * Export Excel COLORÉ du module Météo — écrit avec ExcelJS (SheetJS reste la
 * bibliothèque de LECTURE ; sa version npm n'écrit pas de styles).
 *
 * Onglets (modèle : exportXlsxMultiSheet du standalone agregateur_meteo) :
 *   - « Synthèse §3.6 » : toutes sources, une ligne par (heure, source), verdict coloré ;
 *   - un onglet par source, format proche de l'Annexe A (T, Td, HR, précip.,
 *     vent, pression, conditions, verdict coloré), ligne d'information station ;
 *   - « Comparaison » : sources côte à côte par heure ;
 *   - « Métadonnées » : point, plage, sources, station ECCC, seuils (traçabilité).
 *
 * ExcelJS est chargé à la demande (import dynamique) : il ne pèse sur le bundle
 * qu'au moment d'un export.
 */
import type { Workbook, Worksheet, Fill, Font } from 'exceljs'
import {
  RECEVABILITE_LABEL,
  calcDewpoint,
  critereHumiditeLabel,
  filtresValiditeParDefaut,
  hourKeyOf,
  isMelccfpDefault,
  seuilsUtilisesLine,
  type RecevabiliteConfig,
  type RecevabiliteHour,
  type RecevabiliteLevel,
} from './recevabilite'
import { SOURCES, formatStationTrace, type SourceResult, type SourceError } from './meteoSources'
import { conditionsLabel } from './wmo'

export interface MeteoExcelInput {
  pointLabel: string
  lat: number | null
  lng: number | null
  startDate: string
  endDate: string
  sources: SourceResult[]
  /** Recevabilité pré-calculée par source (la MÊME que le tableau à l'écran). */
  recevabiliteBySource: Record<string, RecevabiliteHour[]>
  asphalt: boolean
  config: RecevabiliteConfig
  ecccError?: SourceError
  /** Horodatage d'export (injectable pour les tests). */
  generatedAt?: Date
}

/** Couleurs Englobe (sarcelle) reprises du standalone ; ARGB pour ExcelJS. */
export const COULEURS = {
  enteteFond: 'FF1F7368',
  enteteTexte: 'FFFFFFFF',
  infoFond: 'FFFAF6EB',
  cleTexte: 'FF1F7368',
} as const

export const COULEURS_NIVEAU: Record<RecevabiliteLevel, { texte: string; fond: string }> = {
  ok: { texte: 'FF1E7A4D', fond: 'FFF1F8F4' },
  warn: { texte: 'FF8A5A00', fond: 'FFFBF5E6' },
  bad: { texte: 'FFA02525', fond: 'FFFBF1F1' },
  indetermine: { texte: 'FF555555', fond: 'FFEFEFEF' },
}

const plein = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const police = (argb: string, bold = false, italic = false): Partial<Font> => ({ color: { argb }, bold, italic })

function entete(ws: Worksheet, rowNumber: number): void {
  const row = ws.getRow(rowNumber)
  row.eachCell((c) => {
    c.fill = plein(COULEURS.enteteFond)
    c.font = police(COULEURS.enteteTexte, true)
    c.alignment = { vertical: 'middle' }
  })
}

function niveau(cell: import('exceljs').Cell, level: RecevabiliteLevel): void {
  const c = COULEURS_NIVEAU[level]
  cell.fill = plein(c.fond)
  cell.font = police(c.texte, true)
}

/** Nom d'onglet valide Excel (31 car., sans \ / ? * [ ] :). */
const nomOnglet = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)

const num = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v)

export async function buildMeteoWorkbook(input: MeteoExcelInput): Promise<Workbook> {
  const mod = await import('exceljs')
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AcoustiQ'
  wb.created = input.generatedAt ?? new Date()

  const { sources, recevabiliteBySource, config } = input

  // ── Synthèse §3.6 ────────────────────────────────────────────────────────
  const syn = wb.addWorksheet('Synthèse §3.6', { views: [{ state: 'frozen', ySplit: 1 }] })
  syn.columns = [
    { header: 'Date/Heure', width: 18 },
    { header: 'Source', width: 14 },
    { header: 'Période', width: 8 },
    { header: 'T (°C)', width: 8 },
    { header: 'HR (%)', width: 8 },
    { header: 'Précip. (mm)', width: 11 },
    { header: 'Vent (km/h)', width: 11 },
    { header: 'Recevabilité §3.6', width: 17 },
    { header: 'Motif(s)', width: 60 },
  ]
  entete(syn, 1)
  const synRows: { key: string; src: string; h: RecevabiliteHour }[] = []
  for (const s of sources) {
    for (const h of recevabiliteBySource[s.source] ?? []) {
      synRows.push({ key: hourKeyOf(h.datetime) ?? h.datetime, src: SOURCES[s.source].shortLabel, h })
    }
  }
  synRows.sort((a, b) => a.key.localeCompare(b.key) || a.src.localeCompare(b.src))
  for (const { src, h } of synRows) {
    const row = syn.addRow([
      h.datetime.replace('T', ' '), src, h.period,
      num(h.temperature), num(h.humidity), num(h.precipitation), num(h.windSpeed),
      RECEVABILITE_LABEL[h.level], h.reasons.join(' ; '),
    ])
    niveau(row.getCell(8), h.level)
  }
  syn.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } }

  // ── Un onglet par source (format proche de l'Annexe A) ───────────────────
  for (const s of sources) {
    const ws = wb.addWorksheet(nomOnglet(SOURCES[s.source].shortLabel), { views: [{ state: 'frozen', ySplit: 3 }] })
    ws.columns = [
      { width: 18 }, { width: 10 }, { width: 14 }, { width: 11 }, { width: 11 },
      { width: 13 }, { width: 13 }, { width: 13 }, { width: 22 }, { width: 17 }, { width: 50 },
    ]
    const info = ws.addRow([
      `${s.sourceLabel} · station ${s.station.name} · ${s.station.distanceKm.toFixed(1)} km · ` +
        `${(recevabiliteBySource[s.source] ?? []).length} heures · fuseau ${s.timezone}`,
    ])
    ws.mergeCells(1, 1, 1, 11)
    info.getCell(1).fill = plein(COULEURS.infoFond)
    info.getCell(1).font = police('FF555555', false, true)
    ws.addRow([])
    ws.addRow([
      'Date/Heure', 'Temp. (°C)', 'Pt de rosée (°C)', 'Hum. rel. (%)', 'Précip. (mm)',
      'Dir. vent (°)', 'Vit. vent (km/h)', 'Pression (kPa)', 'Conditions', 'Recevabilité §3.6', 'Motif(s)',
    ])
    entete(ws, 3)
    for (const h of recevabiliteBySource[s.source] ?? []) {
      // Td de la source si fourni ; sinon Magnus, signalé par une note de cellule :
      // un calcul ne doit jamais passer pour une mesure.
      const td = h.dewpoint != null ? h.dewpoint : calcDewpoint(h.temperature, h.humidity)
      const row = ws.addRow([
        h.datetime.replace('T', ' '),
        num(h.temperature),
        td == null ? null : Math.round(td * 10) / 10,
        num(h.humidity),
        num(h.precipitation),
        num(h.windDirection),
        num(h.windSpeed),
        h.pressureHpa != null ? Math.round(h.pressureHpa) / 10 : null,
        conditionsLabel(h),
        RECEVABILITE_LABEL[h.level],
        h.reasons.join(' ; '),
      ])
      if (h.dewpoint == null && td != null) {
        row.getCell(3).note = 'Point de rosée CALCULÉ (Magnus) — la source ne le fournit pas.'
      }
      niveau(row.getCell(10), h.level)
    }
  }

  // ── Comparaison ──────────────────────────────────────────────────────────
  if (sources.length >= 2) {
    const cmp = wb.addWorksheet('Comparaison', { views: [{ state: 'frozen', ySplit: 1 }] })
    const cols = ['Heure']
    for (const s of sources) {
      const l = SOURCES[s.source].shortLabel
      cols.push(`${l} T°C`, `${l} HR%`, `${l} Pp mm`, `${l} Vent km/h`)
    }
    cmp.addRow(cols)
    entete(cmp, 1)
    cmp.getColumn(1).width = 18
    const byHour = new Map<string, (number | null)[]>()
    sources.forEach((s, i) => {
      for (const r of s.rows) {
        const k = hourKeyOf(r.datetime) ?? r.datetime
        const arr = byHour.get(k) ?? new Array(sources.length * 4).fill(null)
        arr.splice(i * 4, 4, num(r.temperature), num(r.humidity), num(r.precipitation), num(r.windSpeed))
        byHour.set(k, arr)
      }
    })
    for (const k of [...byHour.keys()].sort()) cmp.addRow([k.replace('T', ' ') + ':00', ...byHour.get(k)!])
  }

  // ── Métadonnées ──────────────────────────────────────────────────────────
  const meta = wb.addWorksheet('Métadonnées')
  meta.columns = [{ width: 30 }, { width: 90 }]
  const eccc = sources.find((s) => s.source === 'eccc')
  const lignes: [string, string][] = [
    ['Point de mesure', input.pointLabel],
    ['Coordonnées', input.lat != null && input.lng != null ? `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}` : '—'],
    ['Période', `${input.startDate} → ${input.endDate}`],
    ['Sources', sources.map((s) => SOURCES[s.source].shortLabel).join(', ') || '—'],
    ['Station EC', eccc ? formatStationTrace(eccc.station) : input.ecccError ? `indisponible — ${input.ecccError.error}` : '—'],
    ['', ''],
    ['Référentiel', 'Lignes directrices MELCCFP — §3.6'],
    ['Seuils utilisés', seuilsUtilisesLine(config)],
    ['Statut des seuils', isMelccfpDefault(config) ? 'MELCCFP (défaut)' : 'MODIFIÉS — non MELCCFP'],
    ["Critère d'humidité", critereHumiditeLabel(config) ? `${critereHumiditeLabel(config)} — non MELCCFP` : 'aucun (§3.6 strict)'],
    [
      'Filtres de validité',
      `T ∈ [${config.validiteTempMinC} ; ${config.validiteTempMaxC}] °C, précip. ≤ ${config.validitePrecipMaxMm} mm — hors plage ⇒ indéterminé` +
        (filtresValiditeParDefaut(config) ? '' : ' — FILTRES MODIFIÉS'),
    ],
    [
      'Chaussée',
      input.asphalt ? 'sèche exigée (asphalte à proximité) — sinon « à signaler »' : 'non considérée (pas d’asphalte à proximité)',
    ],
    ['', ''],
    ['Généré le', (input.generatedAt ?? new Date()).toLocaleString('fr-CA')],
    ['Généré par', 'AcoustiQ — https://acoustiq-app.pages.dev'],
  ]
  for (const [k, v] of lignes) {
    const row = meta.addRow([k, v])
    if (k) {
      row.getCell(1).font = police(COULEURS.cleTexte, true)
      row.getCell(1).fill = plein(COULEURS.infoFond)
    }
  }
  if (!isMelccfpDefault(config)) {
    const c = meta.getCell('B9')
    c.font = police(COULEURS_NIVEAU.bad.texte, true)
  }

  return wb
}

/** Construit le classeur et renvoie les octets .xlsx. */
export async function meteoWorkbookBytes(input: MeteoExcelInput): Promise<ArrayBuffer> {
  const wb = await buildMeteoWorkbook(input)
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
