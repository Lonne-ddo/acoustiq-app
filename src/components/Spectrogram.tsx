/**
 * Spectrogramme 1/3 octave — vue fréquence × temps sur canvas
 * Palette viridis : bleu foncé (bas dB) → vert → jaune (haut dB)
 * Un canvas par point de mesure, curseur synchronisé entre eux
 */
import { useRef, useEffect, useMemo, useState } from 'react'
import type { MeasurementFile, SourceEvent, DataPoint, ZoomRange } from '../types'
import { A_WEIGHT } from '../utils/acoustics'

const DEFAULT_CANVAS_HEIGHT = 160  // hauteur affichée en px par spectrogramme (mode plein)
const Y_AXIS_W = 48                // largeur réservée aux étiquettes de fréquence
const LEGEND_W = 36                // largeur réservée à la légende de couleur

// ---- Fréquences ------------------------------------------------------------
// 36 bandes tiers d'octave standard (6.3 Hz → 20 kHz)
const FREQ_BANDS_ALL = [
  6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150,
  4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

// Fréquences affichées comme étiquettes sur l'axe Y
const Y_LABEL_SET = new Set([100, 250, 500, 1000, 2000, 4000, 8000, 16000])

// ---- Palette viridis -------------------------------------------------------
const V_STOPS: Array<[number, [number, number, number]]> = [
  [0.000, [68,   1,  84]],
  [0.125, [71,  44, 122]],
  [0.250, [59,  82, 139]],
  [0.375, [44, 113, 142]],
  [0.500, [33, 145, 140]],
  [0.625, [39, 173, 129]],
  [0.750, [92, 200,  99]],
  [0.875, [170, 220, 50]],
  [1.000, [253, 231,  37]],
]

function viridis(t: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, t))
  for (let i = 0; i < V_STOPS.length - 1; i++) {
    const [t0, c0] = V_STOPS[i]
    const [t1, c1] = V_STOPS[i + 1]
    if (v <= t1) {
      const u = (v - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + u * (c1[0] - c0[0])),
        Math.round(c0[1] + u * (c1[1] - c0[1])),
        Math.round(c0[2] + u * (c1[2] - c0[2])),
      ]
    }
  }
  return [253, 231, 37]
}

// ---- Couleurs par point (partagées avec TimeSeriesChart) -------------------
const POINT_COLORS: Record<string, string> = {
  'BV-94': '#10b981', 'BV-98': '#3b82f6', 'BV-105': '#f59e0b',
  'BV-106': '#ef4444', 'BV-37': '#8b5cf6', 'BV-107': '#06b6d4',
}
const FALLBACK = ['#ec4899', '#84cc16', '#f97316', '#a78bfa']
const ptColor = (pt: string, i: number) => POINT_COLORS[pt] ?? FALLBACK[i % FALLBACK.length]

// ---- Utilitaires -----------------------------------------------------------
function minutesToHHMM(t: number): string {
  const h = Math.floor(t / 60) % 24
  const m = Math.round(t % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}

/**
 * Mode d'agrégation du spectrogramme.
 * - 'moyen'      : moyenne énergétique par bande sur chaque bucket (lissé, par défaut)
 * - 'instantane' : valeur maximale (pic) par bande sur chaque bucket — met en
 *                  évidence les événements transitoires sans moyennage
 */
export type SpectroMode = 'moyen' | 'instantane'

/**
 * Agrège les spectres par buckets de `aggSec` secondes selon le mode choisi.
 * La clé du bucket est en minutes (float) pour rester compatible avec l'axe X.
 */
function aggregateSpectra(
  data: DataPoint[],
  aggSec: number,
  mode: SpectroMode = 'moyen',
): Map<number, number[]> {
  if (mode === 'instantane') {
    // Pic (max) par bande sur chaque bucket
    const acc = new Map<number, number[]>()
    for (const dp of data) {
      if (!dp.spectra?.length) continue
      const tSec = Math.round(dp.t * 60)
      const bucketMin = (Math.floor(tSec / aggSec) * aggSec) / 60
      const cur = acc.get(bucketMin)
      if (!cur) {
        acc.set(bucketMin, dp.spectra.slice())
      } else {
        for (let i = 0; i < dp.spectra.length; i++) {
          if (dp.spectra[i] > cur[i]) cur[i] = dp.spectra[i]
        }
      }
    }
    return acc
  }
  // Mode 'moyen' : moyenne énergétique
  const acc = new Map<number, { pow: number[]; n: number }>()
  for (const dp of data) {
    if (!dp.spectra?.length) continue
    const tSec = Math.round(dp.t * 60)
    const bucketSec = Math.floor(tSec / aggSec) * aggSec
    const bucketMin = bucketSec / 60
    if (!acc.has(bucketMin)) {
      acc.set(bucketMin, { pow: new Array(dp.spectra.length).fill(0), n: 0 })
    }
    const a = acc.get(bucketMin)!
    dp.spectra.forEach((v, i) => { a.pow[i] += Math.pow(10, v / 10) })
    a.n++
  }
  const out = new Map<number, number[]>()
  for (const [t, { pow, n }] of acc) {
    out.set(t, pow.map((p) => 10 * Math.log10(p / n)))
  }
  return out
}

// ---- ColorScaleLegend ------------------------------------------------------
function ColorScaleLegend({
  minDb,
  maxDb,
  height,
}: { minDb: number; maxDb: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const H = canvas.height
    const tmp = document.createElement('canvas')
    tmp.width = 1; tmp.height = H
    const tctx = tmp.getContext('2d')!
    const img = tctx.createImageData(1, H)
    for (let y = 0; y < H; y++) {
      const [r, g, b] = viridis(1 - y / Math.max(H - 1, 1))
      img.data[y * 4] = r; img.data[y * 4 + 1] = g
      img.data[y * 4 + 2] = b; img.data[y * 4 + 3] = 255
    }
    tctx.putImageData(img, 0, 0)
    ctx.drawImage(tmp, 0, 0, canvas.width, H)
  }, [minDb, maxDb, height])

  const mid = Math.round((minDb + maxDb) / 2)

  return (
    <div
      className="flex flex-col shrink-0"
      style={{ width: LEGEND_W, paddingTop: 20 /* aligne avec le canvas */ }}
    >
      <div className="flex gap-1" style={{ height }}>
        <div className="flex flex-col justify-between py-0.5 text-right">
          {[maxDb, mid, minDb].map((v) => (
            <span key={v} className="text-gray-500 select-none" style={{ fontSize: 9 }}>
              {v}
            </span>
          ))}
        </div>
        <canvas
          ref={ref}
          width={10}
          height={height}
          className="rounded-sm"
          style={{ width: 10, height }}
        />
      </div>
      <span
        className="text-gray-500 text-center mt-1 select-none"
        style={{ fontSize: 9 }}
      >
        dB
      </span>
    </div>
  )
}

// ---- XAxis -----------------------------------------------------------------
function XAxis({ tMin, tMax }: { tMin: number; tMax: number }) {
  const range = tMax - tMin || 1
  // Intervalle adaptatif selon la plage visible
  let interval: number
  if (range <= 15) interval = 5
  else if (range <= 60) interval = 10
  else if (range <= 180) interval = 30
  else if (range <= 720) interval = 60
  else interval = 120
  const ticks: number[] = []
  for (let t = Math.ceil(tMin / interval) * interval; t <= tMax; t += interval) {
    ticks.push(t)
  }
  return (
    <div
      className="relative h-5 mt-0.5"
      style={{ marginLeft: Y_AXIS_W, marginRight: LEGEND_W }}
    >
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute text-gray-600 select-none"
          style={{
            left: `${((t - tMin) / range) * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: 9,
            top: 2,
          }}
        >
          {minutesToHHMM(t)}
        </span>
      ))}
    </div>
  )
}

// ---- SingleSpectrogram -----------------------------------------------------
interface SingleSpectrogramProps {
  pointName: string
  pointColor: string
  spectraByBucket: Map<number, number[]>
  tMin: number
  tMax: number
  nBands: number
  freqBands: number[]
  minDb: number
  maxDb: number
  hoverTime: number | null
  events: SourceEvent[]
  onHoverTime: (t: number | null) => void
  /** Hauteur du canvas en px (variable selon mode embedded/full) */
  canvasHeight: number
  /** Pas d'agrégation en secondes (largeur de chaque bucket) */
  aggSec: number
  compact?: boolean
}

function SingleSpectrogram({
  pointName, pointColor, spectraByBucket,
  tMin, tMax, nBands, freqBands,
  minDb, maxDb, hoverTime, events, onHoverTime,
  canvasHeight, aggSec, compact,
}: SingleSpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(0)

  // Suivi de la largeur du conteneur (responsive)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setCanvasW(Math.floor(el.clientWidth)))
    obs.observe(el)
    setCanvasW(Math.floor(el.clientWidth))
    return () => obs.disconnect()
  }, [])

  // Dessin du heatmap sur le canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasW === 0 || nBands === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasW * dpr
    canvas.height = canvasHeight * dpr

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Fond sombre pour les buckets sans données
    ctx.fillStyle = '#030712'
    ctx.fillRect(0, 0, canvasW, canvasHeight)

    if (spectraByBucket.size === 0) return

    const sorted = [...spectraByBucket.entries()].sort(([a], [b]) => a - b)
    const tRange = tMax - tMin || 1

    // Canvas basse résolution : 1px par bucket × 1px par bande
    const tmp = document.createElement('canvas')
    tmp.width = sorted.length
    tmp.height = nBands
    const tctx = tmp.getContext('2d')!
    const img = tctx.createImageData(sorted.length, nBands)

    sorted.forEach(([, sp], ti) => {
      const n = Math.min(sp.length, nBands)
      for (let bi = 0; bi < n; bi++) {
        // bi=0 = basse fréquence → bas du canvas → dernière ligne de l'ImageData
        const row = nBands - 1 - bi
        const dbRange = maxDb - minDb || 1 // Éviter division par zéro
        const norm = (sp[bi] - minDb) / dbRange
        const [r, g, b] = viridis(norm)
        const idx = (row * sorted.length + ti) * 4
        img.data[idx] = r; img.data[idx + 1] = g
        img.data[idx + 2] = b; img.data[idx + 3] = 255
      }
    })
    tctx.putImageData(img, 0, 0)

    // Dessiner chaque bucket à sa position temporelle exacte
    ctx.imageSmoothingEnabled = false
    const aggMin = aggSec / 60
    sorted.forEach(([bucket], ti) => {
      const x0 = Math.round(((bucket - tMin) / tRange) * canvasW)
      const x1 = Math.round(((bucket + aggMin - tMin) / tRange) * canvasW)
      ctx.drawImage(tmp, ti, 0, 1, nBands, x0, 0, Math.max(1, x1 - x0), canvasHeight)
    })
  }, [spectraByBucket, nBands, minDb, maxDb, canvasW, tMin, tMax, aggSec, canvasHeight])

  const tRange = tMax - tMin || 1
  const cursorPct = hoverTime !== null ? ((hoverTime - tMin) / tRange) * 100 : null

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const aggMin = aggSec / 60
    onHoverTime(Math.floor((tMin + frac * tRange) / aggMin) * aggMin)
  }

  return (
    <div className={compact ? 'mb-1' : 'mb-3'}>
      {/* Étiquette du point */}
      <div className="flex items-center gap-1.5 mb-1" style={{ paddingLeft: Y_AXIS_W }}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pointColor }} />
        <span className="font-semibold" style={{ color: pointColor, fontSize: 11 }}>
          {pointName}
        </span>
      </div>

      <div className="flex items-stretch">
        {/* Axe Y : étiquettes de fréquences */}
        <div className="relative shrink-0" style={{ width: Y_AXIS_W, height: canvasHeight }}>
          {freqBands.map((f, bi) => {
            if (!Y_LABEL_SET.has(f)) return null
            const yPct = (1 - bi / Math.max(nBands - 1, 1)) * 100
            return (
              <span
                key={f}
                className="absolute right-1 text-gray-500 select-none"
                style={{ top: `${yPct}%`, transform: 'translateY(-50%)', fontSize: 9, lineHeight: 1 }}
              >
                {freqLabel(f)}
              </span>
            )
          })}
        </div>

        {/* Canvas + overlays curseur et événements */}
        <div
          ref={containerRef}
          className="relative flex-1 cursor-crosshair overflow-hidden"
          style={{ height: canvasHeight }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => onHoverTime(null)}
        >
          <canvas
            ref={canvasRef}
            className="block w-full"
            style={{ height: canvasHeight, backgroundColor: '#030712' }}
          />

          {/* Curseur temps */}
          {cursorPct !== null && (
            <div
              className="pointer-events-none absolute inset-y-0"
              style={{ left: `${cursorPct}%`, width: 1, backgroundColor: 'rgba(255,255,255,0.65)' }}
            >
              <span
                className="absolute whitespace-nowrap select-none"
                style={{
                  top: 3, left: 4, fontSize: 10, color: 'white',
                  backgroundColor: 'rgba(0,0,0,0.55)',
                  padding: '1px 3px', borderRadius: 2,
                }}
              >
                {minutesToHHMM(hoverTime!)}
              </span>
            </div>
          )}

          {/* Lignes verticales des événements */}
          {events.map((ev) => {
            const [ehStr = '0', emStr = '0'] = ev.time.split(':')
            const evMin = parseInt(ehStr, 10) * 60 + parseInt(emStr, 10)
            const pct = ((evMin - tMin) / tRange) * 100
            if (pct < 0 || pct > 100) return null
            return (
              <div
                key={ev.id}
                className="pointer-events-none absolute inset-y-0"
                style={{ left: `${pct}%`, borderLeft: `1.5px dashed ${ev.color}` }}
              >
                <span
                  className="absolute whitespace-nowrap select-none"
                  style={{ top: 3, left: 3, fontSize: 9, color: ev.color }}
                >
                  {ev.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---- Composant principal ---------------------------------------------------
interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  availableDates: string[]
  onDateChange: (date: string) => void
  events: SourceEvent[]
  /** Plage de zoom synchronisée avec le graphique temporel */
  zoomRange?: ZoomRange | null
  /** Pas d'agrégation en secondes (par défaut 300 = 5 min) */
  aggregationSeconds?: number
  /** Mode compact : pas de barre d'outils, hauteur réduite par point, scroll interne */
  compact?: boolean
  /** Hauteur totale du conteneur (mode compact uniquement) */
  height?: number
}

export default function Spectrogram({
  files, pointMap, selectedDate, availableDates, onDateChange, events,
  zoomRange,
  aggregationSeconds = 300,
  compact = false,
  height,
}: Props) {
  const [minDb, setMinDb] = useState(30)
  const [maxDb, setMaxDb] = useState(90)
  const [mode, setMode] = useState<SpectroMode>('moyen')
  const [hoverTime, setHoverTime] = useState<number | null>(null)

  // Fichiers actifs pour la journée sélectionnée, groupés par point
  const filesByPoint = useMemo(() => {
    const map = new Map<string, MeasurementFile[]>()
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt || f.date !== selectedDate) continue
      if (!map.has(pt)) map.set(pt, [])
      map.get(pt)!.push(f)
    }
    return map
  }, [files, pointMap, selectedDate])

  const pointNames = [...filesByPoint.keys()].sort()

  // Fréquences réelles des bandes spectrales — issues du parser via
  // file.spectraFreqs (831C : 27 bandes 50 Hz–20 kHz · 821SE : 26 bandes
  // 31.5 Hz–10 kHz). Fallback héritage si absent.
  const freqBandsFromFile = useMemo(() => {
    for (const fs of filesByPoint.values()) {
      for (const f of fs) {
        if (f.spectraFreqs && f.spectraFreqs.length > 0) return f.spectraFreqs
      }
    }
    return null
  }, [filesByPoint])

  // Vecteur d'A-pondération par bande (LZeq → LAeq) appliqué à l'affichage.
  const aWeightVector = useMemo(() => {
    if (!freqBandsFromFile) return null
    return freqBandsFromFile.map((f) => A_WEIGHT[f] ?? 0)
  }, [freqBandsFromFile])

  // Agrégation des spectres pour chaque point — applique l'A-weighting in-line
  // pour que tous les calculs aval (couleurs, légende dB, min/max) soient en
  // dB(A) cohérents entre 831C et 821SE.
  const spectraByPoint = useMemo(() => {
    const m = new Map<string, Map<number, number[]>>()
    for (const [pt, fs] of filesByPoint) {
      const raw = aggregateSpectra(fs.flatMap((f) => f.data), aggregationSeconds, mode)
      if (!aWeightVector) {
        m.set(pt, raw)
        continue
      }
      const weighted = new Map<number, number[]>()
      for (const [t, sp] of raw) {
        weighted.set(t, sp.map((v, i) => v + (aWeightVector[i] ?? 0)))
      }
      m.set(pt, weighted)
    }
    return m
  }, [filesByPoint, aggregationSeconds, mode, aWeightVector])

  // Plage temporelle globale et nombre de bandes
  const { tMin, tMax, nBands } = useMemo(() => {
    let mn = Infinity, mx = -Infinity, nb = 0
    for (const [, buckets] of spectraByPoint) {
      for (const [t, sp] of buckets) {
        mn = Math.min(mn, t); mx = Math.max(mx, t); nb = Math.max(nb, sp.length)
      }
    }
    // Appliquer le zoom si fourni
    const baseMn = mn === Infinity ? 0 : mn
    const baseMx = mx === -Infinity ? 1439 : mx
    return {
      tMin: zoomRange ? Math.max(baseMn, zoomRange.startMin) : baseMn,
      tMax: zoomRange ? Math.min(baseMx, zoomRange.endMin) : baseMx,
      nBands: nb,
    }
  }, [spectraByPoint, zoomRange])

  // Liste des fréquences à afficher sur l'axe Y. Priorité au parser ; sinon
  // fallback historique sur les N dernières bandes de FREQ_BANDS_ALL.
  const freqBands = useMemo(() => {
    if (freqBandsFromFile && freqBandsFromFile.length === nBands) return freqBandsFromFile
    if (freqBandsFromFile) return freqBandsFromFile.slice(0, nBands)
    return FREQ_BANDS_ALL.slice(-Math.max(nBands, 1))
  }, [freqBandsFromFile, nBands])

  // Événements du jour sélectionné
  const activeEvents = useMemo(
    () => events.filter((ev) => ev.day === selectedDate),
    [events, selectedDate],
  )

  // Hauteur par canvas : compactée si embedded (− header + axe X), sinon valeur par défaut
  const perCanvasHeight = compact
    ? Math.max(40, Math.floor(((height ?? 200) - 60) / Math.max(1, pointNames.length)))
    : DEFAULT_CANVAS_HEIGHT

  // États vides
  if (pointNames.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm px-8 text-center">
        {compact ? '—' : 'Chargez un fichier et assignez-lui un point de mesure.'}
      </div>
    )
  }
  if (nBands === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-xs px-4 text-center">
        Aucune donnée spectrale 1/3 octave dans les fichiers chargés.
      </div>
    )
  }

  // Barre d'outils commune : toggle Moyen/Instantané + min/max dB
  const headerControls = (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500 mr-1">Mode</span>
        <button
          onClick={() => setMode('moyen')}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            mode === 'moyen' ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
          title="Moyenne énergétique par bucket d'agrégation"
        >
          Moyen
        </button>
        <button
          onClick={() => setMode('instantane')}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            mode === 'instantane' ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
          title="Pic (max) par bande sur chaque bucket — sans moyennage"
        >
          Instantané
        </button>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500">Échelle dB</span>
        <input
          type="number"
          value={minDb}
          onChange={(e) => setMinDb(Number(e.target.value))}
          className="w-12 text-[10px] text-center bg-gray-800 text-gray-100 border border-gray-600
                     rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          aria-label="Min dB"
        />
        <span className="text-[10px] text-gray-600">–</span>
        <input
          type="number"
          value={maxDb}
          onChange={(e) => setMaxDb(Number(e.target.value))}
          className="w-12 text-[10px] text-center bg-gray-800 text-gray-100 border border-gray-600
                     rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          aria-label="Max dB"
        />
      </div>
    </div>
  )

  // ── Mode compact (embarqué sous le graphique) ────────────────────────────
  if (compact) {
    return (
      <div data-acoustiq-spectrogram="compact" className="flex flex-col h-full" style={{ height }}>
        <div className="flex items-center justify-end px-4 py-1 border-b border-gray-800/60 shrink-0">
          {headerControls}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="flex gap-0">
            <div className="flex-1 min-w-0">
              {pointNames.map((pt, i) => (
                <SingleSpectrogram
                  key={pt}
                  pointName={pt}
                  pointColor={ptColor(pt, i)}
                  spectraByBucket={spectraByPoint.get(pt) ?? new Map()}
                  tMin={tMin}
                  tMax={tMax}
                  nBands={nBands}
                  freqBands={freqBands}
                  minDb={minDb}
                  maxDb={maxDb}
                  hoverTime={hoverTime}
                  events={activeEvents}
                  onHoverTime={setHoverTime}
                  canvasHeight={perCanvasHeight}
                  aggSec={aggregationSeconds}
                  compact
                />
              ))}
              <XAxis tMin={tMin} tMax={tMax} />
            </div>
            <ColorScaleLegend minDb={minDb} maxDb={maxDb} height={perCanvasHeight} />
          </div>
        </div>
      </div>
    )
  }

  // ── Mode plein (onglet Spectrogramme) ─────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Barre de contrôle */}
      <div className="flex items-center gap-4 px-6 py-2.5 border-b border-gray-800 shrink-0">
        {availableDates.length > 1 ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 font-medium">Journée</label>
            <select
              value={selectedDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        ) : (
          <span className="text-xs text-gray-500">{selectedDate}</span>
        )}

        <div className="ml-auto">{headerControls}</div>
      </div>

      {/* Zone scrollable : spectrogrammes empilés */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex gap-0">
          {/* Colonne principale : spectrogrammes + axe X */}
          <div className="flex-1 min-w-0">
            {pointNames.map((pt, i) => (
              <SingleSpectrogram
                key={pt}
                pointName={pt}
                pointColor={ptColor(pt, i)}
                spectraByBucket={spectraByPoint.get(pt) ?? new Map()}
                tMin={tMin}
                tMax={tMax}
                nBands={nBands}
                freqBands={freqBands}
                minDb={minDb}
                maxDb={maxDb}
                hoverTime={hoverTime}
                events={activeEvents}
                onHoverTime={setHoverTime}
                canvasHeight={DEFAULT_CANVAS_HEIGHT}
                aggSec={aggregationSeconds}
              />
            ))}
            <XAxis tMin={tMin} tMax={tMax} />
          </div>

          {/* Légende de couleur */}
          <ColorScaleLegend minDb={minDb} maxDb={maxDb} height={DEFAULT_CANVAS_HEIGHT} />
        </div>
      </div>
    </div>
  )
}
