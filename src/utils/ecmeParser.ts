/**
 * Parser du fichier Excel `Occupation_ECME_2025-2026.xlsx`.
 *
 * Lecture seule, 100 % client-side. Trois sources :
 *
 *  1. Onglet principal (feuille 1) — calendrier d'occupation
 *     Col A : Réf. BV   |  Col B : Modèle  |  Col C : Prochaine calibration
 *     Col D : Localisation actuelle
 *     Col E … : une colonne par jour (en-tête = date)
 *     Valeurs : NaN/vide = disponible · "I" = installé · "S" = suivi
 *               chantier · "O" = autre occupation
 *
 *  2. Onglet `Table_ecme` — inventaire complet (marque, série, etc.)
 *
 *  3. Onglet `Tx_occupation` — taux d'occupation par modèle (référentiel
 *     historique, optionnel — on calcule aussi le taux à la volée).
 */

import * as XLSX from 'xlsx'
import { cellToISODate, parseISODate, todayISO, diffDays } from './dateUtils'

// ─── Types publics ──────────────────────────────────────────────────────────

export type DayStatus = 'Disponible' | 'Installé' | 'Suivi chantier' | 'Autre'

/** Type d'équipement déduit du modèle */
export type EquipmentType =
  | 'Sono'
  | 'Calibrateur'
  | 'Dosimètre'
  | 'Modem'
  | 'Géophone'
  | 'Autre'

export interface OccupationEntry {
  refBv: string
  modele: string
  /** Date ISO de la prochaine calibration, ou null si "HS"/"N-C"/inconnue */
  prochaineCalibration: string | null
  /** Mention brute lue dans la cellule (pour les statuts non-date) */
  calibrationFlag: 'HS' | 'N-C' | 'non utilisé' | null
  localisation: string
  /** Map ISO date → statut brut ("I" / "S" / "O" / "") */
  occupation: Record<string, string>
}

export interface InventoryEntry {
  refBv: string
  marque: string
  modele: string
  numeroSerie: string
  accessoires: string
  prochaineCalibration: string | null
  calibrationFlag: 'HS' | 'N-C' | 'non utilisé' | null
  commentaires: string
  type: string
  sim: string
  ip: string
  tel: string
}

export interface TxOccupationEntry {
  modele: string
  taux: number  // 0..1
}

export interface EcmeData {
  occupation: OccupationEntry[]
  inventory: InventoryEntry[]
  txOccupation: TxOccupationEntry[]
  /** Plage couverte par les colonnes de dates */
  dateRange: { start: string | null; end: string | null }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function s(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function isCalibFlag(raw: string): 'HS' | 'N-C' | 'non utilisé' | null {
  const t = raw.toLowerCase()
  if (t === 'hs') return 'HS'
  if (t === 'n-c' || t === 'nc') return 'N-C'
  if (t.includes('non utilis')) return 'non utilisé'
  return null
}

/** Devine un type d'équipement à partir du nom de modèle */
export function inferEquipmentType(modele: string): EquipmentType {
  const m = modele.toLowerCase()
  if (m.includes('cal')) return 'Calibrateur'
  if (m.includes('dosim') || m.includes('spartan')) return 'Dosimètre'
  if (m.includes('modem') || m.includes('sim')) return 'Modem'
  if (m.includes('geo') || m.includes('géo')) return 'Géophone'
  if (
    m.includes('831') || m.includes('soundtrack') || m.includes('lxt') ||
    m.includes('c50') || m.includes('821') || m.includes('sonom')
  ) return 'Sono'
  return 'Autre'
}

export function statusFromCell(raw: unknown): DayStatus {
  const t = s(raw).toUpperCase()
  if (t === 'I') return 'Installé'
  if (t === 'S') return 'Suivi chantier'
  if (t === 'O') return 'Autre'
  return 'Disponible'
}

// ─── Parsing principal ──────────────────────────────────────────────────────

export async function parseEcmeFile(file: File): Promise<EcmeData> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

  if (wb.SheetNames.length === 0) {
    throw new Error('Le fichier Excel ne contient aucune feuille.')
  }

  // ── Feuille 1 : occupation calendaire ────────────────────────────────────
  const mainSheet = wb.Sheets[wb.SheetNames[0]]
  if (!mainSheet) throw new Error('Feuille principale introuvable.')
  const mainRows = XLSX.utils.sheet_to_json(mainSheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][]

  if (mainRows.length < 2) throw new Error('Feuille principale vide.')

  // Détecter la ligne d'en-tête : la première ligne dont la cellule index 4
  // (col E) contient une date valide.
  let headerRow = 0
  for (let i = 0; i < Math.min(8, mainRows.length); i++) {
    const row = mainRows[i] ?? []
    if (cellToISODate(row[4]) !== null) {
      headerRow = i
      break
    }
  }

  const header = mainRows[headerRow] ?? []
  const dateColumns: Array<{ index: number; iso: string }> = []
  for (let c = 4; c < header.length; c++) {
    const iso = cellToISODate(header[c])
    if (iso) dateColumns.push({ index: c, iso })
  }

  const occupation: OccupationEntry[] = []
  for (let r = headerRow + 1; r < mainRows.length; r++) {
    const row = mainRows[r]
    if (!row) continue
    const refBv = s(row[0])
    if (!refBv) continue
    const modele = s(row[1])
    const calibRaw = row[2]
    const calibStr = s(calibRaw)
    const calibFlag = isCalibFlag(calibStr)
    const calibIso = calibFlag ? null : cellToISODate(calibRaw)
    const localisation = s(row[3])

    const occMap: Record<string, string> = {}
    for (const dc of dateColumns) {
      const v = s(row[dc.index]).toUpperCase()
      if (v) occMap[dc.iso] = v
    }

    occupation.push({
      refBv,
      modele,
      prochaineCalibration: calibIso,
      calibrationFlag: calibFlag,
      localisation,
      occupation: occMap,
    })
  }

  // ── Feuille `Table_ecme` : inventaire complet ────────────────────────────
  const inventory: InventoryEntry[] = []
  const tableSheet = findSheet(wb, ['table_ecme', 'inventaire', 'inventory'])
  if (tableSheet) {
    const tRows = XLSX.utils.sheet_to_json(tableSheet, {
      header: 1,
      defval: null,
      raw: true,
    }) as unknown[][]
    if (tRows.length > 1) {
      const head = (tRows[0] ?? []).map((h) => s(h).toLowerCase())
      const idx = (needles: string[]): number => {
        for (const n of needles) {
          const i = head.findIndex((h) => h.includes(n))
          if (i >= 0) return i
        }
        return -1
      }
      const cMarque = idx(['marque'])
      const cRef    = idx(['réf', 'ref'])
      const cModele = idx(['modèle', 'modele'])
      const cSerie  = idx(['série', 'serie'])
      const cAcc    = idx(['accessoires'])
      const cCalib  = idx(['calibration'])
      const cComm   = idx(['commentaire'])
      const cType   = idx(['type'])
      const cSim    = idx(['sim'])
      const cIp     = idx(['ip'])
      const cTel    = idx(['tél', 'tel'])

      for (let r = 1; r < tRows.length; r++) {
        const row = tRows[r]
        if (!row) continue
        const refBv = cRef >= 0 ? s(row[cRef]) : ''
        if (!refBv) continue

        const calibRaw = cCalib >= 0 ? row[cCalib] : null
        const calibStr = s(calibRaw)
        const calibFlag = isCalibFlag(calibStr)
        const calibIso = calibFlag ? null : cellToISODate(calibRaw)

        inventory.push({
          refBv,
          marque: cMarque >= 0 ? s(row[cMarque]) : '',
          modele: cModele >= 0 ? s(row[cModele]) : '',
          numeroSerie: cSerie >= 0 ? s(row[cSerie]) : '',
          accessoires: cAcc >= 0 ? s(row[cAcc]) : '',
          prochaineCalibration: calibIso,
          calibrationFlag: calibFlag,
          commentaires: cComm >= 0 ? s(row[cComm]) : '',
          type: cType >= 0 ? s(row[cType]) : '',
          sim: cSim >= 0 ? s(row[cSim]) : '',
          ip: cIp >= 0 ? s(row[cIp]) : '',
          tel: cTel >= 0 ? s(row[cTel]) : '',
        })
      }
    }
  }

  // ── Feuille `Tx_occupation` : taux historique ────────────────────────────
  const txOccupation: TxOccupationEntry[] = []
  const txSheet = findSheet(wb, ['tx_occupation', 'taux', 'occupation'])
  if (txSheet) {
    const txRows = XLSX.utils.sheet_to_json(txSheet, {
      header: 1, defval: null, raw: true,
    }) as unknown[][]
    for (let r = 1; r < txRows.length; r++) {
      const row = txRows[r]
      if (!row) continue
      const modele = s(row[0])
      const tauxRaw = row[1]
      const taux = typeof tauxRaw === 'number' ? tauxRaw : parseFloat(s(tauxRaw))
      if (modele && Number.isFinite(taux)) {
        txOccupation.push({ modele, taux })
      }
    }
  }

  // Plage couverte
  const start = dateColumns.length > 0 ? dateColumns[0].iso : null
  const end = dateColumns.length > 0 ? dateColumns[dateColumns.length - 1].iso : null

  return {
    occupation,
    inventory,
    txOccupation,
    dateRange: { start, end },
  }
}

function findSheet(wb: XLSX.WorkBook, contains: string[]): XLSX.WorkSheet | null {
  for (const name of wb.SheetNames) {
    const lower = name.toLowerCase()
    if (contains.some((c) => lower.includes(c.toLowerCase()))) {
      return wb.Sheets[name]
    }
  }
  return null
}

// ─── Logique métier ─────────────────────────────────────────────────────────

export interface CalibrationAlert {
  refBv: string
  modele: string
  date: string  // ISO
  daysRemaining: number  // négatif si dépassée
  level: 'red' | 'amber'
}

/**
 * Liste les équipements dont la prochaine calibration est dans moins de 60 j
 * (rouge < 30 j ou dépassée, ambre 30-60 j). Ignore "HS"/"N-C"/"non utilisé".
 */
export function computeCalibrationAlerts(
  occupation: OccupationEntry[],
  today: string = todayISO(),
): CalibrationAlert[] {
  const out: CalibrationAlert[] = []
  for (const e of occupation) {
    if (e.calibrationFlag) continue
    if (!e.prochaineCalibration) continue
    const days = diffDays(today, e.prochaineCalibration)
    if (days >= 60) continue
    out.push({
      refBv: e.refBv,
      modele: e.modele,
      date: e.prochaineCalibration,
      daysRemaining: days,
      level: days < 30 ? 'red' : 'amber',
    })
  }
  // Tri : rouge en premier, par jours croissants
  out.sort((a, b) => a.daysRemaining - b.daysRemaining)
  return out
}

export interface AvailabilityRow {
  refBv: string
  modele: string
  type: EquipmentType
  status: DayStatus
  localisation: string
}

export function computeAvailability(
  occupation: OccupationEntry[],
  date: string = todayISO(),
): AvailabilityRow[] {
  return occupation.map((e) => ({
    refBv: e.refBv,
    modele: e.modele,
    type: inferEquipmentType(e.modele),
    status: statusFromCell(e.occupation[date]),
    localisation: e.localisation,
  }))
}

export interface OccupationRate {
  modele: string
  type: EquipmentType
  occupiedDays: number
  totalDays: number
  rate: number  // 0..1
  count: number  // nb équipements
}

/**
 * Taux d'occupation moyen par modèle sur la plage [start, end].
 * Pour chaque équipement on compte les jours où la valeur est "I" ou "S",
 * puis on moyenne par modèle.
 */
export function computeOccupationRate(
  occupation: OccupationEntry[],
  start: string,
  end: string,
): OccupationRate[] {
  const startD = parseISODate(start)
  const endD = parseISODate(end)
  if (!startD || !endD) return []

  // Pour chaque équipement : compter les jours occupés et le total
  const totalDays = Math.max(1, diffDays(start, end) + 1)
  const byModel = new Map<string, { occupiedSum: number; count: number }>()

  for (const e of occupation) {
    let occupied = 0
    for (const [iso, val] of Object.entries(e.occupation)) {
      if (iso < start || iso > end) continue
      if (val === 'I' || val === 'S') occupied++
    }
    const rate = occupied / totalDays
    const cur = byModel.get(e.modele) ?? { occupiedSum: 0, count: 0 }
    cur.occupiedSum += rate
    cur.count += 1
    byModel.set(e.modele, cur)
  }

  const out: OccupationRate[] = []
  for (const [modele, v] of byModel) {
    if (v.count === 0) continue
    const avg = v.occupiedSum / v.count
    out.push({
      modele,
      type: inferEquipmentType(modele),
      occupiedDays: Math.round(avg * totalDays),
      totalDays,
      rate: avg,
      count: v.count,
    })
  }
  out.sort((a, b) => b.rate - a.rate)
  return out
}
