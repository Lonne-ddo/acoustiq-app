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
import { laeqAvg, extractBp, analyzeKt, computeKb, computeKi, computeLar1h, filterDataByPeriods } from './acoustics'
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
  return (() => {
    const evalStart = hhmmToMinutes(evalHour)
    const evalEnd = evalStart + 60
    const br = period === 'jour' ? num(brJour) : num(brNuit)

    return pointNames.map<PointResult>((pt) => {
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
  })()
}
