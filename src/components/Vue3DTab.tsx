/**
 * Vue 3D — carte satellite MapLibre avec bâtiments OSM extrudés, placement de sources,
 * tracé de zones de modélisation (polygones) et menu contextuel clic droit.
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import type { StyleSpecification, GeoJSONSource, MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  RotateCcw, Target, Eye, Compass, Loader2, Search, Pencil, X, Trash2,
  MapPin, StickyNote, Plus, Info, Edit3, Crosshair,
} from 'lucide-react'
import type { LwSourceSummary, Scene3DData } from '../types'
import ContextMenu from './ContextMenu'

// --- Constants ----------------------------------------------------------------

const INITIAL_CENTER: [number, number] = [-75.9775, 46.3839]
const INITIAL_ZOOM = 15
const INITIAL_PITCH = 45

const LS_ZONES = 'acoustiq_vue3d_zones'
const LS_MPOINTS = 'acoustiq_vue3d_mpoints'
const LS_ANNOTATIONS = 'acoustiq_vue3d_annotations'

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

interface Zone {
  id: string
  name: string
  coords: [number, number][]
}

interface MeasurementPoint {
  id: string
  name: string
  lng: number
  lat: number
}

interface Annotation {
  id: string
  text: string
  lng: number
  lat: number
}

type ContextTargetType = 'map' | 'source' | 'measurement' | 'annotation' | 'zone'

interface ContextMenuState {
  x: number
  y: number
  lng: number
  lat: number
  target: { type: ContextTargetType; id?: string }
}

interface Props {
  lwSources: LwSourceSummary[]
  scene3D: Scene3DData | undefined
  onScene3DChange: (data: Scene3DData) => void
}

type OsmStatus = 'idle' | 'loading' | 'loaded' | 'empty' | 'error'

// --- LocalStorage helpers ----------------------------------------------------

function loadLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch { return fallback }
}
function saveLS<T>(key: string, val: T) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore quota */ }
}

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

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// --- Main component -----------------------------------------------------------

export default function Vue3DTab({ lwSources, scene3D, onScene3DChange }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapColumnRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const osmAbortRef = useRef<AbortController | null>(null)
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSelectionRef = useRef<string | null>(null)

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [pitch, setPitch] = useState<number>(scene3D?.view?.pitch ?? INITIAL_PITCH)
  const [bearing, setBearing] = useState<number>(scene3D?.view?.bearing ?? 0)
  const [osmStatus, setOsmStatus] = useState<OsmStatus>('idle')
  const [buildingCount, setBuildingCount] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)

  const [sources3D, setSources3D] = useState<Source3D[]>(() => {
    if (scene3D?.sources) return scene3D.sources.map((s) => ({
      id: s.id, lng: s.lng, lat: s.lat, placed: !!(s.placed && s.lng !== undefined && s.lat !== undefined),
    }))
    return lwSources.map((s) => ({ id: s.id, placed: false }))
  })

  const [zones, setZones] = useState<Zone[]>(() => loadLS<Zone[]>(LS_ZONES, []))
  const [mpoints, setMpoints] = useState<MeasurementPoint[]>(() => loadLS<MeasurementPoint[]>(LS_MPOINTS, []))
  const [annotations, setAnnotations] = useState<Annotation[]>(() => loadLS<Annotation[]>(LS_ANNOTATIONS, []))

  const [drawing, setDrawing] = useState(false)
  const drawingRef = useRef(false)
  const drawPointsRef = useRef<[number, number][]>([])
  const [drawVersion, setDrawVersion] = useState(0) // bump to trigger draft GeoJSON refresh

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  pendingSelectionRef.current = selectedSourceId
  drawingRef.current = drawing

  // Sync sources3D when lwSources changes
  useEffect(() => {
    setSources3D((prev) => {
      const existing = new Map(prev.map((s) => [s.id, s]))
      return lwSources.map((ls) => existing.get(ls.id) ?? { id: ls.id, placed: false })
    })
  }, [lwSources])

  // Persist scene3D to parent (sources + view)
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

  // Persist local entities
  useEffect(() => { saveLS(LS_ZONES, zones) }, [zones])
  useEffect(() => { saveLS(LS_MPOINTS, mpoints) }, [mpoints])
  useEffect(() => { saveLS(LS_ANNOTATIONS, annotations) }, [annotations])

  // --- GeoJSON builders ---
  const buildSourcesGeoJSON = useCallback((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = []
    for (const s of sources3D) {
      if (!s.placed || s.lng === undefined || s.lat === undefined) continue
      const lw = lwSources.find((ls) => ls.id === s.id)
      if (!lw) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { id: s.id, name: lw.name, lw: lw.lw.toFixed(1), color: lwColor(lw.lw) },
      })
    }
    return { type: 'FeatureCollection', features }
  }, [sources3D, lwSources])

  const buildZonesGeoJSON = useCallback((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = zones.map((z) => {
      const ring = [...z.coords]
      if (ring.length > 0) {
        const first = ring[0], last = ring[ring.length - 1]
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first)
      }
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { id: z.id, name: z.name },
      }
    })
    return { type: 'FeatureCollection', features }
  }, [zones])

  const buildDraftGeoJSON = useCallback((): {
    line: GeoJSON.FeatureCollection
    vertices: GeoJSON.FeatureCollection
  } => {
    const pts = drawPointsRef.current
    const line: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: pts.length >= 2 ? [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pts },
        properties: {},
      }] : [],
    }
    const vertices: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: pts.map((p, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p },
        properties: { idx: i },
      })),
    }
    return { line, vertices }
  }, [])

  const buildMpointsGeoJSON = useCallback((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: mpoints.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, name: p.name },
    })),
  }), [mpoints])

  const buildAnnotationsGeoJSON = useCallback((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: annotations.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
      properties: { id: a.id, text: a.text },
    })),
  }), [annotations])

  // --- Fetch OSM buildings ---
  const fetchOsmBuildings = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    if (map.getZoom() < 14) { setOsmStatus('idle'); return }

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
      if (source) source.setData({ type: 'FeatureCollection', features } as GeoJSON.FeatureCollection)
      setBuildingCount(features.length)
      setOsmStatus(features.length === 0 ? 'empty' : 'loaded')
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof DOMException && err.name === 'AbortError') return
      setOsmStatus('error')
    }
  }, [])

  // --- Drawing helpers ---
  const finalizeZone = useCallback(() => {
    const pts = drawPointsRef.current
    // Last click of dblclick duplicates the previous vertex; drop it if close enough.
    let cleaned = pts.slice()
    if (cleaned.length >= 2) {
      const a = cleaned[cleaned.length - 1]
      const b = cleaned[cleaned.length - 2]
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) cleaned.pop()
    }
    if (cleaned.length < 3) {
      // Not enough points — just cancel
      drawPointsRef.current = []
      setDrawing(false)
      setDrawVersion((v) => v + 1)
      return
    }
    const zone: Zone = { id: genId('zone'), name: `Zone ${zones.length + 1}`, coords: cleaned }
    setZones((prev) => [...prev, zone])
    drawPointsRef.current = []
    setDrawing(false)
    setDrawVersion((v) => v + 1)
  }, [zones.length])

  const cancelDrawing = useCallback(() => {
    drawPointsRef.current = []
    setDrawing(false)
    setDrawVersion((v) => v + 1)
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
      // Buildings
      map.addSource('osm-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'buildings-3d', type: 'fill-extrusion', source: 'osm-buildings',
        paint: {
          'fill-extrusion-color': '#9ca3af',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.85,
        },
      })

      // Zones (finalized polygons)
      map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'zones-fill', type: 'fill', source: 'zones',
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.18 },
      })
      map.addLayer({
        id: 'zones-outline', type: 'line', source: 'zones',
        paint: { 'line-color': '#3b82f6', 'line-width': 2 },
      })

      // Zone draft
      map.addSource('zone-draft-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'zone-draft-line', type: 'line', source: 'zone-draft-line',
        paint: { 'line-color': '#60a5fa', 'line-width': 2, 'line-dasharray': [2, 2] },
      })
      map.addSource('zone-draft-vertices', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'zone-draft-vertices', type: 'circle', source: 'zone-draft-vertices',
        paint: {
          'circle-radius': 5,
          'circle-color': '#60a5fa',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      // Measurement points
      map.addSource('meas-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'meas-dot', type: 'circle', source: 'meas-points',
        paint: {
          'circle-radius': 7,
          'circle-color': '#22c55e',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'meas-label', type: 'symbol', source: 'meas-points',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.9)',
          'text-halo-width': 1.5,
        },
      })

      // Annotations
      map.addSource('annotations', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'annotation-dot', type: 'circle', source: 'annotations',
        paint: {
          'circle-radius': 5,
          'circle-color': '#f59e0b',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'annotation-label', type: 'symbol', source: 'annotations',
        layout: {
          'text-field': ['get', 'text'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#fbbf24',
          'text-halo-color': 'rgba(0,0,0,0.9)',
          'text-halo-width': 1.5,
        },
      })

      // Acoustic sources (on top)
      map.addSource('acoustic-sources', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'src-halo', type: 'circle', source: 'acoustic-sources',
        paint: { 'circle-radius': 20, 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 },
      })
      map.addLayer({
        id: 'src-dot', type: 'circle', source: 'acoustic-sources',
        paint: {
          'circle-radius': 8,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addLayer({
        id: 'src-label', type: 'symbol', source: 'acoustic-sources',
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

      fetchOsmBuildings()
    })

    map.on('moveend', () => {
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
      moveTimerRef.current = setTimeout(() => { fetchOsmBuildings() }, 1000)
    })

    // --- Left-click handler ---
    const onClick = (e: MapMouseEvent) => {
      // Close any context menu on left click
      setContextMenu(null)

      // Drawing mode: add vertex
      if (drawingRef.current) {
        drawPointsRef.current = [...drawPointsRef.current, [e.lngLat.lng, e.lngLat.lat]]
        setDrawVersion((v) => v + 1)
        return
      }

      // Existing behaviour: select/place source
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
      const sel = pendingSelectionRef.current
      if (sel) {
        const { lng, lat } = e.lngLat
        setSources3D((prev) => prev.map((s) =>
          s.id === sel ? { ...s, lng, lat, placed: true } : s,
        ))
      }
    }
    map.on('click', onClick)

    // --- Double-click: close polygon ---
    const onDblClick = (e: MapMouseEvent) => {
      if (drawingRef.current) {
        e.preventDefault() // block default zoom
        finalizeZone()
      }
    }
    map.on('dblclick', onDblClick)

    // --- Right-click: context menu ---
    const onContextMenu = (e: MapMouseEvent) => {
      e.preventDefault()
      if (drawingRef.current) return // right-click does nothing while drawing

      const feats = map.queryRenderedFeatures(e.point, {
        layers: ['src-dot', 'src-halo', 'meas-dot', 'annotation-dot', 'zones-fill'],
      })
      let target: ContextMenuState['target'] = { type: 'map' }
      if (feats.length > 0) {
        const layerId = feats[0].layer.id
        const id = feats[0].properties?.id as string | undefined
        if (layerId.startsWith('src') && id) target = { type: 'source', id }
        else if (layerId === 'meas-dot' && id) target = { type: 'measurement', id }
        else if (layerId === 'annotation-dot' && id) target = { type: 'annotation', id }
        else if (layerId === 'zones-fill' && id) target = { type: 'zone', id }
      }
      setContextMenu({
        x: e.point.x,
        y: e.point.y,
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        target,
      })
    }
    map.on('contextmenu', onContextMenu)

    // Suppress the native browser context menu on the map container as a safety net
    const suppressNative = (ev: MouseEvent) => ev.preventDefault()
    container.addEventListener('contextmenu', suppressNative)

    return () => {
      if (osmAbortRef.current) osmAbortRef.current.abort()
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
      container.removeEventListener('contextmenu', suppressNative)
      map.off('click', onClick)
      map.off('dblclick', onDblClick)
      map.off('contextmenu', onContextMenu)
      map.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Toggle double-click zoom when drawing ---
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (drawing) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [drawing])

  // --- Cursor feedback ---
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (drawing) map.getCanvas().style.cursor = 'crosshair'
    else map.getCanvas().style.cursor = selectedSourceId ? 'crosshair' : ''
  }, [selectedSourceId, drawing])

  // --- Keyboard: Esc closes menu / cancels drawing ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contextMenu) { setContextMenu(null); return }
        if (drawing) { cancelDrawing(); return }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contextMenu, drawing, cancelDrawing])

  // --- GeoJSON updates on state change ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('acoustic-sources') as GeoJSONSource | undefined)?.setData(buildSourcesGeoJSON())
  }, [buildSourcesGeoJSON])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('zones') as GeoJSONSource | undefined)?.setData(buildZonesGeoJSON())
  }, [buildZonesGeoJSON])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const { line, vertices } = buildDraftGeoJSON()
    ;(map.getSource('zone-draft-line') as GeoJSONSource | undefined)?.setData(line)
    ;(map.getSource('zone-draft-vertices') as GeoJSONSource | undefined)?.setData(vertices)
  }, [drawVersion, buildDraftGeoJSON])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('meas-points') as GeoJSONSource | undefined)?.setData(buildMpointsGeoJSON())
  }, [buildMpointsGeoJSON])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('annotations') as GeoJSONSource | undefined)?.setData(buildAnnotationsGeoJSON())
  }, [buildAnnotationsGeoJSON])

  // --- Navigation controls ---
  const handlePitchChange = (v: number) => { setPitch(v); mapRef.current?.easeTo({ pitch: v, duration: 200 }) }
  const handleBearingChange = (v: number) => { setBearing(v); mapRef.current?.easeTo({ bearing: v, duration: 200 }) }

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
    setPitch(0); setBearing(0)
    mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 400 })
  }

  const handleReset = () => {
    setSources3D((prev) => prev.map((s) => ({ id: s.id, placed: false })))
    setSelectedSourceId(null)
  }

  const handleSearch = async () => {
    const q = searchQuery.trim()
    const map = mapRef.current
    if (!q || !map) return
    setSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      )
      const results: Array<{ lat: string; lon: string }> = await res.json()
      if (results.length > 0) {
        const lat = parseFloat(results[0].lat)
        const lon = parseFloat(results[0].lon)
        map.flyTo({ center: [lon, lat], zoom: 16, duration: 800 })
      }
    } catch { /* ignore */ }
    finally { setSearching(false) }
  }

  // --- Context menu actions ---
  const act = {
    addSourceHere: (lng: number, lat: number) => {
      const sel = pendingSelectionRef.current
      if (!sel) {
        window.alert('Sélectionnez d\'abord une source dans la liste de droite, puis utilisez "Ajouter une source ici".')
        return
      }
      setSources3D((prev) => prev.map((s) =>
        s.id === sel ? { ...s, lng, lat, placed: true } : s,
      ))
    },
    addMeasurementHere: (lng: number, lat: number) => {
      const name = window.prompt('Nom du point de mesure :', `P${mpoints.length + 1}`)
      if (!name || !name.trim()) return
      setMpoints((prev) => [...prev, { id: genId('mp'), name: name.trim(), lng, lat }])
    },
    addAnnotationHere: (lng: number, lat: number) => {
      const text = window.prompt('Texte de l\'annotation :')
      if (!text || !text.trim()) return
      setAnnotations((prev) => [...prev, { id: genId('ann'), text: text.trim(), lng, lat }])
    },
    centerHere: (lng: number, lat: number) => {
      mapRef.current?.flyTo({ center: [lng, lat], duration: 500 })
    },
    editSource: (id: string) => {
      setSelectedSourceId(id)
    },
    deleteSource: (id: string) => {
      setSources3D((prev) => prev.map((s) =>
        s.id === id ? { ...s, lng: undefined, lat: undefined, placed: false } : s,
      ))
    },
    sourceProps: (id: string) => {
      const lw = lwSources.find((ls) => ls.id === id)
      const s3d = sources3D.find((s) => s.id === id)
      if (!lw || !s3d) return
      const map = mapRef.current
      if (!map || s3d.lng === undefined || s3d.lat === undefined) return
      const color = lwColor(lw.lw)
      new maplibregl.Popup({ closeButton: true, offset: 12 })
        .setLngLat([s3d.lng, s3d.lat])
        .setHTML(
          `<div style="font-family:sans-serif;padding:4px;font-size:12px;">
             <strong>${escapeHtml(lw.name)}</strong><br/>
             Lw : <strong style="color:${color}">${lw.lw.toFixed(1)} dBA</strong><br/>
             Position : ${s3d.lng.toFixed(5)}, ${s3d.lat.toFixed(5)}
           </div>`,
        )
        .addTo(map)
    },
    renameMpoint: (id: string) => {
      const cur = mpoints.find((p) => p.id === id)
      if (!cur) return
      const name = window.prompt('Nouveau nom :', cur.name)
      if (!name || !name.trim()) return
      setMpoints((prev) => prev.map((p) => p.id === id ? { ...p, name: name.trim() } : p))
    },
    deleteMpoint: (id: string) => {
      setMpoints((prev) => prev.filter((p) => p.id !== id))
    },
    mpointData: (id: string) => {
      const p = mpoints.find((x) => x.id === id)
      if (!p) return
      window.alert(`Point de mesure : ${p.name}\nCoordonnées : ${p.lng.toFixed(5)}, ${p.lat.toFixed(5)}\n\n(Les données de mesure sont associées aux points BV-xx dans l'onglet Visualisation.)`)
    },
    editAnnotation: (id: string) => {
      const cur = annotations.find((a) => a.id === id)
      if (!cur) return
      const text = window.prompt('Texte :', cur.text)
      if (!text || !text.trim()) return
      setAnnotations((prev) => prev.map((a) => a.id === id ? { ...a, text: text.trim() } : a))
    },
    deleteAnnotation: (id: string) => {
      setAnnotations((prev) => prev.filter((a) => a.id !== id))
    },
    renameZone: (id: string) => {
      const cur = zones.find((z) => z.id === id)
      if (!cur) return
      const name = window.prompt('Nom de la zone :', cur.name)
      if (!name || !name.trim()) return
      setZones((prev) => prev.map((z) => z.id === id ? { ...z, name: name.trim() } : z))
    },
    deleteZone: (id: string) => {
      setZones((prev) => prev.filter((z) => z.id !== id))
    },
  }

  const placedCount = sources3D.filter((s) => s.placed).length

  // --- Menu item builder for contextMenu ---
  function menuItems(): { label: string; icon?: React.ReactNode; action: () => void; danger?: boolean }[] {
    if (!contextMenu) return []
    const { target, lng, lat } = contextMenu
    if (target.type === 'source' && target.id) {
      return [
        { label: 'Modifier la source', icon: <Edit3 size={12} />, action: () => act.editSource(target.id!) },
        { label: 'Voir les propriétés', icon: <Info size={12} />, action: () => act.sourceProps(target.id!) },
        { label: 'Supprimer la source', icon: <Trash2 size={12} />, action: () => act.deleteSource(target.id!), danger: true },
      ]
    }
    if (target.type === 'measurement' && target.id) {
      return [
        { label: 'Renommer ce point', icon: <Edit3 size={12} />, action: () => act.renameMpoint(target.id!) },
        { label: 'Voir les données associées', icon: <Info size={12} />, action: () => act.mpointData(target.id!) },
        { label: 'Supprimer ce point', icon: <Trash2 size={12} />, action: () => act.deleteMpoint(target.id!), danger: true },
      ]
    }
    if (target.type === 'annotation' && target.id) {
      return [
        { label: 'Modifier l\'annotation', icon: <Edit3 size={12} />, action: () => act.editAnnotation(target.id!) },
        { label: 'Supprimer', icon: <Trash2 size={12} />, action: () => act.deleteAnnotation(target.id!), danger: true },
      ]
    }
    if (target.type === 'zone' && target.id) {
      return [
        { label: 'Renommer la zone', icon: <Edit3 size={12} />, action: () => act.renameZone(target.id!) },
        { label: 'Supprimer la zone', icon: <Trash2 size={12} />, action: () => act.deleteZone(target.id!), danger: true },
      ]
    }
    // Default: empty map
    return [
      { label: 'Ajouter une source sonore ici', icon: <Plus size={12} />, action: () => act.addSourceHere(lng, lat) },
      { label: 'Ajouter un point de mesure ici', icon: <MapPin size={12} />, action: () => act.addMeasurementHere(lng, lat) },
      { label: 'Ajouter une annotation ici', icon: <StickyNote size={12} />, action: () => act.addAnnotationHere(lng, lat) },
      { label: 'Centrer la vue ici', icon: <Crosshair size={12} />, action: () => act.centerHere(lng, lat) },
    ]
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <div ref={mapColumnRef} className="flex-1 flex flex-col min-w-0 relative">
        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
          <Search size={14} className="text-gray-500 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Rechercher un lieu (ville, adresse...)"
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-3 py-1 transition-colors disabled:opacity-50"
          >
            {searching ? <Loader2 size={12} className="animate-spin" /> : 'Centrer'}
          </button>
        </div>

        {/* Map */}
        <div ref={mapContainerRef} className="flex-1 relative" style={{ minHeight: 600 }} />

        {/* Drawing hint overlay */}
        {drawing && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-gray-950/95 border border-blue-600 rounded px-3 py-1.5 text-xs text-blue-300 shadow-lg z-10 flex items-center gap-2">
            <Pencil size={12} />
            Clic gauche pour ajouter un sommet · Double-clic pour fermer · Échap pour annuler
            <button
              onClick={cancelDrawing}
              className="ml-2 text-gray-400 hover:text-gray-200"
              aria-label="Annuler le tracé"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={menuItems()}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>

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
            <input type="range" min={0} max={60} step={1} value={pitch}
              onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
              className="w-full h-1 accent-blue-500" />
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
              <span>Rotation</span><span>{Math.round(bearing)}°</span>
            </div>
            <input type="range" min={-180} max={180} step={1} value={bearing}
              onChange={(e) => handleBearingChange(parseFloat(e.target.value))}
              className="w-full h-1 accent-blue-500" />
          </div>
          <div className="flex gap-1.5 pt-1">
            <button onClick={handleCenterOnSources} disabled={placedCount === 0}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <Target size={11} /> Centrer sources
            </button>
            <button onClick={handleTopView}
              className="flex-1 flex items-center justify-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1 transition-colors">
              <Eye size={11} /> Vue dessus
            </button>
          </div>
        </div>

        {/* Drawing tool */}
        <div className="px-3 py-3 border-b border-gray-800 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
            <Pencil size={12} /> Zones de modélisation
          </h3>
          <button
            onClick={() => {
              if (drawing) { cancelDrawing() } else { drawPointsRef.current = []; setDrawing(true); setDrawVersion((v) => v + 1) }
            }}
            className={`w-full flex items-center justify-center gap-1.5 text-[11px] border rounded px-2 py-1.5 transition-colors ${
              drawing
                ? 'bg-blue-950 border-blue-600 text-blue-200 hover:bg-blue-900'
                : 'bg-gray-900 hover:bg-gray-800 border-gray-700 text-gray-300'
            }`}
          >
            {drawing ? <><X size={11} /> Annuler le tracé</> : <><Pencil size={11} /> Tracer une zone</>}
          </button>
          {zones.length > 0 && (
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {zones.map((z) => (
                <div key={z.id} className="flex items-center gap-1.5 text-[11px] text-gray-400 bg-gray-900 border border-gray-800 rounded px-2 py-1">
                  <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 shrink-0" />
                  <span className="flex-1 truncate">{z.name}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">{z.coords.length} pts</span>
                  <button
                    onClick={() => act.deleteZone(z.id)}
                    className="text-gray-500 hover:text-red-400"
                    aria-label="Supprimer la zone"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sources */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sources</h3>
            <span className="text-[10px] text-gray-500">{placedCount} / {lwSources.length} placées</span>
          </div>
          {lwSources.length === 0 && (
            <p className="text-[11px] text-gray-600 leading-tight">
              Aucune source disponible — calculez les Lw dans l'onglet <strong className="text-gray-500">Analyse → Calcul Lw</strong> d'abord.
            </p>
          )}
          <div className="space-y-1">
            {lwSources.map((ls) => {
              const s3d = sources3D.find((s) => s.id === ls.id)
              const isPlaced = s3d?.placed ?? false
              const isSelected = selectedSourceId === ls.id
              return (
                <button key={ls.id} onClick={() => setSelectedSourceId(isSelected ? null : ls.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-2 ${
                    isSelected ? 'bg-blue-950/50 ring-1 ring-blue-500 text-gray-100' : 'hover:bg-gray-900 text-gray-400'
                  }`}>
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

        {placedCount > 0 && (
          <div className="px-3 py-2 border-t border-gray-800">
            <button onClick={handleReset}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1.5 transition-colors">
              <RotateCcw size={12} /> Réinitialiser toutes les positions
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
          {osmStatus === 'empty' && <span className="text-amber-500/70">Aucun bâtiment OSM dans cette zone</span>}
          {osmStatus === 'error' && <span className="text-red-400/80">Erreur OSM — données indisponibles</span>}
          {osmStatus === 'idle' && <span className="text-gray-600">Zoomez davantage pour charger les bâtiments</span>}
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
