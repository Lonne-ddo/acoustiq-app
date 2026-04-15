/**
 * Conformité 2026 — Vérification selon les Lignes directrices MELCCFP 2026
 *
 * Référentiel : Lignes directrices relatives à la gestion du bruit
 * environnemental, ministère de l'Environnement, de la Lutte contre les
 * changements climatiques, de la Faune et des Parcs (MELCCFP), en vigueur
 * depuis le 13 janvier 2026. Remplace la note d'instructions NI 98-01.
 *
 * Méthode : l'utilisateur sélectionne une heure d'évaluation (HH:MM). Pour
 * chaque point chargé, le LAeq sur la fenêtre 1 h correspondante est calculé
 * (Ba), puis le bruit particulier Bp est extrait à partir du bruit résiduel Br
 * saisi (ou calculé via L90). Les termes correctifs Kt / Ki / Kb sont
 * automatiques lorsque les données le permettent (spectres 1/3 d'octave,
 * LCeq, LAFTeq) avec possibilité de surcharge manuelle. Ks reste manuel.
 *
 *     LAr,1h = Bp + max(Kt, Ki, Kb, Ks)
 *     Critère = max(Br,1h, niveau maximal du Tableau 1)
 */
import { useState, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  Download,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Shield,
  Info,
  Clock,
  BookOpen,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import { loadAll as loadRegulationDocs, OFFICIAL_SOURCES } from '../modules/regulationDB'
import HelpTooltip from './HelpTooltip'
import type { MeasurementFile, DataPoint, ConformiteSummary, Period as NamedPeriod } from '../types'
import {
  laeqAvg,
  computeL90,
  extractBp,
  analyzeKt,
  computeKb,
  computeKi,
  computeLar1h,
  filterDataByPeriods,
} from '../utils/acoustics'
import type { KtAnalysis } from '../utils/acoustics'

// ────────────────────────────────────────────────────────────────────────────
// Référentiel : Tableau 1 — Lignes directrices MELCCFP 2026
// ────────────────────────────────────────────────────────────────────────────

type ReceptorType = 'I' | 'II' | 'III' | 'IV'
type Period = 'jour' | 'nuit'

const RECEPTOR_LABELS: Record<ReceptorType, string> = {
  I: 'Type I — Habitation, école, hôpital',
  II: 'Type II — Camping, habitation sommaire',
  III: 'Type III — Commercial / touristique',
  IV: 'Type IV — Industriel / agricole',
}

/** Niveaux maximaux LAr,1h en dB(A) — Tableau 1 MELCCFP 2026 */
const LIMITS: Record<ReceptorType, Record<Period, number>> = {
  I:   { jour: 45, nuit: 40 },
  II:  { jour: 50, nuit: 45 },
  III: { jour: 55, nuit: 50 },
  IV:  { jour: 70, nuit: 70 },
}

/** Période de la journée à partir d'un instant t (minutes) — jour 7 h–19 h */
function periodOf(tMin: number): Period {
  const m = ((tMin % 1440) + 1440) % 1440
  return m >= 7 * 60 && m < 19 * 60 ? 'jour' : 'nuit'
}

// ────────────────────────────────────────────────────────────────────────────
// Types internes
// ────────────────────────────────────────────────────────────────────────────

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  /** Notifie le parent (App) à chaque recalcul, pour partage avec le Rapport. */
  onSummaryChange?: (summary: ConformiteSummary | null) => void
  /** Récepteur conformité (contrôlé depuis App, pour les templates) */
  receptor?: ReceptorType
  onReceptorChange?: (r: ReceptorType) => void
  period?: Period
  onPeriodChange?: (p: Period) => void
  /** Périodes nommées globales — filtrent les données pour Ba/LAeq, Br... */
  periods?: NamedPeriod[]
}

interface PointResult {
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

function fmt(n: number | null, digits = 1): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits)
}

function num(s: string): number | null {
  if (s.trim() === '') return null
  const n = parseFloat(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

/** "HH:MM" → minutes depuis minuit */
function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10))
  return (h || 0) * 60 + (m || 0)
}

// ────────────────────────────────────────────────────────────────────────────
// Composant
// ────────────────────────────────────────────────────────────────────────────

export default function Conformite2026({
  files, pointMap, selectedDate, onSummaryChange,
  receptor: receptorProp, onReceptorChange,
  period: periodProp, onPeriodChange,
  periods,
}: Props) {
  // Référentiel sélectionné — contrôlé si props fournies, sinon état local
  const [receptorLocal, setReceptorLocal] = useState<ReceptorType>('I')
  const [periodLocal, setPeriodLocal] = useState<Period>('jour')
  const receptor = receptorProp ?? receptorLocal
  const period = periodProp ?? periodLocal
  const setReceptor = (r: ReceptorType) => {
    if (onReceptorChange) onReceptorChange(r)
    else setReceptorLocal(r)
  }
  const setPeriod = (p: Period) => {
    if (onPeriodChange) onPeriodChange(p)
    else setPeriodLocal(p)
  }

  // Bruit résiduel (saisie globale, jour/nuit)
  const [brJour, setBrJour] = useState<string>('')
  const [brNuit, setBrNuit] = useState<string>('')

  // Période "calme" pour l'auto-calcul de Br via L90 (HH:MM-HH:MM)
  const [quietStart, setQuietStart] = useState<string>('02:00')
  const [quietEnd, setQuietEnd] = useState<string>('05:00')

  // Heure d'évaluation (fenêtre 1 h glissante : [evalHour, evalHour + 60 min])
  const [evalHour, setEvalHour] = useState<string>('14:00')

  // Incertitude : ISO 9613-2
  // - mesurage = ± 1 dB (sonomètre classe 1, fixe)
  // - propagation = saisie utilisateur (défaut 3 dB)
  // - combinée = sqrt(1² + propagation²)
  const MEASUREMENT_UNCERTAINTY = 1
  const [propagationUncertainty, setPropagationUncertainty] = useState<string>('3')
  const propU = num(propagationUncertainty) ?? 3
  const combinedU = Math.sqrt(MEASUREMENT_UNCERTAINTY * MEASUREMENT_UNCERTAINTY + propU * propU)

  // Termes correctifs : surcharges manuelles (par point)
  const [ktManual, setKtManual] = useState<Record<string, number | null>>({})
  const [kiManual, setKiManual] = useState<Record<string, number | null>>({})
  const [ksEnabled, setKsEnabled] = useState<boolean>(false)
  const [ksValue, setKsValue] = useState<string>('5')
  const [ksReason, setKsReason] = useState<string>('')

  // Points actifs sur la date sélectionnée
  const pointNames = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id] && f.date === selectedDate) pts.add(pointMap[f.id])
    }
    return [...pts].sort()
  }, [files, pointMap, selectedDate])

  /** Données brutes regroupées par point (pré-filtrées par les périodes actives) */
  const dataByPoint = useMemo(() => {
    const map = new Map<string, DataPoint[]>()
    for (const pt of pointNames) {
      const dps = files
        .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
        .flatMap((f) => filterDataByPeriods(f.data, f.date, periods))
      map.set(pt, dps)
    }
    return map
  }, [files, pointMap, selectedDate, pointNames, periods])

  /** Auto-calcul de Br jour/nuit à partir du L90 sur la période calme. */
  function computeBrFromQuietPeriod() {
    const start = hhmmToMinutes(quietStart)
    const end = hhmmToMinutes(quietEnd)
    const inWindow = (t: number) => {
      const m = ((t % 1440) + 1440) % 1440
      return start <= end ? m >= start && m < end : m >= start || m < end
    }
    const allDay: number[] = []
    const allNight: number[] = []
    for (const dps of dataByPoint.values()) {
      for (const d of dps) {
        if (!inWindow(d.t)) continue
        if (periodOf(d.t) === 'jour') allDay.push(d.laeq)
        else allNight.push(d.laeq)
      }
    }
    if (allDay.length > 0) setBrJour(computeL90(allDay).toFixed(1))
    if (allNight.length > 0) setBrNuit(computeL90(allNight).toFixed(1))
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Calcul des résultats par point pour la fenêtre d'évaluation choisie
  // ──────────────────────────────────────────────────────────────────────────

  const results: PointResult[] = useMemo(() => {
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
          ktAnalysis = analyzeKt(avgSpec, ba)
          kt = ktAnalysis.kt
          ktAuto = true
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
  }, [
    pointNames,
    dataByPoint,
    evalHour,
    period,
    brJour,
    brNuit,
    receptor,
    ktManual,
    kiManual,
    ksEnabled,
    ksValue,
    ksReason,
  ])

  // Publier le résumé vers le parent (pour le générateur de rapport)
  useEffect(() => {
    if (!onSummaryChange) return
    if (results.length === 0) {
      onSummaryChange(null)
      return
    }
    onSummaryChange({
      receptor,
      receptorLabel: RECEPTOR_LABELS[receptor],
      period,
      evalHour,
      date: selectedDate,
      limit: LIMITS[receptor][period],
      uncertainty: combinedU,
      points: results.map((r) => {
        const larPlusU = r.lar !== null ? r.lar + combinedU : null
        return {
          point: r.point,
          ba: r.ba,
          br: r.br,
          bp: r.bp,
          lar: r.lar,
          criterion: r.criterion,
          appliedKLabel: r.appliedKLabel,
          pass: r.pass,
          larPlusU,
          margeNonConforme: larPlusU !== null && larPlusU > r.criterion,
        }
      }),
    })
  }, [results, receptor, period, evalHour, selectedDate, onSummaryChange, combinedU])

  // ──────────────────────────────────────────────────────────────────────────
  // Export Excel
  // ──────────────────────────────────────────────────────────────────────────

  function handleExport() {
    const wb = XLSX.utils.book_new()

    const sheetRows = results.map((r) => {
      const larPlusU = r.lar !== null ? r.lar + combinedU : null
      const margeNonConforme = larPlusU !== null && larPlusU > r.criterion
      return {
        Point: r.point,
        'Ba (LAeq) dB(A)': r.ba !== null ? r.ba.toFixed(1) : '',
        'Br dB(A)': r.br !== null ? r.br.toFixed(1) : '',
        'Bp dB(A)':
          r.bp !== null
            ? r.bp.toFixed(1)
            : r.bpReason === 'insufficient'
            ? 'non calculable (Ba−Br < 3 dB)'
            : '',
        Kt: r.kt,
        Ki: r.ki.toFixed(1),
        Kb: r.kb,
        Ks: r.ks,
        'Correction appliquée': r.appliedKLabel,
        'LAr,1h dB(A)': r.lar !== null ? r.lar.toFixed(1) : '',
        'Incertitude combinée ± dB': combinedU.toFixed(1),
        'LAr,1h + U dB(A)': larPlusU !== null ? larPlusU.toFixed(1) : '',
        'Critère dB(A)': r.criterion.toFixed(1),
        Résultat: r.pass === null ? '—' : r.pass ? 'CONFORME' : 'NON CONFORME',
        'Marge incertitude':
          larPlusU === null
            ? '—'
            : margeNonConforme
            ? 'NON CONFORME AVEC MARGE'
            : 'CONFORME AVEC MARGE',
        Dépassement:
          r.pass === false && r.lar !== null ? (r.lar - r.criterion).toFixed(1) : '',
      }
    })
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(sheetRows),
      'Conformité 2026',
    )

    const summary = [
      {
        Référentiel: 'Lignes directrices MELCCFP 2026',
        Note: 'Selon les Lignes directrices MELCCFP 2026, en vigueur depuis le 13 janvier 2026',
        'Type de récepteur': RECEPTOR_LABELS[receptor],
        Période: period === 'jour' ? 'Jour (7 h – 19 h)' : 'Nuit (19 h – 7 h)',
        "Heure d'évaluation": `${evalHour} → +1 h`,
        Date: selectedDate,
        'Points conformes': results.filter((r) => r.pass === true).length,
        'Points non conformes': results.filter((r) => r.pass === false).length,
      },
      {
        Référentiel: 'Généré par AcoustiQ',
        Note: 'https://acoustiq-app.pages.dev',
        'Type de récepteur': '',
        Période: '',
        "Heure d'évaluation": '',
        Date: '',
        'Points conformes': '',
        'Points non conformes': '',
      },
    ]
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(summary),
      'Synthèse',
    )

    XLSX.writeFile(
      wb,
      `acoustiq_conformite2026_${selectedDate}_${evalHour.replace(':', 'h')}.xlsx`,
    )
  }

  const evaluable = results.filter((r) => r.pass !== null)
  const allPass = evaluable.length > 0 && evaluable.every((r) => r.pass === true)

  // ──────────────────────────────────────────────────────────────────────────
  // Rendu
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Barre de contrôle */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-emerald-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Conformité 2026
          </span>
          <HelpTooltip
            text="Lignes directrices relatives à la gestion du bruit environnemental (MELCCFP 2026), en vigueur depuis le 13 janvier 2026. Remplace la note d'instructions NI 98-01."
            position="right"
          />
        </div>

        <div className="flex items-center gap-2 ml-4">
          <span className="text-xs text-gray-500">Récepteur :</span>
          {(['I', 'II', 'III', 'IV'] as ReceptorType[]).map((r) => (
            <button
              key={r}
              onClick={() => setReceptor(r)}
              title={RECEPTOR_LABELS[r]}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                receptor === r
                  ? 'bg-emerald-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              Type {r}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-2">
          <span className="text-xs text-gray-500">Période :</span>
          {(['jour', 'nuit'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                period === p
                  ? 'bg-emerald-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {p === 'jour' ? 'Jour' : 'Nuit'}
            </button>
          ))}
        </div>

        <button
          onClick={handleExport}
          disabled={results.length === 0}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700
                     border border-gray-600 transition-colors disabled:opacity-30"
        >
          <Download size={12} />
          Exporter Excel
        </button>
      </div>

      {/* Contenu */}
      <div className="flex-1 overflow-auto p-4">
        {pointNames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
            <Shield size={48} className="opacity-20" />
            <p className="text-sm">
              Chargez des fichiers et assignez-les à des points de mesure
            </p>
          </div>
        ) : (
          <div className="space-y-5 max-w-5xl">
            {/* Bandeau référentiel */}
            <div className="px-3 py-2 rounded border border-emerald-900/50 bg-emerald-950/20 flex items-start gap-2">
              <Info size={14} className="text-emerald-400 mt-0.5 shrink-0" />
              <div className="text-xs text-gray-300">
                <span className="font-semibold text-emerald-300">
                  {RECEPTOR_LABELS[receptor]}
                </span>{' '}
                — Niveau maximal LAr,1h{' '}
                <span className="text-gray-200">
                  ({period === 'jour' ? 'jour' : 'nuit'}) :{' '}
                  {LIMITS[receptor][period]} dB(A)
                </span>
              </div>
            </div>

            {/* A) Bruit résiduel */}
            <section className="border border-gray-800 rounded-lg p-4 bg-gray-900/30">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                A · Bruit résiduel (Br)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex gap-3">
                  <label className="flex-1 text-xs text-gray-400">
                    Br jour dB(A)
                    <input
                      type="number"
                      step="0.1"
                      value={brJour}
                      onChange={(e) => setBrJour(e.target.value)}
                      placeholder="ex. 38.5"
                      className="mt-1 w-full text-xs bg-gray-800 text-gray-200 border
                                 border-gray-700 rounded px-2 py-1 focus:outline-none
                                 focus:ring-1 focus:ring-emerald-500"
                    />
                  </label>
                  <label className="flex-1 text-xs text-gray-400">
                    Br nuit dB(A)
                    <input
                      type="number"
                      step="0.1"
                      value={brNuit}
                      onChange={(e) => setBrNuit(e.target.value)}
                      placeholder="ex. 32.0"
                      className="mt-1 w-full text-xs bg-gray-800 text-gray-200 border
                                 border-gray-700 rounded px-2 py-1 focus:outline-none
                                 focus:ring-1 focus:ring-emerald-500"
                    />
                  </label>
                </div>
                <div className="flex items-end gap-2">
                  <label className="text-xs text-gray-400">
                    Période calme
                    <div className="flex items-center gap-1 mt-1">
                      <input
                        type="time"
                        value={quietStart}
                        onChange={(e) => setQuietStart(e.target.value)}
                        className="text-xs bg-gray-800 text-gray-200 border border-gray-700
                                   rounded px-2 py-1"
                      />
                      <span className="text-gray-600">→</span>
                      <input
                        type="time"
                        value={quietEnd}
                        onChange={(e) => setQuietEnd(e.target.value)}
                        className="text-xs bg-gray-800 text-gray-200 border border-gray-700
                                   rounded px-2 py-1"
                      />
                    </div>
                  </label>
                  <button
                    onClick={computeBrFromQuietPeriod}
                    className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700
                               border border-gray-700"
                    title="Calcule Br = L90 sur la période sélectionnée"
                  >
                    Calculer depuis les données
                  </button>
                </div>
              </div>
            </section>

            {/* B) Bruit ambiant */}
            <section className="border border-gray-800 rounded-lg p-4 bg-gray-900/30">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                B · Bruit ambiant (Ba)
              </h3>
              <div className="flex items-center gap-3">
                <Clock size={14} className="text-gray-500" />
                <label className="text-xs text-gray-400">
                  Heure d'évaluation (fenêtre 1 h)
                  <input
                    type="time"
                    value={evalHour}
                    onChange={(e) => setEvalHour(e.target.value)}
                    className="ml-2 text-xs bg-gray-800 text-gray-200 border border-gray-700
                               rounded px-2 py-1"
                  />
                </label>
                <span className="text-[10px] text-gray-600 italic">
                  Ba = LAeq sur [{evalHour}, {evalHour} +1 h] pour chaque point
                </span>
              </div>
            </section>

            {/* D) Termes correctifs — paramètres globaux Ks */}
            <section className="border border-gray-800 rounded-lg p-4 bg-gray-900/30">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                D · Termes correctifs
              </h3>
              <p className="text-[10px] text-gray-600 italic mb-3">
                Kt, Ki et Kb sont calculés automatiquement lorsque les données
                requises sont disponibles (spectres 1/3 d'octave, LCeq, LAFTeq).
                Une surcharge manuelle par point est possible dans le tableau
                ci-dessous.
              </p>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={ksEnabled}
                    onChange={(e) => setKsEnabled(e.target.checked)}
                  />
                  Ks (correction subjective)
                </label>
                {ksEnabled && (
                  <>
                    <input
                      type="number"
                      step="1"
                      value={ksValue}
                      onChange={(e) => setKsValue(e.target.value)}
                      className="w-16 text-xs bg-gray-800 text-gray-200 border border-gray-700
                                 rounded px-2 py-1"
                    />
                    <span className="text-xs text-gray-600">dB</span>
                    <input
                      type="text"
                      value={ksReason}
                      onChange={(e) => setKsReason(e.target.value)}
                      placeholder="Description / motif"
                      className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-700
                                 rounded px-2 py-1"
                    />
                  </>
                )}
              </div>
            </section>

            {/* C + E + F) Tableau de résultats */}
            <section className="border border-gray-800 rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/50">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  C · Bp · E · LAr,1h · F · Conformité
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-500 bg-gray-900/30">
                      <th className="text-left px-3 py-2 font-medium">Point</th>
                      <th className="px-3 py-2 font-medium text-right">Ba</th>
                      <th className="px-3 py-2 font-medium text-right">Br</th>
                      <th className="px-3 py-2 font-medium text-right">Bp</th>
                      <th className="px-3 py-2 font-medium text-center">Kt</th>
                      <th className="px-3 py-2 font-medium text-center">Ki</th>
                      <th className="px-3 py-2 font-medium text-center">Kb</th>
                      <th className="px-3 py-2 font-medium text-center">K appl.</th>
                      <th className="px-3 py-2 font-medium text-right">LAr,1h</th>
                      <th className="px-3 py-2 font-medium text-right">Critère</th>
                      <th className="px-3 py-2 font-medium text-center">Résultat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.point} className="border-b border-gray-800/50">
                        <td className="px-3 py-2 text-gray-200 font-medium">
                          {r.point}
                          {r.count > 0 && (
                            <span className="ml-2 text-[10px] text-gray-600">
                              {r.count} pts
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-200">
                          {fmt(r.ba)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-400">
                          {fmt(r.br)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.bp !== null ? (
                            <span className="text-gray-200">{fmt(r.bp)}</span>
                          ) : r.bpReason === 'insufficient' && r.ba !== null && r.br !== null ? (
                            <span
                              className="text-amber-400"
                              title="Différence insuffisante — Bp non calculable selon ISO 1996-2"
                            >
                              Bp ≤ Br
                            </span>
                          ) : (
                            <span className="text-gray-700">—</span>
                          )}
                        </td>
                        {/* Kt */}
                        <td className="px-3 py-2 text-center">
                          <KCorrInput
                            value={r.kt}
                            auto={r.ktAuto}
                            onChange={(v) =>
                              setKtManual((prev) => ({ ...prev, [r.point]: v }))
                            }
                            onClearOverride={() =>
                              setKtManual((prev) => {
                                const cp = { ...prev }
                                delete cp[r.point]
                                return cp
                              })
                            }
                            hasOverride={ktManual[r.point] !== undefined}
                          />
                          {r.ktAuto && ktManual[r.point] === undefined && r.ktAnalysis && (() => {
                            const a = r.ktAnalysis
                            const detected = a.kt > 0 && a.triggeringIndex !== null
                            const trig = detected ? a.bands[a.triggeringIndex as number] : null
                            const emergence = trig
                              ? Math.min(trig.diffPrev as number, trig.diffNext as number)
                              : null
                            return (
                              <div
                                className={`mt-0.5 text-[9px] leading-tight ${
                                  detected ? 'text-orange-400' : 'text-emerald-500'
                                }`}
                                title={
                                  detected && trig
                                    ? `Composante tonale détectée à ${trig.freq} Hz — émergence min. ${emergence?.toFixed(1)} dB (seuil ${trig.threshold} dB)`
                                    : 'Aucune composante tonale détectée selon Tableau 2 MELCCFP 2026'
                                }
                              >
                                {detected && trig
                                  ? `Auto — détecté · ${trig.freq} Hz · +${emergence?.toFixed(1)} dB`
                                  : 'Auto — non détecté'}
                              </div>
                            )
                          })()}
                        </td>
                        {/* Ki */}
                        <td className="px-3 py-2 text-center">
                          <KCorrInput
                            value={r.ki}
                            auto={r.kiAuto}
                            onChange={(v) =>
                              setKiManual((prev) => ({ ...prev, [r.point]: v }))
                            }
                            onClearOverride={() =>
                              setKiManual((prev) => {
                                const cp = { ...prev }
                                delete cp[r.point]
                                return cp
                              })
                            }
                            hasOverride={kiManual[r.point] !== undefined}
                          />
                        </td>
                        {/* Kb */}
                        <td className="px-3 py-2 text-center tabular-nums text-gray-400">
                          {r.kb}
                          {r.kbAuto && <span className="text-emerald-600 ml-1">·</span>}
                        </td>
                        <td
                          className="px-3 py-2 text-center text-gray-300"
                          title={r.appliedKLabel}
                        >
                          {r.appliedK > 0 ? `+${r.appliedK.toFixed(1)}` : '0'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-100">
                          {fmt(r.lar)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-400">
                          {r.criterion.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.pass === null ? (
                            <span className="text-gray-700 text-[10px]">—</span>
                          ) : r.pass ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded
                                             bg-emerald-900/40 text-emerald-300 text-[10px] font-semibold">
                              <CheckCircle size={11} /> CONFORME
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded
                                         bg-red-900/40 text-red-300 text-[10px] font-semibold"
                              title={`Dépassement +${(r.lar! - r.criterion).toFixed(1)} dB`}
                            >
                              <XCircle size={11} /> NON CONFORME (+
                              {(r.lar! - r.criterion).toFixed(1)})
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-gray-800 text-[10px] text-gray-600">
                Formule appliquée :{' '}
                <span className="text-gray-400">
                  LAr,1h = Bp + max(Kt, Ki, Kb, Ks)
                </span>{' '}
                · Critère = max(Br, niveau maximal du Tableau 1) ·{' '}
                <span className="text-emerald-600">·</span> = valeur calculée
                automatiquement
              </div>
            </section>

            {/* G) Incertitude — ISO 9613-2 */}
            <section className="border border-gray-800 rounded-lg p-4 bg-gray-900/30">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                G · Incertitude (ISO 9613-2)
              </h3>
              <div className="flex items-end gap-4 flex-wrap mb-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Mesurage
                  </label>
                  <div className="text-xs text-gray-300 tabular-nums mt-0.5">
                    ± {MEASUREMENT_UNCERTAINTY.toFixed(1)} dB
                    <span className="text-[9px] text-gray-600 ml-1">(sonomètre classe 1)</span>
                  </div>
                </div>
                <label className="text-xs text-gray-400">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider block">
                    Propagation
                  </span>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-gray-500 text-xs">±</span>
                    <input
                      type="number"
                      step="0.1"
                      value={propagationUncertainty}
                      onChange={(e) => setPropagationUncertainty(e.target.value)}
                      className="w-16 text-xs bg-gray-800 text-gray-200 border border-gray-700
                                 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <span className="text-xs text-gray-500">dB</span>
                  </div>
                </label>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Combinée
                  </label>
                  <div className="text-xs text-emerald-300 font-semibold tabular-nums mt-0.5">
                    ± {combinedU.toFixed(1)} dB
                    <span className="text-[9px] text-gray-600 ml-1">
                      = √(1² + {propU.toFixed(1)}²)
                    </span>
                  </div>
                </div>
              </div>

              {/* Vérification par point : LAr,1h + U vs critère */}
              <div className="space-y-1 text-[11px]">
                {results.filter((r) => r.lar !== null).map((r) => {
                  const larPlusU = (r.lar as number) + combinedU
                  const margeNonConforme = larPlusU > r.criterion
                  return (
                    <div
                      key={`u-${r.point}`}
                      className={`px-2 py-1 rounded border flex items-center gap-2 ${
                        margeNonConforme
                          ? 'border-amber-800/60 bg-amber-950/20'
                          : 'border-gray-800 bg-gray-900/40'
                      }`}
                    >
                      <span className="font-semibold text-gray-200 w-16">{r.point}</span>
                      <span className="text-gray-400 tabular-nums">
                        LAr,1h ({(r.lar as number).toFixed(1)} dB) + incertitude
                        (±{combinedU.toFixed(1)} dB) = <span className="text-gray-100 font-semibold">{larPlusU.toFixed(1)} dB</span>
                      </span>
                      <span className="text-gray-600">vs</span>
                      <span className="text-gray-400 tabular-nums">
                        critère {r.criterion.toFixed(1)} dB
                      </span>
                      {margeNonConforme ? (
                        <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5
                                         rounded bg-amber-900/50 text-amber-200 text-[10px] font-semibold">
                          <AlertTriangle size={10} /> Non conforme avec marge d'incertitude
                        </span>
                      ) : (
                        <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5
                                         rounded bg-emerald-900/40 text-emerald-300 text-[10px] font-semibold">
                          <CheckCircle size={10} /> Conforme avec marge
                        </span>
                      )}
                    </div>
                  )
                })}
                {results.filter((r) => r.lar !== null).length === 0 && (
                  <div className="text-gray-600 italic">
                    Aucun LAr,1h calculable — vérifier la fenêtre d'évaluation et Br.
                  </div>
                )}
              </div>
              <p className="text-[10px] text-gray-600 italic mt-2">
                Méthode ISO 9613-2 — Combinaison quadratique des incertitudes de mesurage
                et de propagation. Si LAr,1h + incertitude dépasse le critère, la conformité
                doit être confirmée par une étude approfondie.
              </p>
            </section>

            {/* H · Analyse spectrale Kt — Tableau 2 MELCCFP 2026 */}
            <KtSpectrumSection results={results} />

            {/* Références réglementaires (collapsible) */}
            <ReferencesSection />

            {/* Synthèse */}
            {evaluable.length > 0 && (
              <div className="mt-2 px-3 py-2 rounded border border-gray-700 bg-gray-800/50">
                {allPass ? (
                  <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium">
                    <CheckCircle size={14} />
                    Tous les points évalués sont conformes au récepteur{' '}
                    {receptor} ({period}) — Lignes directrices MELCCFP 2026
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-amber-400 text-xs font-medium">
                    <AlertTriangle size={14} />
                    {evaluable.filter((r) => r.pass === false).length} point(s)
                    en non-conformité — Lignes directrices MELCCFP 2026
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// H · Analyse spectrale Kt — table par bande (Tableau 2 MELCCFP 2026)
// ────────────────────────────────────────────────────────────────────────────

function KtSpectrumSection({ results }: { results: PointResult[] }) {
  const withSpectrum = results.filter((r) => r.ktAnalysis && r.ktAnalysis.bands.length > 0)
  if (withSpectrum.length === 0) return null
  return (
    <section className="border border-gray-800 rounded-lg bg-gray-900/30">
      <div className="px-4 py-2 border-b border-gray-800/70 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          H · Analyse spectrale Kt — Tableau 2 MELCCFP 2026
        </span>
        <span className="text-[10px] text-gray-600">
          24 bandes 1/3 d'octave (50 Hz – 10 kHz) · LZeq → LAeq pondéré A
        </span>
      </div>
      <div className="p-3 space-y-3">
        {withSpectrum.map((r) => (
          <KtSpectrumCard key={r.point} pointName={r.point} analysis={r.ktAnalysis as KtAnalysis} />
        ))}
      </div>
    </section>
  )
}

function KtSpectrumCard({
  pointName,
  analysis,
}: {
  pointName: string
  analysis: KtAnalysis
}) {
  const [open, setOpen] = useState(false)
  const detected = analysis.kt > 0
  const trig = analysis.triggeringIndex !== null ? analysis.bands[analysis.triggeringIndex] : null
  return (
    <div className="border border-gray-800 rounded overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left
                   hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-200">{pointName}</span>
        <span
          className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border ${
            detected
              ? 'bg-orange-900/40 text-orange-300 border-orange-800/60'
              : 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60'
          }`}
        >
          Kt = {analysis.kt} dB
        </span>
        {detected && trig && (
          <span className="text-[10px] text-orange-400">
            {trig.freq} Hz · Δ préc. {(trig.diffPrev as number).toFixed(1)} ·
            Δ suiv. {(trig.diffNext as number).toFixed(1)} (seuil {trig.threshold} dB)
          </span>
        )}
        <span className="ml-auto text-[10px] text-gray-600">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-gray-500 bg-gray-900/40 border-y border-gray-800/70">
                <th className="text-right px-2 py-1 font-medium">Fréq. (Hz)</th>
                <th className="text-right px-2 py-1 font-medium">LZeq (dB)</th>
                <th className="text-right px-2 py-1 font-medium">LAeq (dB(A))</th>
                <th className="text-right px-2 py-1 font-medium">Δ préc.</th>
                <th className="text-right px-2 py-1 font-medium">Δ suiv.</th>
                <th className="text-right px-2 py-1 font-medium">Seuil</th>
                <th className="text-left px-3 py-1 font-medium">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {analysis.bands.map((b, i) => {
                const rowCls = b.isTonal
                  ? 'bg-amber-950/40'
                  : i % 2 === 0
                  ? 'bg-gray-900/20'
                  : ''
                const fmt1 = (n: number | null) => (n === null ? 'N.D.' : n.toFixed(1))
                let resultText = '—'
                let resultCls = 'text-gray-500'
                if (b.isBoundary) {
                  resultText = 'N.D. (bord)'
                  resultCls = 'text-gray-600'
                } else if (b.excluded) {
                  resultText = 'Exclu (−15 dB)'
                  resultCls = 'text-gray-500'
                } else if (b.isTonal) {
                  resultText = '⚠ Tonal'
                  resultCls = 'text-amber-300 font-semibold'
                } else {
                  resultText = 'Non tonal'
                  resultCls = 'text-gray-400'
                }
                return (
                  <tr key={b.freq} className={`${rowCls} border-b border-gray-800/30`}>
                    <td className="px-2 py-0.5 text-right text-gray-300">{b.freq}</td>
                    <td className="px-2 py-0.5 text-right text-gray-200">{b.lzeq.toFixed(1)}</td>
                    <td className="px-2 py-0.5 text-right text-gray-400">{b.laeqBand.toFixed(1)}</td>
                    <td className="px-2 py-0.5 text-right text-gray-400">{fmt1(b.diffPrev)}</td>
                    <td className="px-2 py-0.5 text-right text-gray-400">{fmt1(b.diffNext)}</td>
                    <td className="px-2 py-0.5 text-right text-gray-500">{b.threshold}</td>
                    <td className={`px-3 py-0.5 ${resultCls}`}>{resultText}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-3 py-1.5 text-[9px] text-gray-600 italic border-t border-gray-800/50">
            Méthode 1/3 d'octave — Section 3.7.4 et Tableau 2. Une bande est tonale si elle dépasse
            ses deux voisines d'au moins le seuil. Exception : bande masquée (LAeq global − LAeq bande ≥ 15 dB).
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Références réglementaires — section repliable, liens intelligents
// ────────────────────────────────────────────────────────────────────────────

interface ReferenceEntry {
  label: string
  /** Chaîne de recherche dans le titre des documents stockés (insensible à la casse) */
  matchTitle: RegExp
  /** URL de repli si aucun document local ne correspond */
  fallbackUrl: string
}

const REFERENCES: ReferenceEntry[] = [
  {
    label: 'MELCCFP 2026 — Section 2.2 — Détermination du critère',
    matchTitle: /lignes\s*directrices|melccfp/i,
    fallbackUrl:
      'https://www.environnement.gouv.qc.ca/publications/notes-instructions/98-01/lignes-directrices-bruit-2026.pdf',
  },
  {
    label: 'MELCCFP 2026 — Tableau 1 — Niveaux maximaux LAr,1h',
    matchTitle: /lignes\s*directrices|melccfp/i,
    fallbackUrl:
      'https://www.environnement.gouv.qc.ca/publications/notes-instructions/98-01/lignes-directrices-bruit-2026.pdf',
  },
  {
    label: 'ISO 1996-2 — Extraction du bruit particulier',
    matchTitle: /iso\s*1996/i,
    fallbackUrl: 'https://www.iso.org/standard/76324.html',
  },
]

function ReferencesSection() {
  const [open, setOpen] = useState(false)
  const docs = useMemo(() => loadRegulationDocs(), [open])

  function resolveLink(entry: ReferenceEntry): { url: string; localTitle?: string } {
    const found = docs.find((d) => entry.matchTitle.test(d.title))
    if (found && found.lienOfficiel) return { url: found.lienOfficiel, localTitle: found.title }
    if (found) {
      // Document local sans lien : pointer vers la première source officielle
      return { url: OFFICIAL_SOURCES[0].url, localTitle: found.title }
    }
    return { url: entry.fallbackUrl }
  }

  return (
    <section className="border border-gray-800 rounded-lg bg-gray-900/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left
                   hover:bg-gray-800/50 transition-colors"
      >
        <BookOpen size={12} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Références
        </span>
        <ChevronRight
          size={11}
          className={`text-gray-600 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          {REFERENCES.map((entry, i) => {
            const { url, localTitle } = resolveLink(entry)
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] px-2 py-1 rounded
                           text-gray-300 hover:text-emerald-300 hover:bg-gray-800/50 transition-colors"
              >
                <ExternalLink size={10} className="text-gray-600 shrink-0" />
                <span className="flex-1">{entry.label}</span>
                {localTitle && (
                  <span className="text-[9px] text-emerald-600">
                    · doc local : {localTitle}
                  </span>
                )}
              </a>
            )
          })}
          <p className="text-[9px] text-gray-600 italic mt-2 px-2">
            Importez les PDF officiels dans l'onglet « Réglementation » pour activer la
            recherche plein-texte sur ces documents.
          </p>
        </div>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Cellule "K" : affiche la valeur auto, permet une surcharge manuelle
// ────────────────────────────────────────────────────────────────────────────

interface KCorrInputProps {
  value: number
  auto: boolean
  onChange: (v: number | null) => void
  onClearOverride: () => void
  hasOverride: boolean
}

function KCorrInput({
  value,
  auto,
  onChange,
  onClearOverride,
  hasOverride,
}: KCorrInputProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>(String(value))

  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-center">
        <input
          type="number"
          step="0.1"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = parseFloat(draft.replace(',', '.'))
            onChange(Number.isNaN(n) ? null : n)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-12 text-xs bg-gray-800 text-gray-200 border border-emerald-700
                     rounded px-1 py-0.5"
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 justify-center">
      <button
        type="button"
        onClick={() => {
          setDraft(value.toFixed(1))
          setEditing(true)
        }}
        className={`tabular-nums ${
          hasOverride ? 'text-amber-300' : 'text-gray-400'
        } hover:text-white`}
        title={
          hasOverride
            ? 'Valeur manuelle — clic pour modifier'
            : auto
            ? 'Valeur automatique — clic pour surcharger'
            : 'Clic pour saisir manuellement'
        }
      >
        {value.toFixed(1)}
      </button>
      {auto && !hasOverride && <span className="text-emerald-600">·</span>}
      {hasOverride && (
        <button
          type="button"
          onClick={onClearOverride}
          className="text-[9px] text-gray-600 hover:text-gray-300"
          title="Réinitialiser à la valeur automatique"
        >
          ↺
        </button>
      )}
    </div>
  )
}
