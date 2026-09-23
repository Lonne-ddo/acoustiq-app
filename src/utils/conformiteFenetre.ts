/**
 * Fenêtre d'évaluation LAr,1h de la Conformité 2026 — calculs PURS.
 *
 * EXTRAIT de src/components/Conformite2026.tsx à COMPORTEMENT IDENTIQUE
 * (déplacement mot pour mot, vérifié par le golden figé sur main :
 * conformiteFenetre.golden.json). Seul changement de forme : les corps des
 * useMemo deviennent des fonctions, l'état du composant passe en argument.
 */
import { spectraFreqsForPoint } from './spectraProvenance'
import type { MeasurementFile, DataPoint, Period as NamedPeriod, Category } from '../types'
import { laeqAvg, extractBp, analyzeKt, computeKb, computeKi, computeLar1h, filterDataByPeriods, dpTimestampMs } from './acoustics'
import type { KtAnalysis } from './acoustics'

export type ReceptorType = 'I' | 'II' | 'III' | 'IV'
export type Period = 'jour' | 'nuit'

export const RECEPTOR_LABELS: Record<ReceptorType, string> = {
  I: 'Type I — Habitation, école, hôpital',
  II: 'Type II — Camping, habitation sommaire',
  III: 'Type III — Commercial / touristique',
  IV: 'Type IV — Industriel / agricole',
}

/** Niveaux maximaux LAr,1h en dB(A) — Tableau 1 MELCCFP 2026 */
export const LIMITS: Record<ReceptorType, Record<Period, number>> = {
  I:   { jour: 45, nuit: 40 },
  II:  { jour: 50, nuit: 45 },
  III: { jour: 55, nuit: 50 },
  IV:  { jour: 70, nuit: 70 },
}

/** Période de la journée à partir d'un instant t (minutes) — jour 7 h–19 h */
export function periodOf(tMin: number): Period {
  const m = ((tMin % 1440) + 1440) % 1440
  return m >= 7 * 60 && m < 19 * 60 ? 'jour' : 'nuit'
}

// ────────────────────────────────────────────────────────────────────────────
// Types internes
// ────────────────────────────────────────────────────────────────────────────


export interface PointResult {
  point: string
  ba: number | null               // LAeq sur la fenêtre 1 h
  br: number | null               // bruit résiduel (saisi)
  bp: number | null               // bruit particulier extrait
  bpReason: 'ok' | 'insufficient' | 'noBr' | 'noData'
  kt: number
  ktAuto: boolean
  ktAnalysis: KtAnalysis | null
  ki: number
  kiAuto: boolean
  kb: number
  kbAuto: boolean
  ks: number
  appliedK: number
  appliedKLabel: string
  lar: number | null              // LAr,1h
  criterion: number               // max(Br, limite tableau)
  pass: boolean | null
  count: number                   // nombre de points dans la fenêtre
  /**
   * Couverture RÉELLE de la fenêtre (minutes retenues sur 60, causes des
   * minutes manquantes). Le LAr,1h reste calculé : c'est au responsable de
   * juger de sa validité (§3.7.1) ; l'app lui donne le chiffre.
   */
  couverture: CouvertureFenetre
}

export function fmt(n: number | null, digits = 1): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits)
}

export function num(s: string): number | null {
  if (s.trim() === '') return null
  const n = parseFloat(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

/** "HH:MM" → minutes depuis minuit */
export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10))
  return (h || 0) * 60 + (m || 0)
}


/** Entrée de la fenêtre : l'état du composant, passé explicitement. */
export interface EntreeFenetre {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  periods?: NamedPeriod[]
  categories?: Category[]
  evalHour: string
  period: Period
  brJour: string
  brNuit: string
  receptor: ReceptorType
  ktManual: Record<string, number | null>
  kiManual: Record<string, number | null>
  ksEnabled: boolean
  ksValue: string
  ksReason: string
}

/** Points actifs sur la date sélectionnée */
export function pointsActifs(files: MeasurementFile[], pointMap: Record<string, string>, selectedDate: string): string[] {
    const pts = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id] && f.date === selectedDate) pts.add(pointMap[f.id])
    }
    return [...pts].sort()
}

/** Données brutes regroupées par point (pré-filtrées par les périodes actives) */
export function donneesParPoint(
  files: MeasurementFile[],
  pointMap: Record<string, string>,
  selectedDate: string,
  pointNames: string[],
  periods: NamedPeriod[] | undefined,
  categories: Category[] | undefined,
): Map<string, DataPoint[]> {
    const map = new Map<string, DataPoint[]>()
    for (const pt of pointNames) {
      const dps = files
        .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
        .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories))
      map.set(pt, dps)
    }
    return map
}

/** Résultats par point pour la fenêtre d'évaluation choisie. */
export function evaluerFenetres(e: EntreeFenetre): PointResult[] {
  const { files, pointMap, selectedDate, periods, categories, evalHour, period, brJour, brNuit, receptor, ktManual, kiManual, ksEnabled, ksValue, ksReason } = e
  const pointNames = pointsActifs(files, pointMap, selectedDate)
  const dataByPoint = donneesParPoint(files, pointMap, selectedDate, pointNames, periods, categories)
  const evalStartMin = hhmmToMinutes(evalHour)
  const avecCouverture = (r: Omit<PointResult, 'couverture'>): PointResult => ({
    ...r,
    couverture: couvertureFenetre(files, pointMap, selectedDate, r.point, periods, categories, evalStartMin),
  })
  return (() => {
    const evalStart = hhmmToMinutes(evalHour)
    const evalEnd = evalStart + 60
    const br = period === 'jour' ? num(brJour) : num(brNuit)

    return pointNames.map<Omit<PointResult, 'couverture'>>((pt) => {
      const dps = dataByPoint.get(pt) ?? []
      const inWindow = dps.filter((d) => {
        const m = ((d.t % 1440) + 1440) % 1440
        const me = evalEnd > 1440 ? evalEnd - 1440 : evalEnd
        return evalEnd > 1440
          ? m >= evalStart || m < me
          : m >= evalStart && m < evalEnd
      })

      if (inWindow.length === 0) {
        return {
          point: pt,
          ba: null,
          br,
          bp: null,
          bpReason: 'noData',
          kt: 0,
          ktAuto: false,
          ktAnalysis: null,
          ki: 0,
          kiAuto: false,
          kb: 0,
          kbAuto: false,
          ks: 0,
          appliedK: 0,
          appliedKLabel: '—',
          lar: null,
          criterion: br !== null ? Math.max(br, LIMITS[receptor][period]) : LIMITS[receptor][period],
          pass: null,
          count: 0,
        }
      }

      const ba = laeqAvg(inWindow.map((d) => d.laeq))

      // Bp
      let bp: number | null = null
      let bpReason: PointResult['bpReason'] = 'ok'
      if (br === null) {
        bpReason = 'noBr'
      } else if (ba - br < 3) {
        bpReason = 'insufficient'
      } else {
        bp = extractBp(ba, br)
        if (bp === null) bpReason = 'insufficient'
      }

      // Kt — auto sur spectre moyen (Tableau 2 MELCCFP 2026), sinon override manuel
      let kt = 0
      let ktAuto = false
      let ktAnalysis: KtAnalysis | null = null
      const manualKt = ktManual[pt]
      if (manualKt !== undefined && manualKt !== null) {
        kt = manualKt
      } else {
        const specs = inWindow.map((d) => d.spectra).filter((s): s is number[] => !!s)
        if (specs.length > 0) {
          const nBands = specs[0].length
          const avgSpec = new Array(nBands).fill(0).map((_, i) => {
            const vals = specs.map((s) => s[i]).filter((v) => typeof v === 'number')
            return laeqAvg(vals)
          })
          // Alignement PROUVÉ ou rien : un Kt de 0 sur un spectre désaligné
          // serait un échec technique déguisé en « pas de tonalité ».
          ktAnalysis = analyzeKt(avgSpec, ba, spectraFreqsForPoint(files, pointMap, pt, selectedDate))
          if (!ktAnalysis.unavailable) {
            kt = ktAnalysis.kt
            ktAuto = true
          }
        }
      }

      // Kb — auto si LCeq disponible
      let kb = 0
      let kbAuto = false
      const lceqs = inWindow.map((d) => d.lceq).filter((v): v is number => typeof v === 'number')
      if (lceqs.length > 0) {
        kb = computeKb(laeqAvg(lceqs), ba)
        kbAuto = true
      }

      // Ki — auto si laftEq disponible, sinon manuel
      let ki = 0
      let kiAuto = false
      const lafts = inWindow.map((d) => d.laftEq).filter((v): v is number => typeof v === 'number')
      if (lafts.length > 0) {
        ki = computeKi(laeqAvg(lafts), ba)
        kiAuto = true
      } else {
        const manualKi = kiManual[pt]
        if (manualKi !== undefined && manualKi !== null) ki = manualKi
      }

      // Ks — global
      const ks = ksEnabled ? num(ksValue) ?? 0 : 0

      const appliedK = Math.max(kt, ki, kb, ks)
      let appliedKLabel = '—'
      if (appliedK > 0) {
        if (appliedK === ks && ksEnabled) appliedKLabel = `Ks (${ksReason || 'spécifique'})`
        else if (appliedK === ki) appliedKLabel = 'Ki (impulsif)'
        else if (appliedK === kb) appliedKLabel = 'Kb (basses fréq.)'
        else if (appliedK === kt) appliedKLabel = 'Kt (tonal)'
      }

      const lar = bp !== null ? computeLar1h(bp, kt, ki, kb, ks) : null
      const limit = LIMITS[receptor][period]
      const criterion = br !== null ? Math.max(br, limit) : limit
      const pass = lar !== null ? lar <= criterion : null

      return {
        point: pt,
        ba,
        br,
        bp,
        bpReason,
        kt,
        ktAuto,
        ktAnalysis,
        ki,
        kiAuto,
        kb,
        kbAuto,
        ks,
        appliedK,
        appliedKLabel,
        lar,
        criterion,
        pass,
        count: inWindow.length,
      }
    })
  })().map(avecCouverture)
}

// ────────────────────────────────────────────────────────────────────────────
// Couverture réelle de la fenêtre LAr,1h
// ────────────────────────────────────────────────────────────────────────────

/** Les quatre causes de minutes manquantes dans une fenêtre. */
export type CauseManque = 'exclusionMeteo' | 'exclusionManuelle' | 'horsInclusion' | 'absenceDonnees'

export const LIBELLE_CAUSE: Record<CauseManque, string> = {
  exclusionMeteo: 'exclusion météo',
  exclusionManuelle: 'exclusion manuelle',
  horsInclusion: 'hors période d’inclusion',
  absenceDonnees: 'absence de données',
}

/**
 * Minutes RÉELLEMENT couvertes par des données retenues sur les 60 de la
 * fenêtre, et ventilation des minutes manquantes par cause. Résolution : la
 * seconde. Recalculée à chaque rendu (jamais figée) : elle décrit l'état
 * ACTUEL des périodes. `retenuesMin + Σ manquantesMin = 60`.
 */
export interface CouvertureFenetre {
  retenuesMin: number
  manquantesMin: Record<CauseManque, number>
}

/** Pas d'échantillonnage d'un fichier (minutes) : médiane des écarts positifs de t. */
export function pasFichierMin(data: DataPoint[]): number {
  const ecarts: number[] = []
  for (let i = 1; i < data.length; i++) {
    const d = data[i].t - data[i - 1].t
    if (d > 0) ecarts.push(d)
  }
  if (ecarts.length === 0) return 1 / 60
  ecarts.sort((a, b) => a - b)
  return ecarts[Math.floor(ecarts.length / 2)]
}

// Statuts d'une seconde de fenêtre, par PRIORITÉ croissante : une seconde
// couverte par une donnée retenue est retenue, quoi qu'en disent les autres
// échantillons qui la recouvrent.
const ABSENCE = 0
const HORS_INCLUSION = 1
const EXCL_MANUELLE = 2
const EXCL_METEO = 3
const RETENUE = 4

/**
 * Couverture de la fenêtre [evalStart, evalStart + 60 min[ pour un point.
 *
 * Mêmes conventions que le calcul de Ba (evaluerFenetres) : un échantillon
 * appartient à la fenêtre si son instant `t` (modulo 1440) y tombe ; il couvre
 * `[t, t + pas[` tronqué à la fin de la fenêtre. Le pas est déduit PAR FICHIER
 * (médiane des écarts de t) : des fichiers à des pas différents comptent chacun
 * leur vraie durée, et deux fichiers qui se recouvrent ne comptent pas deux fois
 * les mêmes secondes.
 *
 * Attribution des causes : EXACTEMENT les règles de filterDataByPeriods
 * (catégories visibles ; bornes [début, fin[ ; l'exclusion prime ; dès qu'une
 * période d'inclusion existe, ce qui est hors inclusion est retiré). Une
 * exclusion est « météo » si la période porte un motifMeteo.
 */
export function couvertureFenetre(
  files: MeasurementFile[],
  pointMap: Record<string, string>,
  selectedDate: string,
  point: string,
  periods: NamedPeriod[] | undefined,
  categories: Category[] | undefined,
  evalStart: number,
): CouvertureFenetre {
  const secondes = new Uint8Array(3600)
  const cats = categories ?? []
  const pers = periods ?? []
  const incIds = new Set(cats.filter((c) => c.visible && (c.mode === 'include' || c.mode === 'reference')).map((c) => c.id))
  const excIds = new Set(cats.filter((c) => c.visible && c.mode === 'exclude').map((c) => c.id))
  const inclusions = pers.filter((p) => incIds.has(p.categoryId))
  const exclusions = pers.filter((p) => excIds.has(p.categoryId))
  const dans = (p: NamedPeriod, ts: number) => ts >= p.startMs && ts < p.endMs

  for (const f of files) {
    if (pointMap[f.id] !== point || f.date !== selectedDate || f.data.length === 0) continue
    const pas = pasFichierMin(f.data)
    const base = dpTimestampMs(f.date, 0)
    for (const d of f.data) {
      const m = ((d.t % 1440) + 1440) % 1440
      const offset = (m - evalStart + 1440) % 1440
      if (offset >= 60) continue
      let statut = RETENUE
      const ts = base + d.t * 60_000
      if (Number.isFinite(base)) {
        const excl = exclusions.filter((p) => dans(p, ts))
        if (excl.length > 0) statut = excl.some((p) => p.motifMeteo) ? EXCL_METEO : EXCL_MANUELLE
        else if (inclusions.length > 0 && !inclusions.some((p) => dans(p, ts))) statut = HORS_INCLUSION
      }
      const a = Math.floor(offset * 60 + 1e-9)
      const b = Math.min(3600, Math.ceil(Math.min(offset + pas, 60) * 60 - 1e-9))
      for (let s = a; s < b; s++) if (statut > secondes[s]) secondes[s] = statut
    }
  }

  const compte = [0, 0, 0, 0, 0]
  for (let s = 0; s < 3600; s++) compte[secondes[s]]++
  const min = (n: number) => Math.round((n / 60) * 10) / 10
  return {
    retenuesMin: min(compte[RETENUE]),
    manquantesMin: {
      exclusionMeteo: min(compte[EXCL_METEO]),
      exclusionManuelle: min(compte[EXCL_MANUELLE]),
      horsInclusion: min(compte[HORS_INCLUSION]),
      absenceDonnees: min(compte[ABSENCE]),
    },
  }
}

/** « 35/60 min — 20 min exclusion manuelle, 5 min absence de données » */
export function libelleCouverture(c: CouvertureFenetre): string {
  const detail = (Object.keys(LIBELLE_CAUSE) as CauseManque[])
    .filter((k) => c.manquantesMin[k] > 0)
    .map((k) => `${c.manquantesMin[k]} min ${LIBELLE_CAUSE[k]}`)
  return `${c.retenuesMin}/60 min` + (detail.length ? ` — ${detail.join(', ')}` : '')
}

/** Vrai si la fenêtre n'est pas entièrement couverte par des données retenues. */
export const fenetreIncomplete = (c: CouvertureFenetre) => c.retenuesMin < 60

/**
 * Bloc « couverture » de la section Conformité du rapport : une ligne par
 * point, la cause de chaque minute manquante, et le rappel que le LAr,1h est
 * calculé sur les seules minutes retenues — le responsable juge (§3.7.1).
 */
export function blocCouvertureRapport(points: { point: string; couverture?: CouvertureFenetre }[]): string[] {
  const avec = points.filter((p) => p.couverture)
  if (avec.length === 0) return []
  const lignes = ["Couverture de la fenêtre d'évaluation (minutes de données retenues sur 60) :"]
  for (const p of avec) {
    const c = p.couverture!
    lignes.push(`  ${fenetreIncomplete(c) ? '⚠' : '✓'} ${p.point} : ${libelleCouverture(c)}`)
  }
  if (avec.some((p) => fenetreIncomplete(p.couverture!))) {
    lignes.push(
      "Sur une fenêtre incomplète, le LAr,1h est calculé sur les seules minutes retenues et n'est pas " +
        'un niveau horaire complet ; sa validité relève du jugement du responsable (§3.7.1).',
    )
  }
  return lignes
}
