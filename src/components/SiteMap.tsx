/**
 * Plan de site — onglet « Carte »
 *
 * Permet de charger une image (JPG/PNG), d'y placer un marqueur par point de
 * mesure, de les déplacer, de visualiser le LAeq courant au survol et
 * d'exporter la carte annotée en PNG. Les positions de marqueurs sont
 * normalisées (fraction 0..1) pour rester correctes quelle que soit la taille
 * d'affichage.
 */
import { useRef, useState, useMemo, useCallback, useEffect } from 'react'
import { Upload, MapPin, RotateCcw, Download, X } from 'lucide-react'
import type { MeasurementFile, MarkerPos, ZoomRange, AppSettings } from '../types'
import { laeqAvg } from '../utils/acoustics'

const POINT_COLORS: Record<string, string> = {
  'BV-94':  '#10b981',
  'BV-98':  '#3b82f6',
  'BV-105': '#f59e0b',
  'BV-106': '#ef4444',
  'BV-37':  '#8b5cf6',
  'BV-107': '#06b6d4',
}
const FALLBACK_COLORS = ['#ec4899', '#84cc16', '#f97316', '#a78bfa']
function ptColor(pt: string, i: number, custom?: Record<string, string>): string {
  return custom?.[pt] ?? POINT_COLORS[pt] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  assignedPoints: string[]
  /** Plage de zoom courante du graphique — détermine la fenêtre temporelle pour le LAeq affiché */
  zoomRange: ZoomRange | null
  mapImage: string | null
  onMapImageChange: (image: string | null) => void
  markers: Record<string, MarkerPos>
  onMarkersChange: (markers: Record<string, MarkerPos>) => void
  settings?: AppSettings
}

export default function SiteMap({
  files,
  pointMap,
  selectedDate,
  assignedPoints,
  zoomRange,
  mapImage,
  onMapImageChange,
  markers,
  onMarkersChange,
  settings,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [activePoint, setActivePoint] = useState<string>(() => assignedPoints[0] ?? '')
  const [draggingPt, setDraggingPt] = useState<string | null>(null)
  const [popupPt, setPopupPt] = useState<string | null>(null)

  // Garder activePoint synchronisé avec la liste des points disponibles
  useEffect(() => {
    if (!assignedPoints.includes(activePoint) && assignedPoints.length > 0) {
      setActivePoint(assignedPoints[0])
    }
  }, [assignedPoints, activePoint])

  // ── LAeq courant par point sur la fenêtre temporelle effective ───────────
  const laeqByPoint = useMemo<Record<string, number | null>>(() => {
    const start = zoomRange?.startMin ?? 0
    const end = zoomRange?.endMin ?? 1440
    const out: Record<string, number | null> = {}
    for (const pt of assignedPoints) {
      const values: number[] = []
      for (const f of files) {
        if (pointMap[f.id] !== pt || f.date !== selectedDate) continue
        for (const dp of f.data) {
          if (dp.t >= start && dp.t <= end) values.push(dp.laeq)
        }
      }
      out[pt] = values.length > 0 ? laeqAvg(values) : null
    }
    return out
  }, [files, pointMap, selectedDate, assignedPoints, zoomRange])

  // ── Chargement de l'image ────────────────────────────────────────────────
  function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const url = e.target?.result
      if (typeof url === 'string') onMapImageChange(url)
    }
    reader.readAsDataURL(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // ── Placement / déplacement de marqueurs ─────────────────────────────────
  const placeMarker = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Si on clique pendant un drag, ignorer
      if (draggingPt) return
      if (!activePoint) return
      const img = imgRef.current
      if (!img) return
      const rect = img.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return
      onMarkersChange({ ...markers, [activePoint]: { x, y } })
    },
    [activePoint, markers, onMarkersChange, draggingPt],
  )

  // Drag d'un marqueur existant
  function handleMarkerMouseDown(e: React.MouseEvent, pt: string) {
    e.stopPropagation()
    setDraggingPt(pt)
  }

  useEffect(() => {
    if (!draggingPt) return
    function onMove(e: MouseEvent) {
      const img = imgRef.current
      if (!img) return
      const rect = img.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      const cx = Math.max(0, Math.min(1, x))
      const cy = Math.max(0, Math.min(1, y))
      onMarkersChange({ ...markers, [draggingPt!]: { x: cx, y: cy } })
    }
    function onUp() { setDraggingPt(null) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [draggingPt, markers, onMarkersChange])

  // ── Reset ────────────────────────────────────────────────────────────────
  function handleReset() {
    onMarkersChange({})
    setPopupPt(null)
  }

  // ── Export PNG ───────────────────────────────────────────────────────────
  async function handleExportPNG() {
    if (!mapImage || !imgRef.current) return
    const img = imgRef.current
    // Dessiner image + cercles sur un canvas hors écran
    const canvas = document.createElement('canvas')
    const naturalW = img.naturalWidth || img.width
    const naturalH = img.naturalHeight || img.height
    canvas.width = naturalW
    canvas.height = naturalH
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, naturalW, naturalH)

    // Cercles + étiquettes pour chaque marqueur
    const radius = Math.max(10, Math.round(Math.min(naturalW, naturalH) / 60))
    ctx.font = `bold ${Math.max(12, Math.round(radius * 1.4))}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let i = 0
    for (const pt of assignedPoints) {
      const m = markers[pt]
      if (!m) { i++; continue }
      const cx = m.x * naturalW
      const cy = m.y * naturalH
      const color = ptColor(pt, i, settings?.pointColors)

      // Halo blanc
      ctx.beginPath()
      ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()

      // Cercle plein coloré
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()

      // Étiquette texte
      ctx.fillStyle = '#ffffff'
      ctx.fillText(pt, cx, cy + radius * 2.5)
      i++
    }

    canvas.toBlob((blob) => {
      if (!blob) return
      const link = document.createElement('a')
      link.download = `acoustiq_carte_${selectedDate || 'site'}.png`
      link.href = URL.createObjectURL(blob)
      link.click()
      URL.revokeObjectURL(link.href)
    }, 'image/png')
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Barre de contrôle */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 shrink-0 flex-wrap">
        <MapPin size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Plan de site
        </span>

        {assignedPoints.length > 0 && (
          <div className="flex items-center gap-2 ml-2">
            <label className="text-xs text-gray-500">Placer</label>
            <select
              value={activePoint}
              onChange={(e) => setActivePoint(e.target.value)}
              className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {assignedPoints.map((pt) => (
                <option key={pt} value={pt}>
                  {pt} {markers[pt] ? '✓' : ''}
                </option>
              ))}
            </select>
            {activePoint && (
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{
                  backgroundColor: ptColor(
                    activePoint,
                    assignedPoints.indexOf(activePoint),
                    settings?.pointColors,
                  ),
                }}
              />
            )}
          </div>
        )}

        <div className="flex items-center gap-1 ml-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileInput}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                       bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                       border border-gray-600 transition-colors"
            title="Charger une image (JPG, PNG)"
          >
            <Upload size={12} />
            {mapImage ? 'Remplacer' : 'Charger une image'}
          </button>
          <button
            onClick={handleReset}
            disabled={Object.keys(markers).length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                       bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                       border border-gray-600 transition-colors disabled:opacity-30"
            title="Réinitialiser les marqueurs"
          >
            <RotateCcw size={12} />
            Réinitialiser les marqueurs
          </button>
          <button
            onClick={handleExportPNG}
            disabled={!mapImage}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                       bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                       border border-gray-600 transition-colors disabled:opacity-30"
            title="Exporter la carte annotée en PNG"
          >
            <Download size={12} />
            Exporter PNG
          </button>
        </div>
      </div>

      {/* Zone d'affichage */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-950 p-4"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {!mapImage ? (
          <div
            className={`flex items-center justify-center h-full border-2 border-dashed rounded-lg
                        transition-colors ${
                          dragOver
                            ? 'border-emerald-500 bg-emerald-950/20'
                            : 'border-gray-700'
                        }`}
          >
            <div className="text-center text-gray-600">
              <MapPin size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm mb-1">
                Glissez une image ici, ou cliquez sur « Charger une image »
              </p>
              <p className="text-xs text-gray-700">JPG, PNG ou WebP</p>
              {assignedPoints.length === 0 && (
                <p className="text-xs text-amber-500 mt-3">
                  Chargez d'abord des fichiers et assignez-les à des points de mesure.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="relative inline-block max-w-full">
            <img
              ref={imgRef}
              src={mapImage}
              alt="Plan de site"
              className="block max-w-full h-auto select-none"
              draggable={false}
              onClick={placeMarker}
              style={{ cursor: activePoint ? 'crosshair' : 'default' }}
            />
            {/* Marqueurs */}
            {assignedPoints.map((pt, i) => {
              const m = markers[pt]
              if (!m) return null
              const color = ptColor(pt, i, settings?.pointColors)
              const laeq = laeqByPoint[pt]
              return (
                <div
                  key={pt}
                  className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab"
                  style={{
                    left: `${m.x * 100}%`,
                    top: `${m.y * 100}%`,
                  }}
                  onMouseDown={(e) => handleMarkerMouseDown(e, pt)}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPopupPt(popupPt === pt ? null : pt)
                  }}
                >
                  <div
                    className="w-5 h-5 rounded-full border-2 border-white shadow-md
                               flex items-center justify-center"
                    style={{ backgroundColor: color }}
                  />
                  <div
                    className="absolute left-1/2 -translate-x-1/2 mt-0.5 px-1 py-0.5 rounded
                               bg-gray-900/90 border border-gray-700 text-[10px] font-semibold
                               whitespace-nowrap"
                    style={{ color, top: '100%' }}
                  >
                    {pt}
                  </div>
                  {popupPt === pt && (
                    <div
                      className="absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2
                                 bg-gray-900 border border-gray-700 rounded-md shadow-2xl p-2
                                 text-xs text-gray-200 w-44"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className="font-semibold" style={{ color }}>{pt}</span>
                        <button
                          onClick={() => setPopupPt(null)}
                          className="text-gray-600 hover:text-gray-300"
                        >
                          <X size={11} />
                        </button>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">LAeq</span>
                        <span className="font-semibold tabular-nums text-emerald-300">
                          {laeq !== null ? `${laeq.toFixed(1)} dB(A)` : '—'}
                        </span>
                      </div>
                      <div className="text-[9px] text-gray-600 mt-1">
                        {zoomRange
                          ? 'Sur la plage zoomée'
                          : 'Sur la journée complète'}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
