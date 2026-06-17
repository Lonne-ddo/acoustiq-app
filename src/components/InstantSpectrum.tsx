/**
 * Spectre instantané — barres 1/3 d'octave à un instant (suivi du curseur /
 * lecture audio) ou moyennées sur une période, avec pondération Z/A/C,
 * marqueurs LFmin/LFmax (mode plage), figer/comparer et export PNG/CSV/Excel.
 *
 * Synchronisé via `instantMin` (minutes axe X absolu du graphique LAeq).
 */
import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { Download, Snowflake, ChevronDown, ChevronUp } from 'lucide-react'
import type { MeasurementFile, Period } from '../types'
import {
  buildSpectraSamples, spectrumAtInstant, spectrumOverRange, applyWeighting,
  freqAxisLabel, type Weighting, type SpectraSample,
} from '../utils/spectrumCompute'

// Couleurs par point — alignées avec TimeSeriesChart / Spectrogram.
const POINT_COLORS: Record<string, string> = {
  'BV-94': '#10b981', 'BV-98': '#3b82f6', 'BV-105': '#f59e0b',
  'BV-106': '#ef4444', 'BV-37': '#8b5cf6', 'BV-107': '#06b6d4',
}
const FALLBACK = ['#ec4899', '#84cc16', '#f97316', '#a78bfa']
const ptColor = (pt: string, i: number) => POINT_COLORS[pt] ?? FALLBACK[i % FALLBACK.length]

// Fréquences principales étiquetées sur l'axe X.
const X_LABEL_SET = new Set([6.3, 20, 63, 200, 630, 2000, 6300, 20000])

const PAD_L = 56, PAD_R = 14, PAD_T = 10, PAD_B = 28

interface PointSeries {
  pt: string
  color: string
  leq: number[]
  min: number[] | null
  max: number[] | null
}

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  availableDates: string[]
  multiDay?: boolean
  /** Position de lecture audio (minutes axe X absolu) — prioritaire sur le survol. */
  audioPlayheadMin?: number | null
  audioPlaying?: boolean
  periods: Period[]
  /** Hauteur totale du panneau (px). */
  height: number
  /** Masquage de points (partagé avec le graphique). */
  hiddenPoints?: string[]
}

function isoFromMs(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function dateMsAtMidnight(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return NaN
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)).getTime()
}
function fmtClock(tMin: number, withSec = true): string {
  const total = Math.round(tMin * 60)
  const h = Math.floor(total / 3600) % 24
  const mi = Math.floor((total % 3600) / 60)
  const s = total % 60
  return withSec
    ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

export default function InstantSpectrum({
  files, pointMap, selectedDate, availableDates, multiDay,
  audioPlayheadMin, audioPlaying, periods, height, hiddenPoints,
}: Props) {
  const [open, setOpen] = useState(true)
  // Survol du graphique LAeq reçu via CustomEvent (throttle rAF côté chart) —
  // isolé ici pour ne pas re-rendre le graphique principal. Au mouseleave
  // (detail null), on temporise 500 ms avant de revenir au spectre moyen, pour
  // éviter les flashs quand le curseur traverse brièvement une zone vide.
  const [hoverMin, setHoverMin] = useState<number | null>(null)
  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | null = null
    const onHover = (e: Event) => {
      const v = (e as CustomEvent).detail as number | null
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
      if (v === null) {
        clearTimer = setTimeout(() => setHoverMin(null), 500)
      } else {
        setHoverMin(v)
      }
    }
    document.addEventListener('acoustiq:spectrum-hover', onHover)
    return () => {
      document.removeEventListener('acoustiq:spectrum-hover', onHover)
      if (clearTimer) clearTimeout(clearTimer)
    }
  }, [])
  // Lecture audio prioritaire sur le survol.
  const instantMin = audioPlaying && audioPlayheadMin != null ? audioPlayheadMin : hoverMin
  const instantSource: 'hover' | 'audio' = audioPlaying && audioPlayheadMin != null ? 'audio' : 'hover'
  const [mode, setMode] = useState<'cursor' | string>('cursor') // 'cursor' ou id de période
  const [weighting, setWeighting] = useState<Weighting>('Z')
  const [minDb, setMinDb] = useState(30)
  const [maxDb, setMaxDb] = useState(90)
  const [showMinMax, setShowMinMax] = useState(false)
  const [frozen, setFrozen] = useState<{ series: PointSeries[]; freqs: number[]; title: string } | null>(null)
  const [localHidden, setLocalHidden] = useState<Set<string>>(new Set())

  const sortedDates = useMemo(() => [...availableDates].sort(), [availableDates])
  const isMulti = !!multiDay && sortedDates.length > 1

  // Points actifs (assignés). En multi-jours, tous les jours ; sinon date active.
  const pointNames = useMemo(() => {
    const s = new Set<string>()
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt) continue
      if (isMulti || f.date === selectedDate) s.add(pt)
    }
    return [...s].sort()
  }, [files, pointMap, selectedDate, isMulti])

  const hidden = useMemo(() => {
    const s = new Set(localHidden)
    for (const h of hiddenPoints ?? []) s.add(h)
    return s
  }, [localHidden, hiddenPoints])

  // Échantillons spectraux par (point, date) — précalculés une fois.
  const samplesByPointDate = useMemo(() => {
    const m = new Map<string, SpectraSample[]>()
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt) continue
      const key = `${pt}|${f.date}`
      const prev = m.get(key)
      const built = buildSpectraSamples(f.data)
      m.set(key, prev ? [...prev, ...built].sort((a, b) => a.t - b.t) : built)
    }
    return m
  }, [files, pointMap])

  // Fréquences de référence : le spectraFreqs le plus complet parmi les points visibles.
  const refFreqs = useMemo<number[]>(() => {
    let best: number[] = []
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt || hidden.has(pt)) continue
      if (f.spectraFreqs && f.spectraFreqs.length > best.length) best = f.spectraFreqs
    }
    return best
  }, [files, pointMap, hidden])

  // Résolution de l'instant/plage actif → titre + séries par point.
  const { series, title, exportLabel } = useMemo<{ series: PointSeries[]; title: string; exportLabel: string }>(() => {
    const visiblePts = pointNames.filter((pt) => !hidden.has(pt))

    // MODE PLAGE : une période sélectionnée
    if (mode !== 'cursor') {
      const p = periods.find((x) => x.id === mode)
      if (!p) return { series: [], title: 'Spectre — période introuvable', exportLabel: 'spectre' }
      const date = isoFromMs(p.startMs)
      const midnight = dateMsAtMidnight(date)
      const tStart = (p.startMs - midnight) / 60_000
      const tEnd = (p.endMs - midnight) / 60_000
      const out: PointSeries[] = []
      for (let i = 0; i < visiblePts.length; i++) {
        const pt = visiblePts[i]
        const samples = samplesByPointDate.get(`${pt}|${date}`)
        if (!samples) continue
        const r = spectrumOverRange(samples, tStart, tEnd)
        if (!r) continue
        out.push({
          pt, color: ptColor(pt, pointNames.indexOf(pt)),
          leq: applyWeighting(r.leq, refFreqs, weighting),
          min: applyWeighting(r.min, refFreqs, weighting),
          max: applyWeighting(r.max, refFreqs, weighting),
        })
      }
      const title = `Spectre moyen sur ${p.name} (${fmtClock(tStart, false)} → ${fmtClock(tEnd, false)})`
      return { series: out, title, exportLabel: `spectre_${p.name}` }
    }

    // MODE MOYEN PAR DÉFAUT : aucun survol → spectre moyen énergétique sur toute
    // la durée du fichier visible (toutes les dates en multi-jours, sinon la date
    // active). On bascule automatiquement vers l'instantané dès que l'utilisateur
    // survole le graphique LAeq.
    if (instantMin === null) {
      const datesToUse = isMulti ? sortedDates : [selectedDate]
      const out: PointSeries[] = []
      for (const pt of visiblePts) {
        let merged: SpectraSample[] = []
        for (const d of datesToUse) {
          const s = samplesByPointDate.get(`${pt}|${d}`)
          if (s) merged = merged.concat(s)
        }
        if (merged.length === 0) continue
        const r = spectrumOverRange(merged, -Infinity, Infinity)
        if (!r) continue
        out.push({
          pt, color: ptColor(pt, pointNames.indexOf(pt)),
          leq: applyWeighting(r.leq, refFreqs, weighting),
          min: null, max: null,
        })
      }
      return {
        series: out,
        title: 'Spectre moyen du fichier (durée totale)',
        exportLabel: 'spectre_moyen',
      }
    }
    const dayIndex = isMulti ? Math.floor(instantMin / 1440) : 0
    const date = isMulti ? (sortedDates[dayIndex] ?? selectedDate) : selectedDate
    const tIn = isMulti ? instantMin - dayIndex * 1440 : instantMin
    const out: PointSeries[] = []
    for (const pt of visiblePts) {
      const samples = samplesByPointDate.get(`${pt}|${date}`)
      if (!samples) continue
      const sp = spectrumAtInstant(samples, tIn)
      if (!sp) continue
      out.push({ pt, color: ptColor(pt, pointNames.indexOf(pt)), leq: applyWeighting(sp, refFreqs, weighting), min: null, max: null })
    }
    const clock = fmtClock(tIn)
    const title = instantSource === 'audio' ? `Spectre en lecture (${clock})` : `Spectre à ${clock}`
    return { series: out, title, exportLabel: `spectre_${clock.replace(/:/g, '')}` }
  }, [mode, periods, instantMin, instantSource, isMulti, sortedDates, selectedDate, pointNames, hidden, samplesByPointDate, refFreqs, weighting])

  // ── Auto échelle dB ────────────────────────────────────────────────────────
  const autoScale = useCallback(() => {
    let lo = Infinity, hi = -Infinity
    const consider = (arr: number[] | null) => {
      if (!arr) return
      for (const v of arr) { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v } }
    }
    for (const s of [...series, ...(frozen?.series ?? [])]) { consider(s.leq); consider(s.min); consider(s.max) }
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      setMinDb(Math.floor((lo - 3) / 5) * 5)
      setMaxDb(Math.ceil((hi + 3) / 5) * 5)
    }
  }, [series, frozen])

  // ── Dessin canvas ──────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(0)
  const canvasH = Math.max(70, height - 62) // - en-tête - barre de contrôle

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setCanvasW(Math.floor(el.clientWidth)))
    obs.observe(el)
    setCanvasW(Math.floor(el.clientWidth))
    return () => obs.disconnect()
  }, [])

  const draw = useCallback((ctx: CanvasRenderingContext2D, W: number, H: number) => {
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(PAD_L, PAD_T, W - PAD_L - PAD_R, H - PAD_T - PAD_B)

    const freqs = refFreqs.length ? refFreqs : (frozen?.freqs ?? [])
    const N = freqs.length
    if (N === 0) return
    const plotW = W - PAD_L - PAD_R
    const plotH = H - PAD_T - PAD_B
    const dbRange = (maxDb - minDb) || 1
    const yOf = (v: number) => PAD_T + (1 - (v - minDb) / dbRange) * plotH
    const groupW = plotW / N

    // Grille + axe Y (tous les 10 dB), labels 11px
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.fillStyle = '#9ca3af'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const loTick = Math.ceil(minDb / 10) * 10
    for (let v = loTick; v <= maxDb; v += 10) {
      const y = yOf(v)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke()
      ctx.fillStyle = '#9ca3af'
      ctx.fillText(String(v), PAD_L - 6, y)
    }

    // Titre vertical « Niveau (dB) » à gauche (rotation -90°)
    ctx.save()
    ctx.translate(11, PAD_T + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#6b7280'
    ctx.fillText('Niveau (dB)', 0, 0)
    ctx.restore()

    // Axe X (labels principaux), 11px
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    freqs.forEach((f, i) => {
      if (!X_LABEL_SET.has(f)) return
      const x = PAD_L + (i + 0.5) * groupW
      ctx.fillStyle = '#9ca3af'
      ctx.fillText(freqAxisLabel(f), x, H - PAD_B + 6)
    })

    const drawSeries = (list: PointSeries[], opts: { alpha: number; grey?: boolean }) => {
      const n = list.length || 1
      const slot = Math.min(groupW * 0.8, groupW * 0.8)
      const barW = Math.max(1, slot / n)
      list.forEach((s, j) => {
        ctx.globalAlpha = opts.alpha
        ctx.fillStyle = opts.grey ? '#9ca3af' : s.color
        for (let i = 0; i < N; i++) {
          const v = s.leq[i]
          if (!Number.isFinite(v)) continue
          const x = PAD_L + i * groupW + (groupW - slot) / 2 + j * barW
          const y = yOf(v)
          const h = Math.max(0, PAD_T + plotH - y)
          ctx.fillRect(x, y, Math.max(1, barW - 0.5), h)
        }
        // Marqueurs LFmin / LFmax (mode plage)
        if (!opts.grey && showMinMax && s.min && s.max) {
          for (let i = 0; i < N; i++) {
            const x = PAD_L + i * groupW + (groupW - slot) / 2 + j * barW + barW / 2
            const w = Math.max(2, barW * 0.7)
            if (Number.isFinite(s.max[i])) {
              ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5
              const y = yOf(s.max[i]); ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x + w / 2, y); ctx.stroke()
            }
            if (Number.isFinite(s.min[i])) {
              ctx.strokeStyle = '#eab308'; ctx.lineWidth = 1.5
              const y = yOf(s.min[i]); ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x + w / 2, y); ctx.stroke()
            }
          }
        }
      })
      ctx.globalAlpha = 1
    }

    // Spectre figé (gris, derrière) puis spectre courant (couleur).
    if (frozen) drawSeries(frozen.series, { alpha: 0.4, grey: true })
    drawSeries(series, { alpha: frozen ? 0.95 : 0.9 })
  }, [refFreqs, frozen, minDb, maxDb, series, showMinMax])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasW === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasW * dpr
    canvas.height = canvasH * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, canvasW, canvasH)
  }, [canvasW, canvasH, draw])

  // ── Figer / dégeler ──────────────────────────────────────────────────────
  const toggleFreeze = useCallback(() => {
    if (frozen) { setFrozen(null); return }
    if (series.length === 0) return
    setFrozen({ series: series.map((s) => ({ ...s, leq: [...s.leq], min: s.min ? [...s.min] : null, max: s.max ? [...s.max] : null })), freqs: [...refFreqs], title })
  }, [frozen, series, refFreqs, title])

  // ── Exports ───────────────────────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false)
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
  }
  const exportPNG = () => {
    const scale = 2
    const W = canvasW || 600, H = canvasH
    const off = document.createElement('canvas')
    off.width = W * scale; off.height = H * scale
    const ctx = off.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.fillStyle = '#030712'; ctx.fillRect(0, 0, W, H)
    draw(ctx, W, H)
    off.toBlob((b) => { if (b) download(b, `${exportLabel}.png`) })
    setExportOpen(false)
  }
  const buildRows = () => {
    const freqs = refFreqs
    const header = ['Fréquence (Hz)']
    for (const s of series) header.push(`${s.pt} Leq`, `${s.pt} LFmin`, `${s.pt} LFmax`)
    const rows: (string | number)[][] = [header]
    freqs.forEach((f, i) => {
      const row: (string | number)[] = [f]
      for (const s of series) {
        row.push(
          Number.isFinite(s.leq[i]) ? Math.round(s.leq[i] * 10) / 10 : '',
          s.min && Number.isFinite(s.min[i]) ? Math.round(s.min[i] * 10) / 10 : '',
          s.max && Number.isFinite(s.max[i]) ? Math.round(s.max[i] * 10) / 10 : '',
        )
      }
      rows.push(row)
    })
    return rows
  }
  const exportCSV = () => {
    const rows = buildRows()
    const csv = '﻿' + rows.map((r) => r.join(';')).join('\n')
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${exportLabel}.csv`)
    setExportOpen(false)
  }
  const exportXLSX = () => {
    const ws = XLSX.utils.aoa_to_sheet(buildRows())
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Spectre')
    XLSX.writeFile(wb, `${exportLabel}.xlsx`)
    setExportOpen(false)
  }

  const periodOptions = useMemo(() => periods.filter((p) => p.name), [periods])

  return (
    <div className="border-t border-gray-800 bg-gray-900/40 flex flex-col" style={{ height: open ? height : undefined }}>
      {/* En-tête collapsible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 transition-colors shrink-0"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        <span className="font-semibold uppercase tracking-wider">Spectre instantané</span>
        <span className="text-gray-600 normal-case font-normal truncate">— {title}</span>
      </button>

      {open && (
        <>
          {/* Barre de contrôle */}
          <div className="flex items-center gap-2 flex-wrap px-4 py-1 border-b border-gray-800/60 shrink-0 text-[10px]">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="bg-gray-800 text-gray-100 border border-gray-600 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              title="Mode de calcul"
            >
              <option value="cursor">Suivi curseur</option>
              {periodOptions.map((p) => <option key={p.id} value={p.id}>Moyenne : {p.name}</option>)}
            </select>

            <div className="flex items-center gap-0.5">
              <span className="text-gray-500 mr-0.5">Pond.</span>
              {(['Z', 'A', 'C'] as Weighting[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setWeighting(w)}
                  className={`px-1.5 py-0.5 rounded ${weighting === w ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >{w}</button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-gray-500">dB</span>
              <input type="number" value={minDb} onChange={(e) => setMinDb(Number(e.target.value))}
                className="w-10 text-center bg-gray-800 text-gray-100 border border-gray-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500" aria-label="Min dB" />
              <span className="text-gray-600">–</span>
              <input type="number" value={maxDb} onChange={(e) => setMaxDb(Number(e.target.value))}
                className="w-10 text-center bg-gray-800 text-gray-100 border border-gray-600 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500" aria-label="Max dB" />
              <button onClick={autoScale} className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700">Auto</button>
            </div>

            <label className="flex items-center gap-1 text-gray-400 cursor-pointer">
              <input type="checkbox" checked={showMinMax} onChange={(e) => setShowMinMax(e.target.checked)} className="accent-emerald-500" />
              LFmin/LFmax
            </label>

            <button
              onClick={toggleFreeze}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${frozen ? 'bg-sky-800 border-sky-600 text-sky-100' : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'}`}
              title={frozen ? 'Reprendre le suivi' : 'Figer le spectre courant pour comparer'}
            >
              <Snowflake size={11} /> {frozen ? 'Dégeler' : 'Figer'}
            </button>

            {/* Légende multi-points compacte (clic = masquer/afficher) */}
            {pointNames.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap pl-1 border-l border-gray-700/60">
                {pointNames.map((pt, i) => {
                  const isHidden = hidden.has(pt)
                  return (
                    <button
                      key={pt}
                      onClick={() => setLocalHidden((prev) => { const n = new Set(prev); if (n.has(pt)) n.delete(pt); else n.add(pt); return n })}
                      className={`flex items-center gap-1 ${isHidden ? 'opacity-40' : ''}`}
                      title={isHidden ? 'Afficher' : 'Masquer'}
                    >
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: ptColor(pt, i) }} />
                      <span className="text-gray-300">{pt}</span>
                    </button>
                  )
                })}
                {frozen && <span className="flex items-center gap-1 text-gray-500"><span className="w-2.5 h-2.5 rounded-sm bg-gray-400/50" /> figé</span>}
              </div>
            )}

            <div className="relative ml-auto">
              <button onClick={() => setExportOpen((v) => !v)} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-600">
                <Download size={11} /> Exporter
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full mt-1 z-30 bg-gray-900 border border-gray-700 rounded shadow-xl py-1 w-24">
                  <button onClick={exportPNG} className="w-full text-left px-2 py-1 hover:bg-gray-800 text-gray-200">PNG</button>
                  <button onClick={exportCSV} className="w-full text-left px-2 py-1 hover:bg-gray-800 text-gray-200">CSV</button>
                  <button onClick={exportXLSX} className="w-full text-left px-2 py-1 hover:bg-gray-800 text-gray-200">Excel</button>
                </div>
              )}
            </div>
          </div>

          {/* Graphique */}
          <div ref={containerRef} className="flex-1 min-h-0 px-2 pt-1">
            {refFreqs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-[11px] text-gray-500">
                Aucune donnée spectrale dans le fichier importé
              </div>
            ) : (
              <canvas ref={canvasRef} className="block w-full" style={{ height: canvasH, backgroundColor: '#030712', borderRadius: 4 }} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
