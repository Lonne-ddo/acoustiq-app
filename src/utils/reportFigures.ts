/**
 * Génération de figures PNG « prêtes à insérer dans un rapport ».
 * Toutes les figures sont rendues sur fond clair (impression A4) via l'API
 * Canvas — pas de dépendance DOM, donc utilisable depuis n'importe quel onglet.
 *
 * Bundlées dans un ZIP par le bouton « Exporter figures » du Rapport.
 */
import type {
  MeasurementFile,
  SourceEvent,
  ConformiteSummary,
  DataPoint,
} from '../types'
import {
  laeqAvg,
  computeL10,
  computeL50,
  computeL90,
  computeLAFmax,
  computeLAFmin,
  THIRD_OCTAVE_CENTERS,
} from './acoustics'

// ─── Constantes de mise en page (dimensions logiques en px @ 150 DPI) ───────
const FIG_W = 1200
const FIG_H = 600
const PAD = { top: 60, right: 40, bottom: 70, left: 70 }

const POINT_PALETTE: Record<string, string> = {
  'BV-94': '#059669', 'BV-98': '#2563eb', 'BV-105': '#d97706',
  'BV-106': '#dc2626', 'BV-37': '#7c3aed', 'BV-107': '#0891b2',
}
const FALLBACK = ['#db2777', '#65a30d', '#ea580c', '#7c3aed']
function pointColor(pt: string, i: number): string {
  return POINT_PALETTE[pt] ?? FALLBACK[i % FALLBACK.length]
}

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60) % 24
  const mm = Math.round(m % 60)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// ─── Footer commun ──────────────────────────────────────────────────────────
function drawFooter(ctx: CanvasRenderingContext2D, _w: number, h: number) {
  ctx.fillStyle = '#9ca3af'
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(
    'Généré par AcoustiQ — https://acoustiq-app.pages.dev   ·   Lignes directrices MELCCFP 2026',
    PAD.left,
    h - 12,
  )
}

function drawTitle(ctx: CanvasRenderingContext2D, title: string) {
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 18px system-ui, sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(title, PAD.left, 18)
}

function fillBg(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
}

// ─── Figure 1 — Courbe temporelle ───────────────────────────────────────────
export interface FigureCourbeOptions {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  events: SourceEvent[]
  number: number
}

export function drawFigureCourbe(opts: FigureCourbeOptions): HTMLCanvasElement {
  const { files, pointMap, selectedDate, events, number } = opts
  const canvas = document.createElement('canvas')
  canvas.width = FIG_W
  canvas.height = FIG_H
  const ctx = canvas.getContext('2d')!
  fillBg(ctx, FIG_W, FIG_H)

  // Regroupement par point
  const byPoint = new Map<string, DataPoint[]>()
  for (const f of files) {
    const pt = pointMap[f.id]
    if (!pt || f.date !== selectedDate) continue
    const arr = byPoint.get(pt) ?? []
    arr.push(...f.data)
    byPoint.set(pt, arr)
  }
  const pointNames = [...byPoint.keys()].sort()

  // Plages
  let tMin = Infinity, tMax = -Infinity, yMin = Infinity, yMax = -Infinity
  for (const dps of byPoint.values()) {
    for (const d of dps) {
      if (d.t < tMin) tMin = d.t
      if (d.t > tMax) tMax = d.t
      if (d.laeq < yMin) yMin = d.laeq
      if (d.laeq > yMax) yMax = d.laeq
    }
  }
  if (!Number.isFinite(tMin)) { tMin = 0; tMax = 1440 }
  if (!Number.isFinite(yMin)) { yMin = 30; yMax = 90 }
  yMin = Math.floor(yMin - 5)
  yMax = Math.ceil(yMax + 5)

  drawTitle(ctx, `Figure ${number} — Niveaux sonores mesurés — ${selectedDate}`)

  // Cadre
  const plotX = PAD.left
  const plotY = PAD.top
  const plotW = FIG_W - PAD.left - PAD.right
  const plotH = FIG_H - PAD.top - PAD.bottom
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1
  ctx.strokeRect(plotX, plotY, plotW, plotH)

  // Grille + ticks Y
  ctx.fillStyle = '#475569'
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'right'
  const yTicks = 6
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks
    const y = plotY + plotH - (plotH * i) / yTicks
    ctx.strokeStyle = '#e5e7eb'
    ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke()
    ctx.fillText(`${Math.round(v)}`, plotX - 6, y)
  }
  // Label Y
  ctx.save()
  ctx.translate(20, plotY + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.fillText('Niveau sonore LAeq (dB(A))', 0, 0)
  ctx.restore()

  // Ticks X (toutes les 2 h ou auto)
  const tSpan = tMax - tMin
  const tickStep = tSpan > 360 ? 120 : tSpan > 60 ? 30 : 10
  ctx.fillStyle = '#475569'
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  for (let t = Math.ceil(tMin / tickStep) * tickStep; t <= tMax; t += tickStep) {
    const x = plotX + ((t - tMin) / tSpan) * plotW
    ctx.strokeStyle = '#e5e7eb'
    ctx.beginPath(); ctx.moveTo(x, plotY); ctx.lineTo(x, plotY + plotH); ctx.stroke()
    ctx.fillText(minutesToHHMM(t), x, plotY + plotH + 6)
  }
  ctx.fillStyle = '#0f172a'
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.fillText('Heure', plotX + plotW / 2, plotY + plotH + 28)

  // Courbes
  pointNames.forEach((pt, idx) => {
    const dps = (byPoint.get(pt) ?? []).slice().sort((a, b) => a.t - b.t)
    if (dps.length === 0) return
    ctx.strokeStyle = pointColor(pt, idx)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    dps.forEach((d, i) => {
      const x = plotX + ((d.t - tMin) / tSpan) * plotW
      const y = plotY + plotH - ((d.laeq - yMin) / (yMax - yMin)) * plotH
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  })

  // Événements (lignes verticales)
  const dayEvents = events.filter((ev) => ev.day === selectedDate)
  for (const ev of dayEvents) {
    const [hStr, mStr] = ev.time.split(':')
    const tEv = parseInt(hStr || '0', 10) * 60 + parseInt(mStr || '0', 10)
    if (tEv < tMin || tEv > tMax) continue
    const x = plotX + ((tEv - tMin) / tSpan) * plotW
    ctx.strokeStyle = ev.color
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, plotY); ctx.lineTo(x, plotY + plotH); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = ev.color
    ctx.font = '9px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(ev.label, x + 3, plotY + 4)
  }

  // Légende
  let lx = plotX + 6
  const ly = plotY + 6
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  pointNames.forEach((pt, idx) => {
    const color = pointColor(pt, idx)
    ctx.fillStyle = color
    ctx.fillRect(lx, ly, 10, 10)
    ctx.fillStyle = '#0f172a'
    ctx.textAlign = 'left'
    ctx.fillText(pt, lx + 14, ly + 5)
    lx += ctx.measureText(pt).width + 30
  })

  drawFooter(ctx, FIG_W, FIG_H)
  return canvas
}

// ─── Figure 2 — Spectrogramme ───────────────────────────────────────────────
const V_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 145, 140]],
  [0.75, [92, 200, 99]], [1.0, [253, 231, 37]],
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

export interface FigureSpectroOptions {
  pointName: string
  data: DataPoint[]
  selectedDate: string
  number: number
  aggSec?: number
}

export function drawFigureSpectrogramme(opts: FigureSpectroOptions): HTMLCanvasElement | null {
  const { pointName, data, selectedDate, number, aggSec = 300 } = opts
  // Vérifier qu'il existe des spectres
  if (!data.some((d) => d.spectra && d.spectra.length > 0)) return null

  const canvas = document.createElement('canvas')
  canvas.width = FIG_W
  canvas.height = FIG_H
  const ctx = canvas.getContext('2d')!
  fillBg(ctx, FIG_W, FIG_H)
  drawTitle(ctx, `Figure ${number} — Spectrogramme — ${pointName} — ${selectedDate}`)

  // Bucket → moyenne énergétique par bande
  const buckets = new Map<number, { pow: number[]; n: number }>()
  let nBands = 0
  let tMin = Infinity, tMax = -Infinity
  for (const dp of data) {
    if (!dp.spectra?.length) continue
    nBands = Math.max(nBands, dp.spectra.length)
    const tSec = Math.round(dp.t * 60)
    const bSec = Math.floor(tSec / aggSec) * aggSec
    const bMin = bSec / 60
    if (bMin < tMin) tMin = bMin
    if (bMin > tMax) tMax = bMin
    if (!buckets.has(bMin)) buckets.set(bMin, { pow: new Array(dp.spectra.length).fill(0), n: 0 })
    const b = buckets.get(bMin)!
    dp.spectra.forEach((v, i) => { b.pow[i] += Math.pow(10, v / 10) })
    b.n++
  }
  if (nBands === 0 || !Number.isFinite(tMin)) return null

  const sorted = [...buckets.entries()].sort(([a], [b]) => a - b).map(
    ([t, b]) => [t, b.pow.map((p) => 10 * Math.log10(p / b.n))] as [number, number[]],
  )

  // Plage dB pour la palette
  let dbMin = Infinity, dbMax = -Infinity
  for (const [, sp] of sorted) for (const v of sp) {
    if (v < dbMin) dbMin = v
    if (v > dbMax) dbMax = v
  }
  if (!Number.isFinite(dbMin)) { dbMin = 30; dbMax = 90 }
  dbMin = Math.floor(dbMin)
  dbMax = Math.ceil(dbMax)

  const plotX = PAD.left
  const plotY = PAD.top
  const plotW = FIG_W - PAD.left - PAD.right - 80 // garde place pour la légende couleur
  const plotH = FIG_H - PAD.top - PAD.bottom

  // Heatmap basse résolution puis remise à l'échelle
  const tmp = document.createElement('canvas')
  tmp.width = sorted.length
  tmp.height = nBands
  const tctx = tmp.getContext('2d')!
  const img = tctx.createImageData(sorted.length, nBands)
  sorted.forEach(([, sp], ti) => {
    const n = Math.min(sp.length, nBands)
    for (let bi = 0; bi < n; bi++) {
      const row = nBands - 1 - bi
      const norm = (sp[bi] - dbMin) / Math.max(1, dbMax - dbMin)
      const [r, g, b] = viridis(norm)
      const idx = (row * sorted.length + ti) * 4
      img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255
    }
  })
  tctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, plotX, plotY, plotW, plotH)
  ctx.strokeStyle = '#0f172a'
  ctx.strokeRect(plotX, plotY, plotW, plotH)

  // Axe Y : étiquettes de fréquence
  const freqs = THIRD_OCTAVE_CENTERS.slice(-nBands)
  const labelSet = new Set([100, 250, 500, 1000, 2000, 4000, 8000, 16000])
  ctx.fillStyle = '#0f172a'
  ctx.font = '10px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'right'
  freqs.forEach((f, bi) => {
    if (!labelSet.has(f)) return
    const y = plotY + plotH - ((bi + 0.5) / nBands) * plotH
    const label = f >= 1000 ? `${f / 1000}k` : String(f)
    ctx.fillText(label, plotX - 6, y)
  })
  // Label axe Y
  ctx.save()
  ctx.translate(18, plotY + plotH / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.fillText('Fréquence (Hz)', 0, 0)
  ctx.restore()

  // Axe X : heures
  const tSpan = Math.max(1, tMax - tMin)
  const step = tSpan > 360 ? 120 : tSpan > 60 ? 30 : 10
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let t = Math.ceil(tMin / step) * step; t <= tMax; t += step) {
    const x = plotX + ((t - tMin) / tSpan) * plotW
    ctx.strokeStyle = '#0f172a'
    ctx.beginPath(); ctx.moveTo(x, plotY + plotH); ctx.lineTo(x, plotY + plotH + 4); ctx.stroke()
    ctx.fillStyle = '#0f172a'
    ctx.fillText(minutesToHHMM(t), x, plotY + plotH + 6)
  }
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.fillText('Heure', plotX + plotW / 2, plotY + plotH + 24)

  // Légende couleur (à droite)
  const legX = plotX + plotW + 16
  const legW = 14
  const legImg = ctx.createImageData(legW, plotH)
  for (let y = 0; y < plotH; y++) {
    const [r, g, b] = viridis(1 - y / Math.max(plotH - 1, 1))
    for (let x = 0; x < legW; x++) {
      const i = (y * legW + x) * 4
      legImg.data[i] = r; legImg.data[i + 1] = g; legImg.data[i + 2] = b; legImg.data[i + 3] = 255
    }
  }
  ctx.putImageData(legImg, legX, plotY)
  ctx.strokeStyle = '#0f172a'
  ctx.strokeRect(legX, plotY, legW, plotH)
  ctx.fillStyle = '#0f172a'
  ctx.font = '10px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${dbMax} dB`, legX + legW + 4, plotY + 6)
  ctx.fillText(`${dbMin} dB`, legX + legW + 4, plotY + plotH - 6)

  drawFooter(ctx, FIG_W, FIG_H)
  return canvas
}

// ─── Figure 3 — Indices acoustiques ─────────────────────────────────────────
export interface FigureIndicesOptions {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  number: number
}

export function drawFigureIndices(opts: FigureIndicesOptions): HTMLCanvasElement {
  const { files, pointMap, selectedDate, number } = opts
  const canvas = document.createElement('canvas')
  canvas.width = FIG_W
  canvas.height = FIG_H
  const ctx = canvas.getContext('2d')!
  fillBg(ctx, FIG_W, FIG_H)
  drawTitle(ctx, `Figure ${number} — Indices acoustiques — ${selectedDate}`)

  // Calcul des indices par point
  const points = new Set<string>()
  for (const f of files) {
    if (pointMap[f.id] && f.date === selectedDate) points.add(pointMap[f.id])
  }
  const pointNames = [...points].sort()
  const indices = pointNames.map((pt) => {
    const vals = files
      .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
      .flatMap((f) => f.data)
      .map((d) => d.laeq)
    if (vals.length === 0) return null
    return {
      laeq: laeqAvg(vals),
      l10: computeL10(vals),
      l50: computeL50(vals),
      l90: computeL90(vals),
      lafmax: computeLAFmax(vals),
      lafmin: computeLAFmin(vals),
    }
  })

  const rows = ['LAeq', 'L10', 'L50', 'L90', 'LAFmax', 'LAFmin'] as const
  const keys = ['laeq', 'l10', 'l50', 'l90', 'lafmax', 'lafmin'] as const

  // Tableau centré
  const tableX = PAD.left + 20
  const tableY = PAD.top + 20
  const colW = 140
  const rowH = 38
  const headerH = 44
  const tableW = colW * (1 + pointNames.length)

  // En-tête
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(tableX, tableY, tableW, headerH)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 14px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('Indice', tableX + 16, tableY + headerH / 2)
  pointNames.forEach((pt, i) => {
    ctx.textAlign = 'center'
    ctx.fillStyle = pointColor(pt, i)
    ctx.fillText(pt, tableX + colW + i * colW + colW / 2, tableY + headerH / 2)
  })

  // Lignes
  ctx.font = '13px system-ui, sans-serif'
  rows.forEach((row, ri) => {
    const y = tableY + headerH + ri * rowH
    ctx.fillStyle = ri % 2 === 0 ? '#f8fafc' : '#ffffff'
    ctx.fillRect(tableX, y, tableW, rowH)
    ctx.fillStyle = '#0f172a'
    ctx.textAlign = 'left'
    ctx.fillText(row, tableX + 16, y + rowH / 2)
    indices.forEach((vals, ci) => {
      ctx.textAlign = 'center'
      const x = tableX + colW + ci * colW + colW / 2
      ctx.fillStyle = '#0f172a'
      const v = vals ? vals[keys[ri]] : null
      ctx.fillText(v !== null ? `${v.toFixed(1)} dB(A)` : '—', x, y + rowH / 2)
    })
  })
  // Bordure
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1
  ctx.strokeRect(tableX, tableY, tableW, headerH + rows.length * rowH)

  drawFooter(ctx, FIG_W, FIG_H)
  return canvas
}

// ─── Figure 4 — Conformité 2026 ─────────────────────────────────────────────
export interface FigureConformiteOptions {
  summary: ConformiteSummary
  number: number
}

export function drawFigureConformite(opts: FigureConformiteOptions): HTMLCanvasElement {
  const { summary, number } = opts
  const canvas = document.createElement('canvas')
  canvas.width = FIG_W
  canvas.height = FIG_H
  const ctx = canvas.getContext('2d')!
  fillBg(ctx, FIG_W, FIG_H)
  drawTitle(
    ctx,
    `Figure ${number} — Conformité MELCCFP 2026 — ${summary.receptorLabel} (${summary.period})`,
  )

  // Sous-titre : critère
  ctx.fillStyle = '#475569'
  ctx.font = '12px system-ui, sans-serif'
  ctx.textBaseline = 'top'
  ctx.fillText(
    `Critère LAr,1h : ${summary.limit} dB(A) — Heure d'évaluation : ${summary.evalHour} → +1 h`,
    PAD.left,
    44,
  )

  const tableX = PAD.left
  const tableY = 90
  const cols = ['Point', 'Ba', 'Bp', 'LAr,1h', 'Critère', 'Résultat']
  const widths = [180, 140, 140, 160, 160, 240]
  const tableW = widths.reduce((a, b) => a + b, 0)
  const rowH = 36
  const headerH = 42

  // En-tête
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(tableX, tableY, tableW, headerH)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 13px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  let cx = tableX
  cols.forEach((c, i) => {
    ctx.textAlign = i === 0 ? 'left' : 'center'
    ctx.fillText(c, i === 0 ? cx + 14 : cx + widths[i] / 2, tableY + headerH / 2)
    cx += widths[i]
  })

  // Lignes
  ctx.font = '12px system-ui, sans-serif'
  summary.points.forEach((p, ri) => {
    const y = tableY + headerH + ri * rowH
    ctx.fillStyle = ri % 2 === 0 ? '#f8fafc' : '#ffffff'
    ctx.fillRect(tableX, y, tableW, rowH)

    cx = tableX
    const cells = [
      p.point,
      p.ba !== null ? `${p.ba.toFixed(1)} dB(A)` : '—',
      p.bp !== null ? `${p.bp.toFixed(1)} dB(A)` : '—',
      p.lar !== null ? `${p.lar.toFixed(1)} dB(A)` : '—',
      `${p.criterion.toFixed(1)} dB(A)`,
      p.pass === null ? '—' : p.pass ? '✓ CONFORME' : '✗ NON CONFORME',
    ]
    cells.forEach((cell, i) => {
      ctx.textAlign = i === 0 ? 'left' : 'center'
      // Couleur résultat
      if (i === cells.length - 1) {
        ctx.fillStyle = p.pass === true ? '#047857' : p.pass === false ? '#b91c1c' : '#475569'
        ctx.font = 'bold 12px system-ui, sans-serif'
      } else {
        ctx.fillStyle = '#0f172a'
        ctx.font = '12px system-ui, sans-serif'
      }
      ctx.fillText(cell, i === 0 ? cx + 14 : cx + widths[i] / 2, y + rowH / 2)
      cx += widths[i]
    })
  })
  ctx.strokeStyle = '#cbd5e1'
  ctx.strokeRect(tableX, tableY, tableW, headerH + summary.points.length * rowH)

  drawFooter(ctx, FIG_W, FIG_H)
  return canvas
}

// ─── Helper : canvas → Blob ─────────────────────────────────────────────────
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}
