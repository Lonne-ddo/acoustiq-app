/**
 * Panneau des indices acoustiques réglementaires
 * LAeq, L10, L50, L90, LAFmax, LAFmin — un tableau par point de mesure
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { Download, TrendingDown, ChevronRight, Sun, X } from 'lucide-react'
import HelpTooltip from './HelpTooltip'
import type { MeasurementFile, MeteoData, Period, Category } from '../types'
import {
  laeqAvg,
  computeLn,
  computeLnSeries,
  computeL10,
  computeL50,
  computeL90,
  computeLAFmax,
  computeLAFmin,
  detectKt,
  computeLaftm5,
  computeKi9801,
  computeKb9801,
  analyzeKt9801,
  leqOnRegPeriod,
  REG_PERIODS,
  type RegPeriodLeq,
  leqByClockHour,
  dayEnergyDistribution,
  filterDataByPeriods,
} from '../utils/acoustics'
import {
  classifyCorr9801,
  corr9801CauseMessage,
  type Corr9801Term,
  type Corr9801Cause,
  type Corr9801Facts,
} from '../utils/corr9801'

const PERIODS_HELP =
  'Leq par période réglementaire (moyenne énergétique). Bornes communes à la ' +
  'Note 98-01 (EQ-09) et aux Lignes directrices MELCCFP 2026 :\n' +
  '• Jour : 07h00 – 19h00\n' +
  '• Soir : 19h00 – 22h00\n' +
  '• Nuit : 22h00 – 07h00 (passage minuit inclus)\n\n' +
  'Le % indique la couverture temporelle de l’intervalle par la mesure ' +
  '(ambre si < 95 % = période partielle).'

// Palette partagée avec le graphique
const POINT_COLORS: Record<string, string> = {
  'BV-94':  '#10b981',
  'BV-98':  '#3b82f6',
  'BV-105': '#f59e0b',
  'BV-106': '#ef4444',
  'BV-37':  '#8b5cf6',
  'BV-107': '#06b6d4',
}
const FALLBACK_COLORS = ['#ec4899', '#84cc16', '#f97316', '#a78bfa']
function ptColor(pt: string, i: number) {
  return POINT_COLORS[pt] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

// Définition des lignes d'indices avec descriptions
const ROWS = [
  { key: 'laeq',   label: 'LAeq',   unit: 'dB(A)', help: 'Niveau sonore continu équivalent pondéré A — moyenne énergétique sur la période.' },
  { key: 'l1',     label: 'L1',     unit: 'dB(A)', help: 'Niveau dépassé 1% du temps — pointes les plus rares (événements brefs).' },
  { key: 'l10',    label: 'L10',    unit: 'dB(A)', help: 'Niveau dépassé 10% du temps — caractérise les niveaux de pointe récurrents.' },
  { key: 'l50',    label: 'L50',    unit: 'dB(A)', help: 'Niveau dépassé 50% du temps — médiane, représente le bruit « typique ».' },
  { key: 'l90',    label: 'L90',    unit: 'dB(A)', help: 'Niveau dépassé 90% du temps — bruit résiduel (bruit de fond).' },
  { key: 'l95',    label: 'L95',    unit: 'dB(A)', help: 'Niveau dépassé 95% du temps — bruit de fond bas.' },
  { key: 'l99',    label: 'L99',    unit: 'dB(A)', help: 'Niveau dépassé 99% du temps — plancher de bruit résiduel.' },
  { key: 'lafmax', label: 'LAFmax', unit: 'dB(A)', help: 'Niveau maximal instantané pondéré A, constante Fast.' },
  { key: 'lafmin', label: 'LAFmin', unit: 'dB(A)', help: 'Niveau minimal instantané pondéré A, constante Fast.' },
] as const

type IndexKey = (typeof ROWS)[number]['key']

interface IndexValues {
  laeq: number
  l1: number
  l10: number
  l50: number
  l90: number
  l95: number
  l99: number
  lafmax: number
  lafmin: number
}

/** Convertit HH:MM en minutes depuis minuit */
function hhmmToMin(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':')
  return parseInt(h, 10) * 60 + parseInt(m, 10)
}

function fmt(n: number): string {
  return n.toFixed(1)
}

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  /** Conditions météo saisies (incluses dans l'export Excel) */
  meteo?: MeteoData
  /** Pas d'agrégation en secondes pour l'export "Données brutes" (par défaut 300) */
  aggregationSeconds?: number
  /** Périodes nommées — filtre les données avant calcul des indices */
  periods?: Period[]
  /** Catégories de périodes (déterminent quelles périodes sont incluses) */
  categories?: Category[]
}

export default function IndicesPanel({ files, pointMap, selectedDate, meteo, aggregationSeconds = 300, periods, categories }: Props) {
  const [mode, setMode] = useState<'full' | 'custom'>('full')
  const [startTime, setStartTime] = useState('00:00')
  const [endTime, setEndTime] = useState('23:59')

  // Exclusion AD-HOC « à la volée » : catégories retirées du calcul des indices,
  // transitoire et local au panneau (ne touche ni la config des catégories ni
  // les autres onglets). Set vide ⇒ comportement par défaut strictement inchangé.
  const [excludedCatIds, setExcludedCatIds] = useState<Set<string>>(new Set())
  const toggleExcluded = (id: string) =>
    setExcludedCatIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const catName = (id: string) => (categories ?? []).find((c) => c.id === id)?.name ?? id
  // Catégories proposables à l'exclusion : celles ayant ≥ 1 période assignée.
  const excludableCats = useMemo(() => {
    const withPeriods = new Set((periods ?? []).map((p) => p.categoryId))
    return (categories ?? []).filter((c) => withPeriods.has(c.id))
  }, [categories, periods])

  // Points actifs pour la journée sélectionnée
  const pointNames = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id] && f.date === selectedDate) pts.add(pointMap[f.id])
    }
    return [...pts].sort()
  }, [files, pointMap, selectedDate])

  // Leq par période réglementaire (jour/soir/nuit) + couverture, par point —
  // sur la même fenêtre filtrée que les autres indices. Bornes 98-01 / 2026.
  const periodsByPoint = useMemo(() => {
    return Object.fromEntries(
      pointNames.map((pt) => {
        const data = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories, { excludeCategoryIds: excludedCatIds }))
        return [
          pt,
          {
            ljour: leqOnRegPeriod(data, REG_PERIODS.jour.startH, REG_PERIODS.jour.endH),
            lsoir: leqOnRegPeriod(data, REG_PERIODS.soir.startH, REG_PERIODS.soir.endH),
            lnuit: leqOnRegPeriod(data, REG_PERIODS.nuit.startH, REG_PERIODS.nuit.endH),
          },
        ]
      }),
    ) as Record<string, { ljour: RegPeriodLeq; lsoir: RegPeriodLeq; lnuit: RegPeriodLeq }>
  }, [files, pointMap, selectedDate, pointNames, periods, categories, excludedCatIds])

  // Caractéristiques du bruit (composante tonale par point) — basées sur la
  // moyenne énergétique des spectres 1/3 d'octave sur la plage sélectionnée.
  const tonalByPoint = useMemo(() => {
    const startMin = mode === 'custom' ? hhmmToMin(startTime) : -Infinity
    const endMin = mode === 'custom' ? hhmmToMin(endTime) : Infinity
    return Object.fromEntries(
      pointNames.map((pt) => {
        const dps = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories, { excludeCategoryIds: excludedCatIds }))
          .filter((dp) => dp.t >= startMin && dp.t <= endMin)
        const specs = dps.map((d) => d.spectra).filter((s): s is number[] => !!s)
        if (specs.length === 0) return [pt, null]
        const nBands = specs[0].length
        const avgSpec = new Array(nBands).fill(0).map((_, i) => {
          const vals = specs.map((s) => s[i]).filter((v) => typeof v === 'number')
          return laeqAvg(vals)
        })
        const laeqA = laeqAvg(dps.map((d) => d.laeq))
        return [pt, detectKt(avgSpec, laeqA)]
      }),
    ) as Record<string, ReturnType<typeof detectKt> | null>
  }, [files, pointMap, selectedDate, pointNames, mode, startTime, endTime, periods, categories, excludedCatIds])

  // Correctifs Note 98-01 (Kt / Ki / Kb) par point — cadre DISTINCT du 2026,
  // calculés sur la même fenêtre filtrée que les autres indices. Chaque terme
  // peut être null = « indisponible » (donnée source absente) plutôt qu'un
  // chiffre faux : Ki sans LAFmax, Kb sans LCeq, Kt sans spectre.
  const corr9801ByPoint = useMemo(() => {
    const startMin = mode === 'custom' ? hhmmToMin(startTime) : -Infinity
    const endMin = mode === 'custom' ? hhmmToMin(endTime) : Infinity
    return Object.fromEntries(
      pointNames.map((pt) => {
        const dps = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories, { excludeCategoryIds: excludedCatIds }))
          .filter((dp) => dp.t >= startMin && dp.t <= endMin)
        const hasData = dps.length > 0
        const laeqWin = hasData ? laeqAvg(dps.map((d) => d.laeq)) : 0

        // Kb = LCeq − LAeq (énergétiques). null si aucun LCeq parsé.
        const lceqVals = dps.map((d) => d.lceq).filter((v): v is number => typeof v === 'number')
        const hasLceq = lceqVals.length > 0
        const lceq = hasLceq ? laeqAvg(lceqVals) : null
        const kbVal = hasLceq ? computeKb9801(lceq, laeqWin) : null

        // Ki = LAFTM5 − LAeq. null si aucun LAFmax 1 s parsé (ou LAFTM5 null).
        const lafVals = dps.map((d) => d.lafmax).filter((v): v is number => typeof v === 'number')
        const hasLafmax = lafVals.length > 0
        const laftm5 = hasLafmax ? computeLaftm5(lafVals) : null
        const kiVal = hasLafmax ? computeKi9801(laftm5, laeqWin) : null

        // Kt 98-01 sur le spectre moyen énergétique par bande. null si pas de spectre.
        const specs = dps.map((d) => d.spectra).filter((s): s is number[] => !!s)
        const hasSpectrum = specs.length > 0
        let ktVal: number | null = null
        if (hasSpectrum) {
          const nBands = specs[0].length
          const avgSpec = new Array(nBands).fill(0).map((_, i) =>
            laeqAvg(specs.map((s) => s[i]).filter((v) => typeof v === 'number')),
          )
          ktVal = analyzeKt9801(avgSpec, laeqWin).kt
        }

        // Cause DIFFÉRENCIÉE (pure) quand un terme est indisponible.
        const facts: Corr9801Facts = {
          hasData,
          hasLceq,
          hasLafmax,
          laftm5IsNull: laftm5 === null,
          hasSpectrum,
        }
        const causeOf = (term: Corr9801Term, val: number | null): Corr9801Cause | null =>
          val === null ? classifyCorr9801(term, facts) : null

        return [
          pt,
          {
            kt: { value: ktVal, cause: causeOf('kt', ktVal) },
            ki: { value: kiVal, cause: causeOf('ki', kiVal) },
            kb: { value: kbVal, cause: causeOf('kb', kbVal) },
          },
        ]
      }),
    ) as Record<string, Record<Corr9801Term, { value: number | null; cause: Corr9801Cause | null }>>
  }, [files, pointMap, selectedDate, pointNames, mode, startTime, endTime, periods, categories, excludedCatIds])

  // Calcul des indices par point
  const indicesByPoint = useMemo((): Record<string, IndexValues | null> => {
    const startMin = mode === 'custom' ? hhmmToMin(startTime) : -Infinity
    const endMin = mode === 'custom' ? hhmmToMin(endTime) : Infinity

    return Object.fromEntries(
      pointNames.map((pt) => {
        const values = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories, { excludeCategoryIds: excludedCatIds }))
          .filter((dp) => dp.t >= startMin && dp.t <= endMin)
          .map((dp) => dp.laeq)

        if (values.length === 0) return [pt, null]

        return [
          pt,
          {
            laeq:   laeqAvg(values),
            l1:     computeLn(values, 1),
            l10:    computeL10(values),
            l50:    computeL50(values),
            l90:    computeL90(values),
            l95:    computeLn(values, 95),
            l99:    computeLn(values, 99),
            lafmax: computeLAFmax(values),
            lafmin: computeLAFmin(values),
          } satisfies IndexValues,
        ]
      }),
    )
  }, [files, pointMap, selectedDate, mode, startTime, endTime, pointNames, periods, categories, excludedCatIds])

  // Réf stable pour `handleExportExcel` afin que l'écouteur global puisse
  // l'appeler sans dépendances (le composant peut être re-rendu plusieurs fois).
  const exportRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onExport = () => exportRef.current()
    document.addEventListener('acoustiq:export-indices', onExport)
    document.addEventListener('acoustiq:export-raw-data', onExport)
    return () => {
      document.removeEventListener('acoustiq:export-indices', onExport)
      document.removeEventListener('acoustiq:export-raw-data', onExport)
    }
  }, [])

  // Export Excel : 3 feuilles distinctes (Indices / Périodes / Données brutes)
  function handleExportExcel() {
    try {
      const wb = XLSX.utils.book_new()
      const round1 = (n: number) => Math.round(n * 10) / 10
      const timeRangeLabel =
        mode === 'custom' ? `${startTime} → ${endTime}` : 'Pleine journée (00:00 → 23:59)'

      // ── Feuille 1 : Indices ───────────────────────────────────────────────
      const sheet1: Array<Array<string | number>> = []
      sheet1.push(['AcoustiQ — Indices acoustiques'])
      sheet1.push([`Date : ${selectedDate}`])
      sheet1.push([`Plage horaire : ${timeRangeLabel}`])
      if (excludedCatIds.size > 0) {
        sheet1.push([`Exclusion à la volée (catégories retirées du calcul) : ${[...excludedCatIds].map(catName).join(', ')}`])
      }
      if (meteo) {
        const meteoBits: string[] = []
        if (meteo.windSpeed !== null) {
          const validity = meteo.windSpeed < 20 ? '✓ Valide' : '✗ Invalide (≥ 20 km/h)'
          meteoBits.push(`Vent ${meteo.windSpeed} km/h ${meteo.windDirection ?? ''} — ${validity}`.replace(/\s+/g, ' ').trim())
        }
        if (meteo.temperature !== null) meteoBits.push(`${meteo.temperature} °C`)
        if (meteo.conditions) meteoBits.push(meteo.conditions)
        if (meteo.note) meteoBits.push(meteo.note)
        if (meteoBits.length > 0) sheet1.push([`Météo : ${meteoBits.join(' · ')}`])
      }
      sheet1.push([])
      sheet1.push(['Indice', ...pointNames])
      for (const row of ROWS) {
        const line: Array<string | number> = [row.label]
        for (const pt of pointNames) {
          const vals = indicesByPoint[pt]
          line.push(vals ? round1(vals[row.key as IndexKey] as number) : '')
        }
        sheet1.push(line)
      }
      sheet1.push([])
      sheet1.push(['Généré par AcoustiQ — https://acoustiq-app.pages.dev'])
      const wsIndices = XLSX.utils.aoa_to_sheet(sheet1)
      XLSX.utils.book_append_sheet(wb, wsIndices, 'Indices')

      // ── Feuille 2 : Périodes réglementaires (Leq + couverture) ────────────
      const PERIOD_LABEL = { ljour: 'Ljour (07h–19h)', lsoir: 'Lsoir (19h–22h)', lnuit: 'Lnuit (22h–07h)' } as const
      const sheet2: Array<Array<string | number>> = []
      sheet2.push(['AcoustiQ — Périodes réglementaires (bornes communes Note 98-01 / MELCCFP 2026)'])
      sheet2.push([`Date : ${selectedDate}`])
      sheet2.push([])
      sheet2.push(['Leq par période — dB(A)', ...pointNames])
      for (const k of ['ljour', 'lsoir', 'lnuit'] as const) {
        const line: Array<string | number> = [PERIOD_LABEL[k]]
        for (const pt of pointNames) {
          const leq = periodsByPoint[pt]?.[k]?.leq
          line.push(leq !== null && leq !== undefined ? round1(leq) : '')
        }
        sheet2.push(line)
      }
      sheet2.push([])
      sheet2.push(['Couverture temporelle — min couvertes / min période (·%)', ...pointNames])
      for (const k of ['ljour', 'lsoir', 'lnuit'] as const) {
        const line: Array<string | number> = [PERIOD_LABEL[k]]
        for (const pt of pointNames) {
          const cell = periodsByPoint[pt]?.[k]
          if (!cell) { line.push(''); continue }
          const pct = cell.periodMin > 0 ? Math.round(Math.min(1, cell.coveredMin / cell.periodMin) * 100) : 0
          line.push(`${cell.coveredMin}/${cell.periodMin} (${pct}%)`)
        }
        sheet2.push(line)
      }

      // Répartition journée + Leq24h (EQ-09 « Repartition-journée »).
      const dayByPt = Object.fromEntries(
        pointNames.map((pt) => {
          const data = files
            .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
            .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories, { excludeCategoryIds: excludedCatIds }))
          const hourly = leqByClockHour(data)
          return [pt, { hourly, dist: dayEnergyDistribution(hourly) }]
        }),
      ) as Record<string, { hourly: ReturnType<typeof leqByClockHour>; dist: ReturnType<typeof dayEnergyDistribution> }>
      sheet2.push([])
      sheet2.push(['Leq24h — dB(A) (24 h d’horloge présentes requis)', ...pointNames])
      sheet2.push(['Leq24h', ...pointNames.map((pt) => {
        const d = dayByPt[pt].dist
        return d.leq24h !== null ? round1(d.leq24h) : `indispo. (${d.hoursPresent}/24 h)`
      })])
      sheet2.push(['Couverture 24 h', ...pointNames.map((pt) => {
        const d = dayByPt[pt].dist
        return `${d.coveredMin}/1440 (${Math.round(Math.min(1, d.coveredMin / 1440) * 100)}%)`
      })])
      sheet2.push([])
      sheet2.push(['Répartition horaire — Leq1h dB(A) (part %)', ...pointNames])
      for (let h = 0; h < 24; h++) {
        const line: Array<string | number> = [`${String(h).padStart(2, '0')}h`]
        for (const pt of pointNames) {
          const { hourly, dist } = dayByPt[pt]
          const leq = hourly[h].leq
          const part = dist.parts[h]
          line.push(leq !== null ? `${round1(leq)} (${part !== null ? (part * 100).toFixed(1) : '—'}%)` : '')
        }
        sheet2.push(line)
      }

      sheet2.push([])
      sheet2.push(['Généré par AcoustiQ — https://acoustiq-app.pages.dev'])
      const wsPeriodes = XLSX.utils.aoa_to_sheet(sheet2)
      XLSX.utils.book_append_sheet(wb, wsPeriodes, 'Périodes')

      // ── Feuille 3 : Données brutes (au pas d'agrégation sélectionné) ──────
      // Bucket par aggregationSeconds, moyenne énergétique par bucket par point
      const aggSec = aggregationSeconds
      type Bucket = Map<string, number[]>
      const bucketsByT = new Map<number, Bucket>() // bucket en secondes → point → laeq[]
      for (const pt of pointNames) {
        const ptFiles = files.filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
        for (const f of ptFiles) {
          for (const dp of f.data) {
            const tSec = Math.round(dp.t * 60)
            const bSec = Math.floor(tSec / aggSec) * aggSec
            let b = bucketsByT.get(bSec)
            if (!b) { b = new Map(); bucketsByT.set(bSec, b) }
            const arr = b.get(pt) ?? []
            arr.push(dp.laeq)
            b.set(pt, arr)
          }
        }
      }
      const sortedBuckets = [...bucketsByT.keys()].sort((a, b) => a - b)
      const sheet3: Array<Array<string | number>> = []
      sheet3.push([
        `AcoustiQ — Données brutes (agrégation ${aggSec < 60 ? aggSec + ' s' : Math.round(aggSec / 60) + ' min'})`,
      ])
      sheet3.push([`Date : ${selectedDate}`])
      sheet3.push([])
      sheet3.push(['Heure', ...pointNames.map((pt) => `LAeq ${pt} (dB)`)])
      for (const bSec of sortedBuckets) {
        const h = Math.floor(bSec / 3600) % 24
        const m = Math.floor((bSec % 3600) / 60)
        const s = bSec % 60
        const heure =
          aggSec < 60
            ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        const line: Array<string | number> = [heure]
        const b = bucketsByT.get(bSec)!
        for (const pt of pointNames) {
          const arr = b.get(pt)
          line.push(arr && arr.length > 0 ? round1(laeqAvg(arr)) : '')
        }
        sheet3.push(line)
      }
      const wsRaw = XLSX.utils.aoa_to_sheet(sheet3)
      XLSX.utils.book_append_sheet(wb, wsRaw, 'Données brutes')

      XLSX.writeFile(wb, `acoustiq_indices_${selectedDate}.xlsx`)
    } catch (err) {
      console.error('Export Excel échoué :', err)
      alert('Export Excel échoué — voir la console pour les détails.')
    }
  }
  // Garde la ref synchrone à la dernière version du handler.
  exportRef.current = handleExportExcel

  // Durée totale mesurée sur la journée sélectionnée (tous points confondus).
  const fileSpanMin = useMemo(() => {
    let mn = Infinity, mx = -Infinity
    for (const f of files) {
      if (!pointMap[f.id] || f.date !== selectedDate) continue
      for (const dp of f.data) { if (dp.t < mn) mn = dp.t; if (dp.t > mx) mx = dp.t }
    }
    return Number.isFinite(mn) && mx >= mn ? mx - mn : 0
  }, [files, pointMap, selectedDate])

  const fmtHm = (minutes: number) => {
    const h = Math.floor(minutes / 60), m = Math.round(minutes % 60)
    return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m}min`
  }

  // Bandeau « calcul sur » : catégories visibles qui DÉFINISSENT la fenêtre
  // (include + reference, qui se comportent en whitelist) avec périodes.
  const calcLabel = (() => {
    const totalStr = fileSpanMin > 0 ? ` (${fmtHm(fileSpanMin)})` : ''
    const cats = categories ?? []
    const active = cats.filter((c) => c.visible && (c.mode === 'include' || c.mode === 'reference'))
    const activeIds = new Set(active.map((c) => c.id))
    const used = (periods ?? []).filter((p) => activeIds.has(p.categoryId))
    if (used.length === 0) return `Calcul sur l'ensemble du fichier${totalStr}`
    const names = active.filter((c) => used.some((p) => p.categoryId === c.id))
    const usedMin = used.reduce((s, p) => s + Math.max(0, (p.endMs - p.startMs) / 60_000), 0)
    return `Calcul sur ${names.length} catégorie${names.length > 1 ? 's' : ''} active${names.length > 1 ? 's' : ''} (${names.map((c) => c.name).join(', ')}) — ${used.length} période${used.length > 1 ? 's' : ''} / ${fmtHm(usedMin)}${fileSpanMin > 0 ? ` sur ${fmtHm(fileSpanMin)} total` : ''}`
  })()

  if (pointNames.length === 0) return null

  return (
    <div className="border-t border-gray-800 bg-gray-900 shrink-0">
      {/* Barre de contrôle */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Indices acoustiques
        </span>
        <span className="text-[10px] text-gray-500 italic" title="Filtrage actif des indices selon les catégories de périodes">
          {calcLabel}
        </span>

        {/* Exclusion « à la volée » : retire une/des catégorie(s) du calcul,
            transitoire et local au panneau. Aucune sélection ⇒ défauts inchangés. */}
        {excludableCats.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">Exclure :</span>
            {excludableCats.map((c) => {
              const on = excludedCatIds.has(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => toggleExcluded(c.id)}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    on
                      ? 'bg-rose-900/50 border-rose-600 text-rose-200'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                  title={on
                    ? `Catégorie « ${c.name} » exclue du calcul — cliquer pour la réintégrer`
                    : `Exclure « ${c.name} » du calcul des indices`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.name}
                  {on && <X size={9} />}
                </button>
              )
            })}
            {excludedCatIds.size > 0 && (
              <button
                onClick={() => setExcludedCatIds(new Set())}
                className="text-[10px] text-gray-500 hover:text-gray-300 underline ml-1"
              >
                réinitialiser
              </button>
            )}
          </div>
        )}

        <button
          onClick={handleExportExcel}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                     border border-gray-600 transition-colors ml-auto"
          title="Exporter les indices en Excel"
        >
          <Download size={12} />
          Exporter Excel
        </button>

        <div className="flex items-center gap-1">
          {/* Boutons de mode */}
          <button
            onClick={() => setMode('full')}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              mode === 'full'
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Pleine journée
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              mode === 'custom'
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Personnalisé
          </button>

          {/* Sélecteurs horaires */}
          {mode === 'custom' && (
            <div className="flex items-center gap-1 ml-2">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-1.5 py-0.5
                           focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <span className="text-gray-500 text-xs">→</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-1.5 py-0.5
                           focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Bandeau récapitulatif de l'exclusion à la volée */}
      {excludedCatIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-1 text-[11px] text-rose-200 bg-rose-950/30 border-b border-rose-900/40">
          <X size={11} className="text-rose-400 shrink-0" />
          <span>
            Indices calculés <span className="font-semibold">en excluant</span> :{' '}
            {[...excludedCatIds].map(catName).join(', ')}
          </span>
          <button
            onClick={() => setExcludedCatIds(new Set())}
            className="ml-auto text-rose-300 hover:text-rose-100 underline"
          >
            réinitialiser
          </button>
        </div>
      )}

      {/* Tableau des indices */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-2 text-gray-500 font-medium w-24">Indice</th>
              {pointNames.map((pt, i) => (
                <th
                  key={pt}
                  className="px-4 py-2 font-semibold text-center"
                  style={{ color: ptColor(pt, i) }}
                >
                  {pt}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, ri) => (
              <tr
                key={row.key}
                className={ri % 2 === 0 ? 'bg-gray-900' : 'bg-gray-850'}
              >
                <td className="px-4 py-1.5 text-gray-400 font-medium">
                  <span className="inline-flex items-center gap-1">
                    {row.label}
                    <HelpTooltip text={row.help} position="right" />
                  </span>
                </td>
                {pointNames.map((pt) => {
                  const vals = indicesByPoint[pt]
                  const v = vals ? (vals[row.key as IndexKey] as number) : null
                  return (
                    <td key={pt} className="px-4 py-1.5 text-center tabular-nums text-gray-200">
                      {v !== null ? (
                        <>
                          {fmt(v)}
                          <span className="text-gray-600 ml-0.5">{row.unit}</span>
                        </>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {/* Caractéristiques du bruit (composante tonale) */}
            <tr className="bg-gray-900 border-t border-gray-800/70">
              <td className="px-4 py-1.5 text-gray-400 font-medium">
                <span className="inline-flex items-center gap-1">
                  Tonal
                  <HelpTooltip
                    text="Détection automatique de composante tonale selon Tableau 2 MELCCFP 2026 (1/3 d'octave). Émergence = excès au-dessus des bandes adjacentes."
                    position="right"
                  />
                </span>
              </td>
              {pointNames.map((pt) => {
                const det = tonalByPoint[pt]
                if (!det) {
                  return (
                    <td key={pt} className="px-4 py-1.5 text-center text-gray-700">—</td>
                  )
                }
                if (!det.detected) {
                  return (
                    <td key={pt} className="px-4 py-1.5 text-center text-emerald-400 text-[11px]">
                      Non
                    </td>
                  )
                }
                return (
                  <td
                    key={pt}
                    className="px-4 py-1.5 text-center text-orange-400 text-[11px] tabular-nums"
                    title={`Composante tonale à ${det.fc} Hz · émergence ${det.emergence?.toFixed(1)} dB (seuil ${det.threshold} dB)`}
                  >
                    Oui · {det.fc} Hz · +{det.emergence?.toFixed(1)} dB
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Correctifs Note 98-01 (Kt / Ki / Kb) — sous-section DISTINCTE du
          cadre MELCCFP 2026. Termes affichés séparément (pas de niveau combiné). */}
      <div className="border-t border-gray-800">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Correctifs 98-01
          </span>
          <HelpTooltip
            text="Termes correctifs de la Note d'instruction 98-01 (formulaire EQ-09). Kt tonal (seuils 15/8/5 dB ; significatif si écart global−bande ≤ 14,5 dB). Ki = LAFTM5 − LAeq (LAFTM5 = moyenne énergétique du max glissant 5 s du LAFmax 1 s ; appliqué si > 2 dB). Kb = LCeq − LAeq (signalé si ≥ 20 dB). Cadre distinct des Lignes directrices MELCCFP 2026."
            position="right"
          />
        </div>
        <div className="overflow-x-auto px-4 pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/60">
                <th className="text-left px-2 py-1 text-gray-500 font-medium w-32">Terme</th>
                {pointNames.map((pt, i) => (
                  <th key={pt} className="px-2 py-1 font-semibold text-center" style={{ color: ptColor(pt, i) }}>
                    {pt}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                { key: 'kt', label: 'Kt — tonal' },
                { key: 'ki', label: 'Ki — impulsif' },
                { key: 'kb', label: 'Kb — basses fréq.' },
              ] as const).map((row, ri) => (
                <tr key={row.key} className={ri % 2 === 0 ? 'bg-gray-900' : 'bg-gray-850'}>
                  <td className="px-2 py-1 text-gray-400 font-medium">{row.label}</td>
                  {pointNames.map((pt) => {
                    const term = corr9801ByPoint[pt]?.[row.key]
                    const v = term?.value ?? null
                    if (v === null || v === undefined) {
                      // Cause DIFFÉRENCIÉE (plus de libellé générique unique).
                      const cause = term?.cause ?? 'unknown'
                      return (
                        <td
                          key={pt}
                          className="px-2 py-1 text-center text-gray-700"
                          title={corr9801CauseMessage(row.key, cause)}
                        >
                          indispo.
                        </td>
                      )
                    }
                    const applied = v > 0
                    return (
                      <td
                        key={pt}
                        className={`px-2 py-1 text-center tabular-nums ${applied ? 'text-orange-400' : 'text-gray-300'}`}
                      >
                        {v.toFixed(1)} dB
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Périodes réglementaires — Ljour / Lsoir / Lnuit (bornes 98-01 / 2026) */}
      <div className="border-t border-gray-800">
        <div className="flex items-center gap-2 px-4 py-2">
          <Sun size={12} className="text-amber-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Périodes réglementaires
          </span>
          <HelpTooltip text={PERIODS_HELP} position="right" />
        </div>
        <div className="overflow-x-auto pb-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800/60">
                <th className="text-left px-4 py-1 text-gray-500 font-medium w-32">Période</th>
                {pointNames.map((pt, i) => (
                  <th key={pt} className="px-4 py-1 font-semibold text-center" style={{ color: ptColor(pt, i) }}>
                    {pt}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                { key: 'ljour', label: 'Ljour', range: '07h – 19h' },
                { key: 'lsoir', label: 'Lsoir', range: '19h – 22h' },
                { key: 'lnuit', label: 'Lnuit', range: '22h – 07h' },
              ] as const).map((row, ri) => (
                <tr
                  key={row.key}
                  className={ri % 2 === 0 ? 'bg-gray-900' : 'bg-gray-850'}
                >
                  <td className="px-4 py-1 text-gray-400 font-medium">
                    <span className="font-semibold text-gray-300">{row.label}</span>
                    <span className="ml-1.5 text-[10px] text-gray-600">{row.range}</span>
                  </td>
                  {pointNames.map((pt) => {
                    const cell = periodsByPoint[pt]?.[row.key]
                    const leq = cell?.leq ?? null
                    const hasData = leq !== null && leq !== undefined
                    const coverage = cell && cell.periodMin > 0
                      ? Math.min(1, cell.coveredMin / cell.periodMin)
                      : 0
                    const pct = Math.round(coverage * 100)
                    const partial = coverage < 0.95 // ambre uniquement si < 95 %
                    return (
                      <td
                        key={pt}
                        className={`px-4 py-1 text-center tabular-nums ${
                          hasData ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        {hasData ? (
                          <>
                            {fmt(leq)}
                            <span className="text-gray-600 ml-0.5">dB(A)</span>
                            <span
                              className={`ml-1 text-[10px] ${partial ? 'text-amber-400' : 'text-gray-600'}`}
                              title={`Couverture temporelle : ${cell!.coveredMin} / ${cell!.periodMin} min`}
                            >
                              · {pct}%
                            </span>
                          </>
                        ) : (
                          '−'
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Répartition journée + Leq24h (sous-bloc des périodes réglementaires) */}
      <DayDistributionSection
        files={files}
        pointMap={pointMap}
        selectedDate={selectedDate}
        pointNames={pointNames}
        periods={periods}
        categories={categories}
        excludedCatIds={excludedCatIds}
      />

      {/* Distribution L1..L99 par point */}
      <DistributionSection
        files={files}
        pointMap={pointMap}
        selectedDate={selectedDate}
        pointNames={pointNames}
        startMin={mode === 'custom' ? hhmmToMin(startTime) : -Infinity}
        endMin={mode === 'custom' ? hhmmToMin(endTime) : Infinity}
        periods={periods}
        categories={categories}
        excludedCatIds={excludedCatIds}
      />

      {/* Analyse bruit de fond (L90 horaire) */}
      <AmbientNoiseSection files={files} pointMap={pointMap} selectedDate={selectedDate} pointNames={pointNames} periods={periods} categories={categories} excludedCatIds={excludedCatIds} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// DistributionSection — histogramme L1..L99 compact, un mini graphique par point
// ────────────────────────────────────────────────────────────────────────────

function DistributionSection({
  files, pointMap, selectedDate, pointNames, startMin, endMin, periods, categories, excludedCatIds,
}: {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  pointNames: string[]
  startMin: number
  endMin: number
  periods?: Period[]
  categories?: Category[]
  excludedCatIds: Set<string>
}) {
  const [showSection, setShowSection] = useState(true)

  // Calcul des percentiles L1..L99 par point
  const distributions = useMemo(() => {
    const LN_X = Array.from({ length: 99 }, (_, i) => i + 1) // L1..L99
    return pointNames.map((pt) => {
      const values = files
        .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
        .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories, { excludeCategoryIds: excludedCatIds }))
        .filter((dp) => dp.t >= startMin && dp.t <= endMin)
        .map((dp) => dp.laeq)
      if (values.length === 0) return { pt, percentiles: null as number[] | null, min: 0, max: 0 }
      // Source unique : computeLnSeries (= computeLn pour chaque x), un seul tri.
      const percentiles = computeLnSeries(values, LN_X)
      let min = Infinity, max = -Infinity
      for (const v of values) { if (v < min) min = v; if (v > max) max = v }
      return { pt, percentiles, min, max }
    })
  }, [files, pointMap, selectedDate, pointNames, startMin, endMin, periods, categories, excludedCatIds])

  if (pointNames.length === 0) return null

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={() => setShowSection(!showSection)}
        className="flex items-center gap-2 px-4 py-2 w-full text-left hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Distribution L1..L99
        </span>
        <ChevronRight size={12} className={`text-gray-600 transition-transform ${showSection ? 'rotate-90' : ''}`} />
      </button>

      {showSection && (
        <div className="px-4 pb-3 animate-[fadeIn_0.15s_ease-out]">
          <div className="flex gap-3 overflow-x-auto">
            {distributions.map(({ pt, percentiles, min, max }, i) => {
              const color = ptColor(pt, i)
              if (!percentiles) {
                return (
                  <div key={pt} className="text-xs text-gray-600 px-2">
                    {pt} — aucune donnée
                  </div>
                )
              }
              return (
                <DistributionMini
                  key={pt}
                  pointName={pt}
                  color={color}
                  percentiles={percentiles}
                  minDb={min}
                  maxDb={max}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Mini graphique SVG : 99 barres horizontales L1..L99 + L10/L50/L90 mis en avant */
function DistributionMini({
  pointName, color, percentiles, minDb, maxDb,
}: {
  pointName: string
  color: string
  percentiles: number[]
  minDb: number
  maxDb: number
}) {
  const W = 200
  const H = 120
  const PAD_LEFT = 26
  const PAD_RIGHT = 4
  const PAD_TOP = 4
  const PAD_BOTTOM = 14
  const plotW = W - PAD_LEFT - PAD_RIGHT
  const plotH = H - PAD_TOP - PAD_BOTTOM
  // Marges d'arrondi sur l'échelle X
  const xLo = Math.floor(minDb - 1)
  const xHi = Math.ceil(maxDb + 1)
  const xRange = Math.max(1, xHi - xLo)
  const dbToPx = (db: number) => PAD_LEFT + ((db - xLo) / xRange) * plotW
  const x0 = dbToPx(xLo)
  const barH = plotH / percentiles.length

  // Indices L10, L50, L90 (Lx → percentiles[x-1])
  const HIGHLIGHT = [10, 50, 90]

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-semibold" style={{ color }}>{pointName}</span>
      </div>
      <svg width={W} height={H} className="block" style={{ background: '#0b1220', borderRadius: 4 }}>
        {/* Grille X (jalons tous les 10 dB) */}
        {Array.from({ length: Math.floor(xRange / 10) + 1 }, (_, i) => {
          const v = Math.ceil(xLo / 10) * 10 + i * 10
          if (v > xHi) return null
          const x = dbToPx(v)
          return (
            <g key={`grid-${v}`}>
              <line x1={x} x2={x} y1={PAD_TOP} y2={H - PAD_BOTTOM} stroke="#1f2937" strokeWidth={0.5} />
              <text x={x} y={H - 3} fontSize={8} fill="#6b7280" textAnchor="middle">{v}</text>
            </g>
          )
        })}

        {/* Barres L1..L99 */}
        {percentiles.map((db, idx) => {
          const x = idx + 1
          const y = PAD_TOP + idx * barH
          const w = Math.max(1, dbToPx(db) - x0)
          const isHi = HIGHLIGHT.includes(x)
          return (
            <rect
              key={x}
              x={x0}
              y={y}
              width={w}
              height={Math.max(0.6, barH - 0.1)}
              fill={isHi ? color : color}
              fillOpacity={isHi ? 1 : 0.45}
            />
          )
        })}

        {/* Étiquettes L10/L50/L90 */}
        {HIGHLIGHT.map((x) => {
          const v = percentiles[x - 1]
          const y = PAD_TOP + (x - 1) * barH + barH / 2
          return (
            <g key={`hl-${x}`}>
              <text x={PAD_LEFT - 3} y={y + 3} fontSize={8} fill={color} textAnchor="end" fontWeight="bold">
                L{x}
              </text>
              <text x={dbToPx(v) + 2} y={y + 3} fontSize={8} fill="#e5e7eb">
                {v.toFixed(1)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// DayDistributionSection — répartition énergétique 24 h + Leq24h (EQ-09)
// ────────────────────────────────────────────────────────────────────────────
function DayDistributionSection({
  files, pointMap, selectedDate, pointNames, periods, categories, excludedCatIds,
}: {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  pointNames: string[]
  periods?: Period[]
  categories?: Category[]
  excludedCatIds: Set<string>
}) {
  const [showSection, setShowSection] = useState(true)

  const dayByPoint = useMemo(() => {
    return pointNames.map((pt) => {
      // Journée ENTIÈRE (le Leq24h est un concept 24 h, pas de plage perso),
      // en respectant le filtrage par période nommée + exclusion à la volée.
      const data = files
        .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
        .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories, { excludeCategoryIds: excludedCatIds }))
      const hourly = leqByClockHour(data)
      return { pt, dist: dayEnergyDistribution(hourly) }
    })
  }, [files, pointMap, selectedDate, pointNames, periods, categories, excludedCatIds])

  if (pointNames.length === 0) return null

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={() => setShowSection(!showSection)}
        className="flex items-center gap-2 px-4 py-2 w-full text-left hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Répartition journée</span>
        <HelpTooltip
          text={'Répartition énergétique par heure d’horloge et Leq24h (EQ-09 « Repartition-journée »).\n\nLeq24h = 10·log10(Σ 10^(Leq1h/10) / 24), calculé uniquement si les 24 heures d’horloge sont présentes (sinon « indispo. »). Le % indique la couverture 24 h (ambre si < 95 %).'}
          position="right"
        />
        <ChevronRight size={12} className={`text-gray-600 transition-transform ${showSection ? 'rotate-90' : ''}`} />
      </button>

      {showSection && (
        <div className="px-4 pb-3 animate-[fadeIn_0.15s_ease-out]">
          <div className="flex gap-3 overflow-x-auto">
            {dayByPoint.map(({ pt, dist }, i) => (
              <DayDistributionMini key={pt} pointName={pt} color={ptColor(pt, i)} dist={dist} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Mini : Leq24h + couverture 24 h + 24 barres de répartition énergétique horaire. */
function DayDistributionMini({
  pointName, color, dist,
}: {
  pointName: string
  color: string
  dist: { parts: (number | null)[]; leq24h: number | null; hoursPresent: number; coveredMin: number }
}) {
  const W = 240, H = 84, PAD_L = 4, PAD_R = 4, PAD_T = 4, PAD_B = 14
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const barW = plotW / 24
  const maxPart = Math.max(0.0001, ...dist.parts.map((p) => p ?? 0))
  const coverage = Math.min(1, dist.coveredMin / 1440)
  const pct = Math.round(coverage * 100)
  const partial = coverage < 0.95
  const has24 = dist.hoursPresent === 24

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-semibold" style={{ color }}>{pointName}</span>
        <span className="text-[10px] text-gray-400 tabular-nums">
          Leq24h{' '}
          {has24 && dist.leq24h !== null ? (
            <span className="font-mono text-gray-200">{dist.leq24h.toFixed(1)} dB(A)</span>
          ) : (
            <span className="text-gray-500">indispo. ({dist.hoursPresent}/24 h)</span>
          )}
        </span>
        <span
          className={`text-[10px] ${partial ? 'text-amber-400' : 'text-gray-600'}`}
          title={`Couverture 24 h : ${dist.coveredMin}/1440 min`}
        >
          · {pct}%
        </span>
      </div>
      <svg width={W} height={H} className="block" style={{ background: '#0b1220', borderRadius: 4 }}>
        {dist.parts.map((p, h) => {
          const bh = ((p ?? 0) / maxPart) * plotH
          const x = PAD_L + h * barW
          const isPeak = p !== null && p >= maxPart * 0.6
          return (
            <rect
              key={h}
              x={x}
              y={PAD_T + (plotH - bh)}
              width={Math.max(0.8, barW - 0.6)}
              height={Math.max(0, bh)}
              fill={color}
              fillOpacity={p === null ? 0.12 : isPeak ? 1 : 0.45}
            />
          )
        })}
        {[0, 6, 12, 18].map((h) => (
          <text key={h} x={PAD_L + h * barW} y={H - 3} fontSize={8} fill="#6b7280">{h}h</text>
        ))}
      </svg>
    </div>
  )
}

/** Tableau L90 horaire avec identification de l'heure la plus calme */
function AmbientNoiseSection({ files, pointMap, selectedDate, pointNames, periods, categories, excludedCatIds }: {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  pointNames: string[]
  periods?: Period[]
  categories?: Category[]
  excludedCatIds: Set<string>
}) {
  const [showSection, setShowSection] = useState(false)

  // L90 par heure et par point
  const hourlyL90 = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => i)
    return hours.map((h) => {
      const entry: Record<string, number | null> = { hour: h }
      for (const pt of pointNames) {
        const values = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories, { excludeCategoryIds: excludedCatIds }))
          .filter((dp) => Math.floor(dp.t / 60) === h)
          .map((dp) => dp.laeq)
        if (values.length >= 3) {
          // L90 = bruit de fond (valeur BASSE) via la source unique computeLn.
          entry[pt] = Math.round(computeL90(values) * 10) / 10
        } else {
          entry[pt] = null
        }
      }
      return entry
    })
  }, [files, pointMap, selectedDate, pointNames, periods, categories, excludedCatIds])

  // Heure la plus calme par point
  const quietestHour = useMemo(() => {
    const result: Record<string, { hour: number; value: number } | null> = {}
    for (const pt of pointNames) {
      let minVal = Infinity
      let minHour = -1
      for (const row of hourlyL90) {
        const v = row[pt] as number | null
        if (v !== null && v < minVal) {
          minVal = v
          minHour = row.hour as number
        }
      }
      result[pt] = minHour >= 0 ? { hour: minHour, value: minVal } : null
    }
    return result
  }, [hourlyL90, pointNames])

  if (pointNames.length === 0) return null

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={() => setShowSection(!showSection)}
        className="flex items-center gap-2 px-4 py-2 w-full text-left hover:bg-gray-800/50 transition-colors"
      >
        <TrendingDown size={12} className="text-blue-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Analyse bruit de fond
        </span>
        <ChevronRight size={12} className={`text-gray-600 transition-transform ${showSection ? 'rotate-90' : ''}`} />
      </button>

      {showSection && (
        <div className="px-4 pb-3 animate-[fadeIn_0.15s_ease-out]">
          {/* Heure la plus calme */}
          <div className="flex flex-wrap gap-4 mb-2">
            {pointNames.map((pt, i) => {
              const q = quietestHour[pt]
              return q ? (
                <div key={pt} className="text-xs">
                  <span style={{ color: ptColor(pt, i) }} className="font-medium">{pt}</span>
                  <span className="text-gray-500"> : heure la plus calme = </span>
                  <span className="text-gray-200 font-medium">{String(q.hour).padStart(2, '0')}h</span>
                  <span className="text-gray-500"> ({q.value} dB)</span>
                </div>
              ) : null
            })}
          </div>

          {/* Tableau L90 horaire */}
          <div className="overflow-x-auto max-h-40 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="border-b border-gray-800">
                  <th className="text-left px-2 py-1 text-gray-500 font-medium">Heure</th>
                  {pointNames.map((pt, i) => (
                    <th key={pt} className="px-2 py-1 text-center font-medium" style={{ color: ptColor(pt, i) }}>
                      L90
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hourlyL90.map((row) => {
                  const h = row.hour as number
                  return (
                    <tr key={h} className="border-b border-gray-800/30">
                      <td className="px-2 py-0.5 text-gray-500 font-mono">
                        {String(h).padStart(2, '0')}:00
                      </td>
                      {pointNames.map((pt) => {
                        const v = row[pt] as number | null
                        const isQuietest = quietestHour[pt]?.hour === h
                        return (
                          <td key={pt} className={`px-2 py-0.5 text-center tabular-nums ${
                            isQuietest ? 'text-blue-300 font-semibold' : 'text-gray-400'
                          }`}>
                            {v !== null ? v.toFixed(1) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
