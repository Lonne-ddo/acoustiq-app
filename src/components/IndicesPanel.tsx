/**
 * Panneau des indices acoustiques réglementaires
 * LAeq, L10, L50, L90, LAFmax, LAFmin — un tableau par point de mesure
 */
import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Download, TrendingDown, ChevronRight, Sun } from 'lucide-react'
import HelpTooltip from './HelpTooltip'
import type { MeasurementFile, MeteoData } from '../types'
import {
  laeqAvg,
  computeL10,
  computeL50,
  computeL90,
  computeLAFmax,
  computeLAFmin,
  detectKt,
} from '../utils/acoustics'

/** Calcule LAeq sur une plage horaire (en heures) ; gère le passage minuit. */
function laeqOnPeriod(data: { t: number; laeq: number }[], startH: number, endH: number): number | null {
  const sMin = startH * 60
  const eMin = endH * 60
  const inRange = (t: number) =>
    eMin > sMin ? t >= sMin && t < eMin : t >= sMin || t < eMin
  const vals = data.filter((d) => inRange(d.t)).map((d) => d.laeq)
  return vals.length > 0 ? laeqAvg(vals) : null
}

const PERIODS_HELP =
  'Périodes définies par les Lignes directrices MELCCFP 2026 :\n' +
  '• Jour : 07h00 – 19h00\n' +
  '• Soir : 19h00 – 22h00\n' +
  '• Nuit : 22h00 – 07h00 (passage minuit inclus)'

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
  { key: 'l10',    label: 'L10',    unit: 'dB(A)', help: 'Niveau dépassé 10% du temps — caractérise les niveaux de pointe récurrents.' },
  { key: 'l50',    label: 'L50',    unit: 'dB(A)', help: 'Niveau dépassé 50% du temps — médiane, représente le bruit « typique ».' },
  { key: 'l90',    label: 'L90',    unit: 'dB(A)', help: 'Niveau dépassé 90% du temps — bruit résiduel (bruit de fond).' },
  { key: 'lafmax', label: 'LAFmax', unit: 'dB(A)', help: 'Niveau maximal instantané pondéré A, constante Fast.' },
  { key: 'lafmin', label: 'LAFmin', unit: 'dB(A)', help: 'Niveau minimal instantané pondéré A, constante Fast.' },
] as const

type IndexKey = (typeof ROWS)[number]['key']

interface IndexValues {
  laeq: number
  l10: number
  l50: number
  l90: number
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
}

export default function IndicesPanel({ files, pointMap, selectedDate, meteo, aggregationSeconds = 300 }: Props) {
  const [mode, setMode] = useState<'full' | 'custom'>('full')
  const [startTime, setStartTime] = useState('00:00')
  const [endTime, setEndTime] = useState('23:59')

  // Points actifs pour la journée sélectionnée
  const pointNames = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id] && f.date === selectedDate) pts.add(pointMap[f.id])
    }
    return [...pts].sort()
  }, [files, pointMap, selectedDate])

  // Calcul des Lpériodes MELCCFP par point (jour/soir/nuit, journée complète)
  const periodsByPoint = useMemo(() => {
    return Object.fromEntries(
      pointNames.map((pt) => {
        const data = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => f.data)
        return [
          pt,
          {
            ljour: laeqOnPeriod(data, 7, 19),
            lsoir: laeqOnPeriod(data, 19, 22),
            lnuit: laeqOnPeriod(data, 22, 7),
          },
        ]
      }),
    ) as Record<string, { ljour: number | null; lsoir: number | null; lnuit: number | null }>
  }, [files, pointMap, selectedDate, pointNames])

  // Caractéristiques du bruit (composante tonale par point) — basées sur la
  // moyenne énergétique des spectres 1/3 d'octave sur la plage sélectionnée.
  const tonalByPoint = useMemo(() => {
    const startMin = mode === 'custom' ? hhmmToMin(startTime) : -Infinity
    const endMin = mode === 'custom' ? hhmmToMin(endTime) : Infinity
    return Object.fromEntries(
      pointNames.map((pt) => {
        const dps = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => f.data)
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
  }, [files, pointMap, selectedDate, pointNames, mode, startTime, endTime])

  // Calcul des indices par point
  const indicesByPoint = useMemo((): Record<string, IndexValues | null> => {
    const startMin = mode === 'custom' ? hhmmToMin(startTime) : -Infinity
    const endMin = mode === 'custom' ? hhmmToMin(endTime) : Infinity

    return Object.fromEntries(
      pointNames.map((pt) => {
        const values = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => f.data)
          .filter((dp) => dp.t >= startMin && dp.t <= endMin)
          .map((dp) => dp.laeq)

        if (values.length === 0) return [pt, null]

        return [
          pt,
          {
            laeq:   laeqAvg(values),
            l10:    computeL10(values),
            l50:    computeL50(values),
            l90:    computeL90(values),
            lafmax: computeLAFmax(values),
            lafmin: computeLAFmin(values),
          } satisfies IndexValues,
        ]
      }),
    )
  }, [files, pointMap, selectedDate, mode, startTime, endTime, pointNames])

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

      // ── Feuille 2 : Périodes MELCCFP ──────────────────────────────────────
      const sheet2: Array<Array<string | number>> = []
      sheet2.push(['AcoustiQ — Périodes MELCCFP 2026'])
      sheet2.push([`Date : ${selectedDate}`])
      sheet2.push([])
      sheet2.push(['Période', ...pointNames])
      for (const k of ['ljour', 'lsoir', 'lnuit'] as const) {
        const label = k === 'ljour' ? 'Ljour (07h–19h)' : k === 'lsoir' ? 'Lsoir (19h–22h)' : 'Lnuit (22h–07h)'
        const line: Array<string | number> = [label]
        for (const pt of pointNames) {
          const v = periodsByPoint[pt]?.[k]
          line.push(v !== null && v !== undefined ? round1(v) : '')
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

  if (pointNames.length === 0) return null

  return (
    <div className="border-t border-gray-800 bg-gray-900 shrink-0">
      {/* Barre de contrôle */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Indices acoustiques
        </span>

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

      {/* Périodes MELCCFP — Ljour / Lsoir / Lnuit */}
      <div className="border-t border-gray-800">
        <div className="flex items-center gap-2 px-4 py-2">
          <Sun size={12} className="text-amber-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Périodes MELCCFP
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
                    const v = periodsByPoint[pt]?.[row.key]
                    const hasData = v !== null && v !== undefined
                    return (
                      <td
                        key={pt}
                        className={`px-4 py-1 text-center tabular-nums ${
                          hasData ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        {hasData ? (
                          <>
                            {fmt(v)}
                            <span className="text-gray-600 ml-0.5">dB(A)</span>
                          </>
                        ) : (
                          '—'
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

      {/* Distribution L1..L99 par point */}
      <DistributionSection
        files={files}
        pointMap={pointMap}
        selectedDate={selectedDate}
        pointNames={pointNames}
        startMin={mode === 'custom' ? hhmmToMin(startTime) : -Infinity}
        endMin={mode === 'custom' ? hhmmToMin(endTime) : Infinity}
      />

      {/* Analyse bruit de fond (L90 horaire) */}
      <AmbientNoiseSection files={files} pointMap={pointMap} selectedDate={selectedDate} pointNames={pointNames} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// DistributionSection — histogramme L1..L99 compact, un mini graphique par point
// ────────────────────────────────────────────────────────────────────────────

function DistributionSection({
  files, pointMap, selectedDate, pointNames, startMin, endMin,
}: {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  pointNames: string[]
  startMin: number
  endMin: number
}) {
  const [showSection, setShowSection] = useState(true)

  // Calcul des percentiles L1..L99 par point
  const distributions = useMemo(() => {
    return pointNames.map((pt) => {
      const values = files
        .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
        .flatMap((f) => f.data)
        .filter((dp) => dp.t >= startMin && dp.t <= endMin)
        .map((dp) => dp.laeq)
      if (values.length === 0) return { pt, percentiles: null as number[] | null, min: 0, max: 0 }
      const sorted = [...values].sort((a, b) => a - b)
      const n = sorted.length
      const percentiles: number[] = []
      // Lx convention : niveau dépassé x% du temps → percentile (100 - x) du tri ASC
      for (let x = 1; x <= 99; x++) {
        const idx = Math.round(((100 - x) / 100) * (n - 1))
        percentiles.push(sorted[Math.max(0, Math.min(n - 1, idx))])
      }
      return { pt, percentiles, min: sorted[0], max: sorted[n - 1] }
    })
  }, [files, pointMap, selectedDate, pointNames, startMin, endMin])

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

/** Tableau L90 horaire avec identification de l'heure la plus calme */
function AmbientNoiseSection({ files, pointMap, selectedDate, pointNames }: {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  pointNames: string[]
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
          .flatMap((f) => f.data)
          .filter((dp) => Math.floor(dp.t / 60) === h)
          .map((dp) => dp.laeq)
        if (values.length >= 3) {
          const sorted = [...values].sort((a, b) => a - b)
          const idx = Math.round(0.9 * (sorted.length - 1))
          entry[pt] = Math.round(sorted[idx] * 10) / 10
        } else {
          entry[pt] = null
        }
      }
      return entry
    })
  }, [files, pointMap, selectedDate, pointNames])

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
