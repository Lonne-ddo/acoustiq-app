/**
 * Spectrogramme 1/3 octave — vue fréquence × temps sur canvas.
 * Axe Y fréquences (log), axe X temps synchronisé avec le graphique LAeq,
 * colorbar dB. Palette par défaut « jet » (standard métier acoustique) avec
 * sélecteur Jet / Viridis / Turbo / Gris. Ctrl+molette = zoom synchronisé.
 * Un canvas par point de mesure, curseur synchronisé entre eux.
 */
import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import type { MeasurementFile, SourceEvent, DataPoint, ZoomRange, Period, Category } from '../types'

function hhmmToMin(t: string): number {
  const [h = '0', m = '0'] = t.split(':')
  return parseInt(h, 10) * 60 + parseInt(m, 10)
}
import { A_WEIGHT } from '../utils/acoustics'

const DEFAULT_CANVAS_HEIGHT = 200  // hauteur affichée en px par spectrogramme (mode plein)
const Y_AXIS_W = 70                // largeur réservée à l'axe Y (titre + étiquettes 11px)
const Y_TITLE_W = 14               // sous-largeur réservée au titre vertical « Fréquence (Hz) »
const Y_LABEL_FS = 11              // taille de police des étiquettes de fréquence
const LEGEND_W = 56                // largeur réservée à la colorbar (barre + graduations + dB)

// ---- Fréquences ------------------------------------------------------------
// 36 bandes tiers d'octave standard (6.3 Hz → 20 kHz)
const FREQ_BANDS_ALL = [
  6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150,
  4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

// Fréquences (octaves) affichées comme étiquettes principales sur l'axe Y
const Y_LABEL_SET = new Set([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000])

// ---- Palettes de couleurs --------------------------------------------------
// Jet (défaut, standard métier acoustique) · Viridis · Turbo · Greyscale.
type SpectroPalette = 'jet' | 'viridis' | 'turbo' | 'greyscale'

const PALETTE_OPTIONS: Array<{ id: SpectroPalette; label: string }> = [
  { id: 'jet', label: 'Jet' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'turbo', label: 'Turbo' },
  { id: 'greyscale', label: 'Gris' },
]

type RGB = [number, number, number]
type Stops = Array<[number, RGB]>

function sampleStops(stops: Stops, t: number): RGB {
  const v = Math.max(0, Math.min(1, t))
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (v <= t1) {
      const u = (v - t0) / (t1 - t0 || 1)
      return [
        Math.round(c0[0] + u * (c1[0] - c0[0])),
        Math.round(c0[1] + u * (c1[1] - c0[1])),
        Math.round(c0[2] + u * (c1[2] - c0[2])),
      ]
    }
  }
  return stops[stops.length - 1][1]
}

const V_STOPS: Stops = [
  [0.000, [68, 1, 84]], [0.125, [71, 44, 122]], [0.250, [59, 82, 139]],
  [0.375, [44, 113, 142]], [0.500, [33, 145, 140]], [0.625, [39, 173, 129]],
  [0.750, [92, 200, 99]], [0.875, [170, 220, 50]], [1.000, [253, 231, 37]],
]
const TURBO_STOPS: Stops = [
  [0.000, [48, 18, 59]], [0.125, [70, 107, 227]], [0.250, [40, 176, 237]],
  [0.375, [42, 228, 165]], [0.500, [123, 250, 69]], [0.625, [208, 233, 47]],
  [0.750, [251, 170, 32]], [0.875, [233, 82, 14]], [1.000, [122, 4, 3]],
]

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

// Jet / rainbow — formule classique (cf. consignes), valeurs 0–255.
function jet(t: number): RGB {
  const v = clamp01(t)
  const r = clamp01(1.5 - Math.abs(4 * v - 3))
  const g = clamp01(1.5 - Math.abs(4 * v - 2))
  const b = clamp01(1.5 - Math.abs(4 * v - 1))
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function colormap(t: number, palette: SpectroPalette): RGB {
  switch (palette) {
    case 'viridis': return sampleStops(V_STOPS, t)
    case 'turbo': return sampleStops(TURBO_STOPS, t)
    case 'greyscale': { const g = Math.round(clamp01(t) * 255); return [g, g, g] }
    case 'jet':
    default: return jet(t)
  }
}

// ---- Couleurs par point (partagées avec TimeSeriesChart) -------------------
const POINT_COLORS: Record<string, string> = {
  'BV-94': '#10b981', 'BV-98': '#3b82f6', 'BV-105': '#f59e0b',
  'BV-106': '#ef4444', 'BV-37': '#8b5cf6', 'BV-107': '#06b6d4',
}
const FALLBACK = ['#ec4899', '#84cc16', '#f97316', '#a78bfa']
const ptColor = (pt: string, i: number) => POINT_COLORS[pt] ?? FALLBACK[i % FALLBACK.length]

/** Couleur hex → rgba avec alpha (pour les bandes de période translucides). */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16) || 0
  const g = parseInt(m.slice(2, 4), 16) || 0
  const b = parseInt(m.slice(4, 6), 16) || 0
  return `rgba(${r},${g},${b},${a})`
}

// ---- Utilitaires -----------------------------------------------------------
function minutesToHHMM(t: number): string {
  const h = Math.floor(t / 60) % 24
  const m = Math.round(t % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function minutesToHHMMSS(t: number): string {
  const totalSec = Math.round(t * 60)
  const h = Math.floor(totalSec / 3600) % 24
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}

/** Graduations temporelles partagées (axe X + lignes de grille). */
function computeTimeTicks(tMin: number, tMax: number): number[] {
  const range = tMax - tMin || 1
  let interval: number
  if (range <= 5) interval = 1
  else if (range <= 15) interval = 5
  else if (range <= 60) interval = 10
  else if (range <= 180) interval = 30
  else if (range <= 720) interval = 60
  else interval = 120
  const ticks: number[] = []
  for (let t = Math.ceil(tMin / interval) * interval; t <= tMax; t += interval) {
    ticks.push(t)
  }
  return ticks
}

/** HH:MM:SS si la plage visible est serrée (< 10 min), sinon HH:MM. */
function formatTimeTick(t: number, rangeMin: number): string {
  return rangeMin < 10 ? minutesToHHMMSS(t) : minutesToHHMM(t)
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
// Colorbar verticale pleine hauteur : dégradé de la palette active, graduations
// tous les 10 dB, titre vertical « Niveau (dB) ».
function ColorScaleLegend({
  minDb,
  maxDb,
  height,
  palette,
}: { minDb: number; maxDb: number; height: number; palette: SpectroPalette }) {
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
      const [r, g, b] = colormap(1 - y / Math.max(H - 1, 1), palette)
      img.data[y * 4] = r; img.data[y * 4 + 1] = g
      img.data[y * 4 + 2] = b; img.data[y * 4 + 3] = 255
    }
    tctx.putImageData(img, 0, 0)
    ctx.drawImage(tmp, 0, 0, canvas.width, H)
  }, [minDb, maxDb, height, palette])

  // Graduations tous les 10 dB (bornes incluses)
  const dbTicks: number[] = []
  const lo = Math.ceil(minDb / 10) * 10
  for (let v = lo; v <= maxDb; v += 10) dbTicks.push(v)
  if (dbTicks[0] !== minDb) dbTicks.unshift(minDb)
  if (dbTicks[dbTicks.length - 1] !== maxDb) dbTicks.push(maxDb)
  const dbRange = maxDb - minDb || 1

  return (
    <div className="flex flex-col shrink-0" style={{ width: LEGEND_W }}>
      {/* Libellé « dB » en haut (occupe l'espace de l'étiquette du point) */}
      <div className="flex items-end justify-start" style={{ height: 20, paddingLeft: 1 }}>
        <span className="text-gray-400 select-none" style={{ fontSize: 11, lineHeight: 1 }}>dB</span>
      </div>
      {/* Barre de couleur + graduations 10 dB */}
      <div className="flex gap-1" style={{ height }}>
        <canvas
          ref={ref}
          width={16}
          height={height}
          className="rounded-sm shrink-0"
          style={{ width: 16, height }}
        />
        <div className="relative flex-1" style={{ height }}>
          {dbTicks.map((v) => (
            <div
              key={v}
              className="absolute left-0 flex items-center gap-0.5"
              style={{ top: `${(1 - (v - minDb) / dbRange) * 100}%`, transform: 'translateY(-50%)' }}
            >
              <span className="bg-gray-500" style={{ width: 3, height: 1 }} />
              <span className="text-gray-300 select-none tabular-nums" style={{ fontSize: 11, lineHeight: 1 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- XAxis -----------------------------------------------------------------
// Axe X temps (20px) — synchronisé avec le graphique LAeq. Format HH:MM, ou
// HH:MM:SS si la plage visible est serrée (< 10 min).
function XAxis({ tMin, tMax }: { tMin: number; tMax: number }) {
  const range = tMax - tMin || 1
  const ticks = computeTimeTicks(tMin, tMax)
  return (
    <div
      className="relative h-5 mt-0.5"
      style={{ marginLeft: Y_AXIS_W, marginRight: LEGEND_W }}
    >
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute text-gray-500 select-none"
          style={{
            left: `${((t - tMin) / range) * 100}%`,
            transform: 'translateX(-50%)',
            fontSize: 9,
            top: 2,
          }}
        >
          {formatTimeTick(t, range)}
        </span>
      ))}
    </div>
  )
}

/** Événement pré-résolu sur l'axe X absolu du spectrogramme (en minutes) —
 *  permet le mode multi-jours sans dupliquer la logique de résolution. */
interface ResolvedEvent {
  id: string
  label: string
  color: string
  minutes: number
}

/** Bande de période pré-résolue sur l'axe X absolu (en minutes). */
interface ResolvedBand {
  id: string
  label: string
  color: string
  startMin: number
  endMin: number
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
  events: ResolvedEvent[]
  bands: ResolvedBand[]
  onHoverTime: (t: number | null) => void
  /** Hauteur du canvas en px (variable selon mode embedded/full) */
  canvasHeight: number
  /** Pas d'agrégation en secondes (largeur de chaque bucket) */
  aggSec: number
  compact?: boolean
  /** Position du curseur de lecture audio en minutes (axe X chart) */
  playheadMin?: number | null
  /** Palette de couleurs active */
  palette: SpectroPalette
}

function SingleSpectrogram({
  pointName, pointColor, spectraByBucket,
  tMin, tMax, nBands, freqBands,
  minDb, maxDb, hoverTime, events, bands, onHoverTime,
  canvasHeight, aggSec, compact,
  playheadMin, palette,
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
        const [r, g, b] = colormap(norm, palette)
        const idx = (row * sorted.length + ti) * 4
        img.data[idx] = r; img.data[idx + 1] = g
        img.data[idx + 2] = b; img.data[idx + 3] = 255
      }
    })
    tctx.putImageData(img, 0, 0)

    // [DIAG] bug 1 — vérif couleurs basses fréquences (à retirer après diagnostic).
    // NB : sp[] contient déjà la pondération A appliquée en amont (A_WEIGHT = 0
    // pour les bandes < 31.5 Hz, donc valeur ≈ LZeq brut pour celles-ci).
    {
      const midSp = sorted[Math.floor(sorted.length / 2)]?.[1]
      if (midSp) {
        const dbRange2 = maxDb - minDb || 1
        console.log('[Spectro low-freq check]', {
          point: pointName, dbMin: minDb, dbMax: maxDb,
          lowBands: freqBands.slice(0, 8).map((f, bi) => {
            const v = midSp[bi]
            const norm = (v - minDb) / dbRange2
            const [r, g, b] = colormap(norm, palette)
            return { freq: f, valueAffichee: Math.round(v * 10) / 10, normalized: Math.round(norm * 100) / 100, rgb: `${r},${g},${b}` }
          }),
        })
      }
    }

    // Dessiner chaque bucket à sa position temporelle exacte
    ctx.imageSmoothingEnabled = false
    const aggMin = aggSec / 60
    sorted.forEach(([bucket], ti) => {
      const x0 = Math.round(((bucket - tMin) / tRange) * canvasW)
      const x1 = Math.round(((bucket + aggMin - tMin) / tRange) * canvasW)
      ctx.drawImage(tmp, ti, 0, 1, nBands, x0, 0, Math.max(1, x1 - x0), canvasHeight)
    })
  }, [spectraByBucket, nBands, minDb, maxDb, canvasW, tMin, tMax, aggSec, canvasHeight, palette])

  const tRange = tMax - tMin || 1
  const timeTicks = computeTimeTicks(tMin, tMax)
  const cursorPct = hoverTime !== null ? ((hoverTime - tMin) / tRange) * 100 : null
  const playheadPct = playheadMin !== null && playheadMin !== undefined
    ? ((playheadMin - tMin) / tRange) * 100
    : null

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
        {/* Axe Y : titre vertical « Fréquence (Hz) » + graduations.
            Position par index de bande = échelle log (les bandes 1/3 d'octave
            sont espacées logarithmiquement). */}
        <div className="relative shrink-0" style={{ width: Y_AXIS_W, height: canvasHeight }}>
          {/* Titre vertical — masqué si le canvas est trop court (mode compact
              multi-points) pour éviter le débordement. */}
          {canvasHeight >= 90 && (
            <div
              className="absolute inset-y-0 left-0 flex items-center justify-center"
              style={{ width: Y_TITLE_W }}
            >
              <span
                className="text-gray-500 select-none whitespace-nowrap"
                style={{ fontSize: 9, transform: 'rotate(-90deg)' }}
              >
                Fréquence (Hz)
              </span>
            </div>
          )}
          {/* Graduations : majeures (octaves, avec label) + mineures (trait) */}
          {freqBands.map((f, bi) => {
            const yPct = (1 - bi / Math.max(nBands - 1, 1)) * 100
            const major = Y_LABEL_SET.has(f)
            return major ? (
              <span
                key={f}
                className="absolute right-1.5 text-gray-300 select-none tabular-nums"
                style={{ top: `${yPct}%`, transform: 'translateY(-50%)', fontSize: Y_LABEL_FS, lineHeight: 1 }}
              >
                {freqLabel(f)}
              </span>
            ) : (
              <span
                key={f}
                className="absolute right-0 bg-gray-600"
                style={{ top: `${yPct}%`, width: 4, height: 1, transform: 'translateY(-50%)' }}
              />
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

          {/* Lignes de grille verticales (mêmes graduations que l'axe X /
              le graphique LAeq) — très discrètes pour la cohérence visuelle */}
          {timeTicks.map((t) => {
            const pct = ((t - tMin) / tRange) * 100
            if (pct < 0 || pct > 100) return null
            return (
              <div
                key={`grid-${t}`}
                className="pointer-events-none absolute inset-y-0"
                style={{ left: `${pct}%`, width: 0, borderLeft: '1px solid rgba(255,255,255,0.06)' }}
              />
            )
          })}

          {/* Curseur temps (survol) */}
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

          {/* Bandes de période (catégories visibles) — reportées du graphique */}
          {bands.map((b) => {
            const l = ((b.startMin - tMin) / tRange) * 100
            const w = ((b.endMin - b.startMin) / tRange) * 100
            if (l + w < 0 || l > 100) return null
            const left = Math.max(0, l)
            const width = Math.min(100 - left, w - (left - l))
            if (width <= 0) return null
            return (
              <div
                key={`band-${b.id}`}
                className="pointer-events-none absolute inset-y-0"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: hexA(b.color, 0.20),
                  borderLeft: `1px solid ${hexA(b.color, 0.5)}`,
                  borderRight: `1px solid ${hexA(b.color, 0.5)}`,
                }}
              >
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 whitespace-nowrap select-none"
                  style={{ fontSize: 8, color: b.color }}
                >
                  {b.label}
                </span>
              </div>
            )
          })}

          {/* Curseur de lecture audio — synchronisé avec le chart LAeq */}
          {playheadPct !== null && playheadPct >= 0 && playheadPct <= 100 && (
            <div
              className="pointer-events-none absolute inset-y-0"
              style={{ left: `${playheadPct}%`, width: 1, backgroundColor: 'rgba(255,255,255,0.85)' }}
            >
              <div
                className="absolute"
                style={{
                  top: -3, left: 0,
                  width: 6, height: 6, borderRadius: 9999,
                  backgroundColor: 'white',
                  transform: 'translateX(-50%)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                }}
              />
            </div>
          )}

          {/* Lignes verticales des événements */}
          {events.map((ev) => {
            const pct = ((ev.minutes - tMin) / tRange) * 100
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
  /** Multi-jours : aligne l'axe X sur le chart (0..N·1440 min, séparateurs à minuit) */
  multiDay?: boolean
  /** Position du curseur de lecture audio (minutes axe X chart) — affichée
   *  comme une ligne verticale blanche fine sur chaque canvas. */
  playheadMin?: number | null
  /** Modifie la plage de zoom partagée (Ctrl+molette sur le spectrogramme). */
  onZoomChange?: (range: ZoomRange | null) => void
  /** Périodes nommées — reportées comme bandes colorées (catégories visibles). */
  periods?: Period[]
  categories?: Category[]
}

/**
 * Ajuste le pas d'agrégation selon la plage temporelle visible pour garder
 * un spectrogramme lisible à tous les niveaux de zoom :
 *   - < 10 min visibles  → au plus fin (≤ 30 s)
 *   - > 2 h visibles     → ≥ 5 min par bucket (évite les ralentissements)
 *   - sinon              → suit le pas de la courbe LAeq
 */
function adaptiveAggSec(spanMin: number, baseAggSec: number): number {
  if (!Number.isFinite(spanMin) || spanMin <= 0) return baseAggSec
  if (spanMin < 10) return Math.min(baseAggSec, 30)
  if (spanMin > 120) return Math.max(baseAggSec, 300)
  return baseAggSec
}

export default function Spectrogram({
  files, pointMap, selectedDate, availableDates, onDateChange, events,
  periods, categories,
  zoomRange,
  aggregationSeconds = 300,
  compact = false,
  height,
  multiDay,
  playheadMin,
  onZoomChange,
}: Props) {
  const [minDb, setMinDb] = useState(30)
  const [maxDb, setMaxDb] = useState(90)
  const [mode, setMode] = useState<SpectroMode>('moyen')
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [palette, setPalette] = useState<SpectroPalette>(() => {
    try {
      const v = localStorage.getItem('acoustiq_spectro_palette') as SpectroPalette | null
      if (v && PALETTE_OPTIONS.some((o) => o.id === v)) return v
    } catch { /* ignore */ }
    return 'jet'
  })
  useEffect(() => {
    try { localStorage.setItem('acoustiq_spectro_palette', palette) } catch { /* ignore */ }
  }, [palette])

  // En mode multi-jours, les dates sont triées pour permettre un axe X
  // absolu (dayIndex × 1440 + t) cohérent avec le chart.
  const sortedDates = useMemo(() => [...availableDates].sort(), [availableDates])
  const isMulti = !!multiDay && sortedDates.length > 1

  // Fichiers actifs groupés par point — sur la date sélectionnée uniquement
  // (mode simple) ou sur TOUTES les dates disponibles (multi-jours).
  const filesByPoint = useMemo(() => {
    const map = new Map<string, Array<{ file: MeasurementFile; dayOffset: number }>>()
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt) continue
      let dayOffset = 0
      if (isMulti) {
        const idx = sortedDates.indexOf(f.date)
        if (idx < 0) continue
        dayOffset = idx * 1440
      } else {
        if (f.date !== selectedDate) continue
      }
      if (!map.has(pt)) map.set(pt, [])
      map.get(pt)!.push({ file: f, dayOffset })
    }
    return map
  }, [files, pointMap, selectedDate, isMulti, sortedDates])

  const pointNames = [...filesByPoint.keys()].sort()

  // Fréquences réelles des bandes spectrales — issues du parser via
  // file.spectraFreqs (831C : 27 bandes 50 Hz–20 kHz · 821SE : 26 bandes
  // 31.5 Hz–10 kHz). Fallback héritage si absent.
  const freqBandsFromFile = useMemo(() => {
    for (const fs of filesByPoint.values()) {
      for (const { file: f } of fs) {
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

  // Plage visible (avant aggregation) : utilisée pour la résolution adaptative.
  // Si zoomRange fourni → on l'utilise ; sinon on se base sur la plage des données.
  const visibleSpanMin = useMemo(() => {
    if (zoomRange) return Math.max(0, zoomRange.endMin - zoomRange.startMin)
    // Estimation globale : 1 jour ou N jours
    return isMulti ? sortedDates.length * 1440 : 1440
  }, [zoomRange, isMulti, sortedDates.length])

  const effectiveAggSec = useMemo(
    () => adaptiveAggSec(visibleSpanMin, aggregationSeconds),
    [visibleSpanMin, aggregationSeconds],
  )

  // Agrégation des spectres pour chaque point — applique l'A-weighting in-line
  // pour que tous les calculs aval (couleurs, légende dB, min/max) soient en
  // dB(A) cohérents entre 831C et 821SE. En mode multi-jours, les timestamps
  // sont décalés de dayOffset (minutes) pour l'axe X absolu du chart.
  const spectraByPoint = useMemo(() => {
    const m = new Map<string, Map<number, number[]>>()
    for (const [pt, fs] of filesByPoint) {
      const pointData = fs.flatMap(({ file: f, dayOffset }) =>
        dayOffset === 0
          ? f.data
          : f.data.map((dp) => ({ ...dp, t: dp.t + dayOffset })),
      )
      const raw = aggregateSpectra(pointData, effectiveAggSec, mode)
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
  }, [filesByPoint, effectiveAggSec, mode, aWeightVector])

  // Plage temporelle globale et nombre de bandes
  const { tMin, tMax, nBands, fullStart, fullEnd } = useMemo(() => {
    let mn = Infinity, mx = -Infinity, nb = 0
    for (const [, buckets] of spectraByPoint) {
      for (const [t, sp] of buckets) {
        mn = Math.min(mn, t); mx = Math.max(mx, t); nb = Math.max(nb, sp.length)
      }
    }
    // Appliquer le zoom si fourni
    const fallbackMax = isMulti ? sortedDates.length * 1440 : 1439
    const baseMn = mn === Infinity ? 0 : mn
    const baseMx = mx === -Infinity ? fallbackMax : mx
    return {
      tMin: zoomRange ? Math.max(baseMn, zoomRange.startMin) : baseMn,
      tMax: zoomRange ? Math.min(baseMx, zoomRange.endMin) : baseMx,
      nBands: nb,
      fullStart: baseMn,
      fullEnd: baseMx,
    }
  }, [spectraByPoint, zoomRange, isMulti, sortedDates.length])

  // ── Ctrl+molette → zoom (synchronisé avec le chart) ──────────────────────
  // Listener natif {passive:false} pour pouvoir preventDefault et empêcher le
  // zoom de page de Chrome. On preventDefault dès que Ctrl est pressé, même si
  // le zoom n'est pas pilotable (onZoomChange absent), pour ne jamais laisser
  // Chrome intercepter au-dessus du spectrogramme.
  const wheelWrapRef = useRef<HTMLDivElement>(null)
  const handleWheelZoom = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    if (!onZoomChange) return
    const rect = wheelWrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const plotW = Math.max(1, rect.width - Y_AXIS_W)
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - Y_AXIS_W) / plotW))
    const curStart = zoomRange ? Math.max(fullStart, zoomRange.startMin) : fullStart
    const curEnd = zoomRange ? Math.min(fullEnd, zoomRange.endMin) : fullEnd
    const span = curEnd - curStart
    const cursorMin = curStart + frac * span
    const globalSpan = fullEnd - fullStart || 1
    const factor = e.deltaY > 0 ? 1.3 : 0.7
    const newSpan = Math.max(2, Math.min(globalSpan, span * factor))
    if (newSpan >= globalSpan) { onZoomChange(null); return }
    let ns = cursorMin - frac * newSpan
    let ne = ns + newSpan
    if (ns < fullStart) { ns = fullStart; ne = ns + newSpan }
    if (ne > fullEnd) { ne = fullEnd; ns = ne - newSpan }
    onZoomChange({ startMin: Math.max(fullStart, ns), endMin: Math.min(fullEnd, ne) })
  }, [onZoomChange, zoomRange, fullStart, fullEnd])

  useEffect(() => {
    const el = wheelWrapRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheelZoom, { passive: false })
    return () => el.removeEventListener('wheel', handleWheelZoom)
  }, [handleWheelZoom])

  // Zones de discontinuité (> 60 min sans données) — reportées depuis le chart
  // en mode multi-jours. Dérivées à partir de l'union des buckets.
  const gapZones = useMemo<Array<{ start: number; end: number }>>(() => {
    if (!isMulti) return []
    const allTs = new Set<number>()
    for (const buckets of spectraByPoint.values()) {
      for (const t of buckets.keys()) allTs.add(t)
    }
    const sorted = [...allTs].sort((a, b) => a - b)
    const out: Array<{ start: number; end: number }> = []
    const aggMin = effectiveAggSec / 60
    const threshold = 60 // minutes
    for (let i = 1; i < sorted.length; i++) {
      const delta = sorted[i] - sorted[i - 1]
      if (delta > threshold) {
        out.push({ start: sorted[i - 1] + aggMin, end: sorted[i] })
      }
    }
    return out
  }, [spectraByPoint, isMulti, effectiveAggSec])

  // Liste des fréquences à afficher sur l'axe Y. Priorité au parser ; sinon
  // fallback historique sur les N dernières bandes de FREQ_BANDS_ALL.
  const freqBands = useMemo(() => {
    if (freqBandsFromFile && freqBandsFromFile.length === nBands) return freqBandsFromFile
    if (freqBandsFromFile) return freqBandsFromFile.slice(0, nBands)
    return FREQ_BANDS_ALL.slice(-Math.max(nBands, 1))
  }, [freqBandsFromFile, nBands])

  // Événements résolus sur l'axe X absolu du spectrogramme (en minutes).
  // En mode simple : jour sélectionné uniquement.
  // En mode multi-jours : tous les jours disponibles, décalés par dayIndex·1440.
  const activeEvents = useMemo<ResolvedEvent[]>(() => {
    if (isMulti) {
      return events
        .filter((ev) => sortedDates.includes(ev.day))
        .map((ev) => ({
          id: ev.id,
          label: ev.label,
          color: ev.color,
          minutes: sortedDates.indexOf(ev.day) * 1440 + hhmmToMin(ev.time),
        }))
    }
    return events
      .filter((ev) => ev.day === selectedDate)
      .map((ev) => ({
        id: ev.id,
        label: ev.label,
        color: ev.color,
        minutes: hhmmToMin(ev.time),
      }))
  }, [events, selectedDate, isMulti, sortedDates])

  // Bandes de période reportées sur le spectrogramme — seulement les catégories
  // visibles. Résolues sur l'axe X absolu (epoch → minutes, multi-jours géré).
  const activePeriods = useMemo<ResolvedBand[]>(() => {
    if (!periods || !categories) return []
    const catById = new Map(categories.map((c) => [c.id, c]))
    const out: ResolvedBand[] = []
    for (const p of periods) {
      const cat = catById.get(p.categoryId)
      if (!cat || !cat.visible) continue
      const d = new Date(p.startMs)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      const tStart = (p.startMs - midnight) / 60_000
      const tEnd = (p.endMs - midnight) / 60_000
      let offset = 0
      if (isMulti) {
        const idx = sortedDates.indexOf(iso)
        if (idx < 0) continue
        offset = idx * 1440
      } else if (iso !== selectedDate) {
        continue
      }
      out.push({ id: p.id, label: p.name, color: cat.color, startMin: offset + tStart, endMin: offset + tEnd })
    }
    return out
  }, [periods, categories, isMulti, sortedDates, selectedDate])

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
      <div className="flex items-center justify-center h-full text-gray-500 text-xs px-4 text-center">
        Aucune donnée spectrale dans le fichier importé
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
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-gray-500">Palette</span>
        <select
          value={palette}
          onChange={(e) => setPalette(e.target.value as SpectroPalette)}
          className="text-[10px] bg-gray-800 text-gray-100 border border-gray-600 rounded
                     px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          aria-label="Palette de couleurs"
          title="Palette de couleurs du spectrogramme"
        >
          {PALETTE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  )

  // ── Overlays communs : séparateurs de minuit + zones de discontinuité ────
  // Placés en pointer-events-none par dessus la colonne des canvas.
  const tRangeTotal = tMax - tMin || 1
  const midnightLines = isMulti
    ? sortedDates.map((_, i) => i).filter((i) => i > 0).map((i) => ({
        x: i * 1440,
        pct: ((i * 1440 - tMin) / tRangeTotal) * 100,
        label: sortedDates[i],
      })).filter((m) => m.pct > 0 && m.pct < 100)
    : []

  // ── Mode compact (embarqué sous le graphique) ────────────────────────────
  if (compact) {
    return (
      <div data-acoustiq-spectrogram="compact" className="flex flex-col h-full" style={height ? { height } : undefined}>
        <div className="flex items-center justify-end px-4 py-1 border-b border-gray-800/60 shrink-0 gap-3">
          {effectiveAggSec !== aggregationSeconds && (
            <span className="text-[10px] text-amber-400" title="Agrégation ajustée selon le niveau de zoom">
              ≈ {effectiveAggSec < 60 ? `${effectiveAggSec}s` : `${Math.round(effectiveAggSec / 60)} min`}
            </span>
          )}
          {headerControls}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="flex gap-0">
            <div ref={wheelWrapRef} className="relative flex-1 min-w-0">
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
                  bands={activePeriods}
                  onHoverTime={setHoverTime}
                  canvasHeight={perCanvasHeight}
                  aggSec={effectiveAggSec}
                  compact
                  playheadMin={playheadMin}
                  palette={palette}
                />
              ))}
              <XAxis tMin={tMin} tMax={tMax} />

              {/* Overlays multi-jours : séparateurs minuit + zones de discontinuité.
                  Positionnés dans la zone du canvas uniquement (décalage Y_AXIS_W à gauche). */}
              {isMulti && (
                <div
                  className="pointer-events-none absolute top-0 bottom-0"
                  style={{ left: Y_AXIS_W, right: 0 }}
                >
                  {gapZones.map((g, i) => {
                    const l = ((g.start - tMin) / tRangeTotal) * 100
                    const w = ((g.end - g.start) / tRangeTotal) * 100
                    if (l + w < 0 || l > 100) return null
                    return (
                      <div
                        key={`gap-${i}`}
                        className="absolute top-0 bottom-4"
                        style={{
                          left: `${Math.max(0, l)}%`,
                          width: `${Math.min(100 - Math.max(0, l), w)}%`,
                          backgroundColor: 'rgba(107, 114, 128, 0.35)',
                        }}
                      />
                    )
                  })}
                  {midnightLines.map((m) => (
                    <div
                      key={`mn-${m.x}`}
                      className="absolute top-0 bottom-4"
                      style={{
                        left: `${m.pct}%`,
                        width: 0,
                        borderLeft: '1px dashed rgba(255,255,255,0.45)',
                      }}
                      title={m.label}
                    />
                  ))}
                </div>
              )}
            </div>
            <ColorScaleLegend minDb={minDb} maxDb={maxDb} height={perCanvasHeight} palette={palette} />
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
          <div ref={wheelWrapRef} className="relative flex-1 min-w-0">
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
                bands={activePeriods}
                onHoverTime={setHoverTime}
                canvasHeight={DEFAULT_CANVAS_HEIGHT}
                aggSec={effectiveAggSec}
                playheadMin={playheadMin}
                palette={palette}
              />
            ))}
            <XAxis tMin={tMin} tMax={tMax} />
          </div>

          {/* Légende de couleur */}
          <ColorScaleLegend minDb={minDb} maxDb={maxDb} height={DEFAULT_CANVAS_HEIGHT} palette={palette} />
        </div>
      </div>
    </div>
  )
}
