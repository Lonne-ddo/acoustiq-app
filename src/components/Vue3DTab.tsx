/**
 * Vue 3D — carte satellite MapLibre avec bâtiments OSM extrudés et placement de sources
 * Une seule carte : satellite + 3D + sources acoustiques
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import type { StyleSpecification, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { RotateCcw, Target, Eye, Compass, Loader2 } from 'lucide-react'
import type { LwSourceSummary, Scene3DData } from '../types'

// --- Constants ----------------------------------------------------------------

const INITIAL_CENTER: [number, number] = [-75.9775, 46.3839]
const INITIAL_ZOOM = 15
const INITIAL_PITCH = 45

function lwColor(lw: number): string {
  if (lw >= 115) return '#E24B4A'
  if (lw >= 110) return '#EF9F27'
  if (lw >= 100) return '#FAC775'
  if (lw >= 90) return '#639922'
  return '#1D9E75'
}

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '© Esri',
      maxzoom: 19,
    },
    satellite_labels: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' },
    { id: 'satellite_labels', type: 'raster', source: 'satellite_labels', paint: { 'raster-opacity': 0.8 } },
  ],
}

// --- Types --------------------------------------------------------------------

interface Source3D {
  id: string
  lng?: number
  lat?: number
  placed: boolean
}

interface BuildingFeature {
  type: 'Feature'
  geometry: { type: 'Polygon'; coordinates: number[][][] }
  properties: { height: number }
}

interface Props {
  lwSources: LwSourceSummary[]
  scene3D: Scene3DData | undefined
  onScene3DChange: (data: Scene3DData) => void
}

type OsmStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error'

// --- OSM XML parsing ---------------------------------------------------------

function parseOsmXmlToGeoJSON(xmlText: string): BuildingFeature[] {
  const parser = new DOMParser()
  const xml = parser.parseFromString(xmlText, 'application/xml')

  const nodes = new Map<string, [number, number]>()
  for (const node of xml.querySelectorAll('node')) {
    const id = node.getAttribute('id')
    const lat = node.getAttribute('lat')
    const lon = node.getAttribute('lon')
    if (id && lat && lon) nodes.set(id, [parseFloat(lon), parseFloat(lat)])
  }

  const features: BuildingFeature[] = []
  for (const way of xml.querySelectorAll('way')) {
    const tags = way.querySelectorAll('tag')
    let isBuilding = false
    let heightTag: number | null = null
    let levelsTag: number | null = null
    for (const tag of tags) {
      const k = tag.getAttribute('k')
      const v = tag.getAttribute('v')
      if (k === 'building') isBuilding = true
      if (k === 'height' && v) { const h = parseFloat(v); if (!isNaN(h) && h > 0) heightTag = h }
      if (k === 'building:levels' && v) { const l = parseInt(v, 10); if (!isNaN(l) && l > 0) levelsTag = l }
    }
    if (!isBuilding) continue

    const ring: number[][] = []
    for (const nd of way.querySelectorAll('nd')) {
      const ref = nd.getAttribute('ref')
      if (!ref) continue
      const coord = nodes.get(ref)
      if (coord) ring.push(coord)
    }
    if (ring.length < 4) continue
    // Ensure polygon is closed
    const first = ring[0], last = ring[ring.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]])

    let height = 10
    if (levelsTag) height = levelsTag * 3.5
    if (heightTag) height = heightTag

    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { height },
    })
  }
  return features
}

// --- Main component -----------------------------------------------------------

export default function Vue3DTab({ lwSources, scene3D, onScene3DChange }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const osmAbortRef = useRef<AbortController | null>(null)
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSelectionRef = useRef<string | null>(null)

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [pitch, setPitch] = useState<number>(scene3D?.view?.pitch ?? INITIAL_PITCH)
  const [bearing, setBearing] = useState<number>(scene3D?.view?.bearing ?? 0)
  const [osmStatus, setOsmStatus] = useState<OsmStatus>('idle')
  const [buildingCount, setBuildingCount] = useState(0)

  const [sources3D, setSources3D] = useState<Source3D[]>(() => {
    if (scene3D?.sources) return scene3D.sources.map((s) => ({
      id: s.id, lng: s.lng, lat: s.lat, placed: !!(s.placed && s.lng !== undefined && s.lat !== undefined),
    }))
    return lwSources.map((s) => ({ id: s.id, placed: false }))
  })

  // Keep ref in sync for use in event handlers
  pendingSelectionRef.current = selectedSourceId

  // Sync sources3D when lwSources changes
  useEffect(() => {
    setSources3D((prev) => {
      const existing = new Map(prev.map((s) => [s.id, s]))
      return lwSources.map((ls) => existing.get(ls.id) ?? { id: ls.id, placed: false })
    })
  }, [lwSources])

  // Persist to parent
  useEffect(() => {
    const map = mapRef.current
    const view = map ? {
      lng: map.getCenter().lng,
      lat: map.getCenter().lat,
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    } : scene3D?.view
    onScene3DChange({
      sources: sources3D.map((s) => ({ id: s.id, lng: s.lng, lat: s.lat, placed: s.placed })),
      view,
      building: scene3D?.building,
      bbox: scene3D?.bbox,
      satelliteImage: scene3D?.satelliteImage,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources3D])

  // --- Build sources GeoJSON ---
  const buildSourcesGeoJSON = useCallback((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = []
    for (const s of sources3D) {
      if (!s.placed || s.lng === undefined || s.lat === undefined) continue
      const lw = lwSources.find((ls) => ls.id === s.id)
      if (!lw) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: {
          id: s.id,
          name: lw.name,
          lw: lw.lw.toFixed(1),
          color: lwColor(lw.lw),
        },
      })
    }
    return { type: 'FeatureCollection', features }
  }, [sources3D, lwSources])

  // --- Fetch OSM buildings for current view ---
  const fetchOsmBuildings = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    if (map.getZoom() < 14) {
      setOsmStatus('idle')
      return
    }

    // Cancel any in-flight request
    if (osmAbortRef.current) osmAbortRef.current.abort()
    const controller = new AbortController()
    osmAbortRef.current = controller

    setOsmStatus('loading')
    const b = map.getBounds()
    const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`

    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const features = parseOsmXmlToGeoJSON(text)

      const source = map.getSource('osm-buildings') as GeoJSONSource | undefined
      if (source) {
        source.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection)
      }
      setBuildingCount(features.length)
      setOsmStatus(features.length === 0 ? 'empty' : 'loaded')
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof DOMException && err.name === 'AbortError') return
      setOsmStatus('error')
    }
  }, [])

  // --- Map initialization ---
  useEffect(() => {
    const container = mapContainerRef.current
    if (!container || mapRef.current) return

    const savedView = scene3D?.view
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE,
      center: savedView ? [savedView.lng, savedView.lat] : INITIAL_CENTER,
      zoom: savedView?.zoom ?? INITIAL_ZOOM,
      pitch: savedView?.pitch ?? INITIAL_PITCH,
      bearing: savedView?.bearing ?? 0,
      maxPitch: 60,
      attributionControl: { compact: true },
    })
    mapRef.current = map

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      // Building source + layer
      map.addSource('osm-buildings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'buildings-3d',
        type: 'fill-extrusion',
        source: 'osm-buildings',
        paint: {
          'fill-extrusion-color': '#9ca3af',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.85,
        },
      })

      // Acoustic sources
      map.addSource('acoustic-sources', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'src-halo',
        type: 'circle',
        source: 'acoustic-sources',
        paint: { 'circle-radius': 20, 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 },
      })
      map.addLayer({
        id: 'src-dot',
        type: 'circle',
        source: 'acoustic-sources',
        paint: {
          'circle-radius': 8,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'src-label',
        type: 'symbol',
        source: 'acoustic-sources',
        layout: {
          'text-field': ['concat', ['to-string', ['get', 'lw']], ' dB'],
          'text-size': 11,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.9)',
          'text-halo-width': 1.5,
        },
      })

      // Initial OSM fetch
      fetchOsmBuildings()
    })

    // Moveend → debounced OSM refetch
    map.on('moveend', () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
      moveTimerRef.current = setTimeout(() => { fetchOsmBuildings() }, 1000)
    })

    // Click handler — place selected source or select existing
    const onClick = (e: MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['src-dot', 'src-halo'] })
      if (features.length > 0) {
        const id = features[0].properties?.id as string | undefined
        if (id) {
          const lw = lwSources.find((ls) => ls.id === id)
          const s3d = sources3D.find((s) => s.id === id)
          if (lw && s3d && s3d.lng !== undefined && s3d.lat !== undefined) {
            setSelectedSourceId(id)
            const color = lwColor(lw.lw)
            new maplibregl.Popup({ closeButton: true, offset: 12 })
              .setLngLat([s3d.lng, s3d.lat])
              .setHTML(
                `<div style="font-family:sans-serif;padding:4px;">
                   <strong style="font-size:13px;">${escapeHtml(lw.name)}</strong><br/>
                   Lw : <strong style="color:${color}">${lw.lw.toFixed(1)} dBA</strong>
                 </div>`,
              )
              .addTo(map)
          }
          return
        }
      }
      // Place currently selected source
      const sel = pendingSelectionRef.current
      if (sel) {
        const { lng, lat } = e.lngLat
        setSources3D((prev) => prev.map((s) =>
          s.id === sel ? { ...s, lng, lat, placed: true } : s
        ))
      }
    }
    map.on('click', onClick)

    return () => {
      if (osmAbortRef.current) osmAbortRef.current.abort()
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
      map.off('click', onClick)
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Update cursor when a source is selected for placement ---
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = selectedSourceId ? 'crosshair' : ''
  }, [selectedSourceId])

  // --- Update sources GeoJSON when sources change ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const source = map.getSource('acoustic-sources') as GeoJSONSource | undefined
    if (source) source.setData(buildSourcesGeoJSON())
  }, [buildSourcesGeoJSON])

  // --- Pitch/bearing controlled from panel ---
  const handlePitchChange = (v: number) => {
    setPitch(v)
    mapRef.current?.easeTo({ pitch: v, duration: 200 })
  }
  const handleBearingChange = (v: number) => {
    setBearing(v)
    mapRef.current?.easeTo({ bearing: v, duration: 200 })
  }

  const handleCenterOnSources = () => {
    const map = mapRef.current
    if (!map) return
    const placed = sources3D.filter((s) => s.placed && s.lng !== undefined && s.lat !== undefined)
    if (placed.length === 0) return
    const bounds = new maplibregl.LngLatBounds()
    for (const s of placed) bounds.extend([s.lng!, s.lat!])
    map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 600 })
  }

  const handleTopView = () => {
    setPitch(0)
    setBearing(0)
    mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 400 })
  }

  const handleReset = () => {
    setSources3D((prev) => prev.map((s) => ({ id: s.id, placed: false })))
    setSelectedSourceId(null)
  }

  const placedCount = sources3D.filter((s) => s.placed).length

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Map */}
      <div
        ref={mapContainerRef}
        className="flex-1 relative"
        style={{ minHeight: 600 }}
      />

      {/* Side panel */}
      <div className="w-[260px] shrink-0 border-l border-gray-800 bg-gray-950 flex flex-col overflow-hidden">
        {/* Navigation */}
        <div className="px-3 py-3 border-b border-gray-800 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
            <Compass size={12} /> Navigation
          </h3>
          <div>
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
              <span>Inclinaison</span><span>{Math.round(pitch)}°</span>
            </div>
            <input
              type="range" min={0} max={60} step={1}
              value={pitch}
              onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
              className="w-full h-1 accent-blue-500"
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
              <span>Rotation</span><span>{Math.round(bearing)}°</span>
            </div>
            <input
              type="range" min={-180} max={180} step={1}
              value={bearing}
              onChange={(e) => handleBearingChange(parseFloat(e.target.value))}
              className="w-full h-1 accent-blue-500"
            />
          </div>
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={handleCenterOnSources}
              disabled={placedCount === 0}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Target size={11} /> Centrer sources
            </button>
            <button
              onClick={handleTopView}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1 transition-colors"
            >
              <Eye size={11} /> Vue dessus
            </button>
          </div>
        </div>

        {/* Sources */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sources</h3>
            <span className="text-[10px] text-gray-500">{placedCount} / {lwSources.length} placées</span>
          </div>
          {lwSources.length === 0 && (
            <p className="text-[11px] text-gray-600 leading-tight">
              Aucune source disponible — calculez les Lw dans l'onglet <strong className="text-gray-500">Puissance Lw</strong> d'abord.
            </p>
          )}
          <div className="space-y-1">
            {lwSources.map((ls) => {
              const s3d = sources3D.find((s) => s.id === ls.id)
              const isPlaced = s3d?.placed ?? false
              const isSelected = selectedSourceId === ls.id
              return (
                <button
                  key={ls.id}
                  onClick={() => setSelectedSourceId(isSelected ? null : ls.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-2 ${
                    isSelected
                      ? 'bg-blue-950/50 ring-1 ring-blue-500 text-gray-100'
                      : 'hover:bg-gray-900 text-gray-400'
                  }`}
                >
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: lwColor(ls.lw) }} />
                  <span className="flex-1 truncate">{ls.name}</span>
                  <span className="text-[10px] text-gray-500 shrink-0">{ls.lw.toFixed(0)} dB</span>
                  <span className={`text-[10px] shrink-0 ${isPlaced ? 'text-green-400' : 'text-gray-600'}`}>
                    {isPlaced ? '●' : '○'}
                  </span>
                </button>
              )
            })}
          </div>
          {selectedSourceId && (
            <p className="text-[10px] text-blue-400 mt-2 leading-tight">
              Cliquez sur la carte pour placer cette source
            </p>
          )}
        </div>

        {/* Reset button */}
        {placedCount > 0 && (
          <div className="px-3 py-2 border-t border-gray-800">
            <button
              onClick={handleReset}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1.5 transition-colors"
            >
              <RotateCcw size={12} />
              Réinitialiser toutes les positions
            </button>
          </div>
        )}

        {/* Legend */}
        <div className="px-3 py-2 border-t border-gray-800 space-y-1">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Légende Lw</h3>
          {[
            { color: '#E24B4A', label: '≥ 115 dB' },
            { color: '#EF9F27', label: '110–115 dB' },
            { color: '#FAC775', label: '100–110 dB' },
            { color: '#639922', label: '90–100 dB' },
            { color: '#1D9E75', label: '< 90 dB' },
          ].map((l) => (
            <div key={l.color} className="flex items-center gap-2 text-[11px] text-gray-400">
              <span className="inline-block w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
              <span>{l.label}</span>
            </div>
          ))}
        </div>

        {/* OSM status */}
        <div className="px-3 py-2 border-t border-gray-800 text-[10px]">
          {osmStatus === 'loading' && (
            <span className="flex items-center gap-1.5 text-gray-500">
              <Loader2 size={10} className="animate-spin" />
              Chargement des bâtiments OSM...
            </span>
          )}
          {osmStatus === 'loaded' && (
            <span className="text-green-500/70">{buildingCount} bâtiment{buildingCount > 1 ? 's' : ''} chargé{buildingCount > 1 ? 's' : ''}</span>
          )}
          {osmStatus === 'empty' && (
            <span className="text-amber-500/70">Aucun bâtiment OSM dans cette zone</span>
          )}
          {osmStatus === 'error' && (
            <span className="text-red-400/80">Erreur OSM — données indisponibles</span>
          )}
          {osmStatus === 'idle' && (
            <span className="text-gray-600">Zoomez davantage pour charger les bâtiments</span>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Utilities ---------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c))
}
