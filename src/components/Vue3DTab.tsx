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
  MapPin, StickyNote, Plus, Info, Edit3, Crosshair, Box, ArrowLeft,
  Ruler, Building2, Minus,
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
const LS_MEASUREMENTS = 'acoustiq_vue3d_measurements'
const LS_USER_BUILDINGS = 'acoustiq_vue3d_user_buildings'

// Distance haversine (m) entre deux positions lng/lat
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLng / 2)
  const aa = s1 * s1 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * s2 * s2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(aa)))
}

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
    // Modèle d'élévation Terrarium (AWS) — gratuit, sans clé
    'terrain-dem': {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 15,
    },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' },
    { id: 'satellite_labels', type: 'raster', source: 'satellite_labels', paint: { 'raster-opacity': 0.8 } },
  ],
  terrain: { source: 'terrain-dem', exaggeration: 1.3 },
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
  properties: { height: number; color: string }
}

/** Nuance de gris clair déterministe à partir d'un identifiant. */
function buildingColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const v = 188 + (Math.abs(h) % 34) // 188-221 → #BCBCBC..#DDDDDD
  const hex = v.toString(16).padStart(2, '0')
  return `#${hex}${hex}${hex}`
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

/** Surface approx d'un polygone lng/lat en m² (projection locale plane). */
function ringAreaM2(ring: number[][]): number {
  if (ring.length < 4) return 0
  const latRef = ring[0][1]
  const mPerDegLat = 111320
  const mPerDegLng = 111320 * Math.cos((latRef * Math.PI) / 180)
  let area = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * mPerDegLng
    const y1 = ring[i][1] * mPerDegLat
    const x2 = ring[i + 1][0] * mPerDegLng
    const y2 = ring[i + 1][1] * mPerDegLat
    area += x1 * y2 - x2 * y1
  }
  return Math.abs(area) / 2
}

/** Tire un entier déterministe 0..max-1 à partir d'une graine string. */
function seededInt(seed: string, max: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h) % max
}

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

  const buildings: BuildingFeature[] = []

  for (const way of xml.querySelectorAll('way')) {
    const wayId = way.getAttribute('id') || ''
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

    // Hauteur : tags OSM prioritaires, sinon variation 4-12m selon la surface
    let height: number
    if (heightTag) height = heightTag
    else if (levelsTag) height = levelsTag * 3.5
    else {
      const area = ringAreaM2(ring)
      const base = 4 + Math.min(8, Math.log10(Math.max(20, area)) * 3)
      const jitter = (seededInt(wayId, 1000) / 1000) * 2 - 1
      height = Math.max(3.5, Math.round((base + jitter) * 10) / 10)
    }

    buildings.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { height, color: buildingColor(wayId) },
    })
  }

  return buildings
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_pitch, setPitch] = useState<number>(scene3D?.view?.pitch ?? INITIAL_PITCH)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_bearing, setBearing] = useState<number>(scene3D?.view?.bearing ?? 0)
  const [osmStatus, setOsmStatus] = useState<OsmStatus>('idle')
  const [buildingCount, setBuildingCount] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)

  // Outil de mesure de distance
  const [measureTool, setMeasureTool] = useState(false)
  const measurePendingRef = useRef<[number, number] | null>(null)
  const [measurements, setMeasurements] = useState<
    Array<{ id: string; a: [number, number]; b: [number, number]; dMeters: number }>
  >(() => {
    try {
      const raw = localStorage.getItem(LS_MEASUREMENTS)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  const [sources3D, setSources3D] = useState<Source3D[]>(() => {
    if (scene3D?.sources) return scene3D.sources.map((s) => ({
      id: s.id, lng: s.lng, lat: s.lat, placed: !!(s.placed && s.lng !== undefined && s.lat !== undefined),
    }))
    return lwSources.map((s) => ({ id: s.id, placed: false }))
  })

  const [zones, setZones] = useState<Zone[]>(() => loadLS<Zone[]>(LS_ZONES, []))
  const [mpoints, setMpoints] = useState<MeasurementPoint[]>(() => loadLS<MeasurementPoint[]>(LS_MPOINTS, []))
  const [annotations, setAnnotations] = useState<Annotation[]>(() => loadLS<Annotation[]>(LS_ANNOTATIONS, []))
  const [userBuildings, setUserBuildings] = useState<Array<{ id: string; ring: [number, number][]; height: number }>>(
    () => loadLS(LS_USER_BUILDINGS, []),
  )

  const [drawing, setDrawing] = useState(false)
  const drawingRef = useRef(false)
  const measureToolRef = useRef(false)
  const rightDragMovedRef = useRef(false)
  const drawStartRef = useRef<[number, number] | null>(null)
  const drawEndRef = useRef<[number, number] | null>(null)
  const [drawVersion, setDrawVersion] = useState(0) // bump to trigger draft GeoJSON refresh

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [focusedZoneId, setFocusedZoneId] = useState<string | null>(null)

  pendingSelectionRef.current = selectedSourceId
  drawingRef.current = drawing
  measureToolRef.current = measureTool

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
  useEffect(() => { saveLS(LS_MEASUREMENTS, measurements) }, [measurements])
  useEffect(() => { saveLS(LS_USER_BUILDINGS, userBuildings) }, [userBuildings])

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

  const buildDraftGeoJSON = useCallback((): GeoJSON.FeatureCollection => {
    const s = drawStartRef.current
    const e = drawEndRef.current
    if (!s || !e) return { type: 'FeatureCollection', features: [] }
    const minLng = Math.min(s[0], e[0]), maxLng = Math.max(s[0], e[0])
    const minLat = Math.min(s[1], e[1]), maxLat = Math.max(s[1], e[1])
    const ring: [number, number][] = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      }],
    }
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

  // --- Fetch OSM buildings via Overpass ---
  // Endpoints testés dans l'ordre : overpass-api.de principal puis miroir kumi.
  // Chaque endpoint est retenté 3 fois avec un délai de 2 s avant de passer
  // au suivant. Les échecs ne bloquent pas le reste du modèle.
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]

  const fetchOsmBuildings = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    if (map.getZoom() < 14) { setOsmStatus('idle'); return }

    if (osmAbortRef.current) osmAbortRef.current.abort()
    const controller = new AbortController()
    osmAbortRef.current = controller

    setOsmStatus('loading')
    const b = map.getBounds()
    // Overpass QL : récupère uniquement les way[building] dans la bbox,
    // plus les nodes nécessaires. Moins lourd que /api/0.6/map complet.
    const query = `[out:xml][timeout:25];(way["building"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}););out body;>;out skel qt;`

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const tryEndpoint = async (endpoint: string): Promise<string | null> => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (controller.signal.aborted) return null
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal,
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return await res.text()
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return null
          if (attempt < 3) await sleep(2000)
        }
      }
      return null
    }

    let text: string | null = null
    for (const ep of OVERPASS_ENDPOINTS) {
      text = await tryEndpoint(ep)
      if (text !== null) break
    }
    if (controller.signal.aborted) return
    if (text === null) { setOsmStatus('error'); return }

    try {
      const buildings = parseOsmXmlToGeoJSON(text)
      const source = map.getSource('osm-buildings') as GeoJSONSource | undefined
      if (source) source.setData({ type: 'FeatureCollection', features: buildings } as GeoJSON.FeatureCollection)
      setBuildingCount(buildings.length)
      setOsmStatus(buildings.length === 0 ? 'empty' : 'loaded')
    } catch {
      setOsmStatus('error')
    }
  }, [])

  // --- Drawing helpers (rectangle drag) ---
  const cancelDrawing = useCallback(() => {
    drawStartRef.current = null
    drawEndRef.current = null
    setDrawing(false)
    setDrawVersion((v) => v + 1)
    mapRef.current?.dragPan.enable()
  }, [])

  // Focus 3D : cadre la zone et bascule en vue 3D inclinée
  const focus3DOnZone = useCallback((zoneId: string) => {
    const zone = zones.find((z) => z.id === zoneId)
    const map = mapRef.current
    if (!zone || !map) return
    const bounds = new maplibregl.LngLatBounds()
    for (const [lng, lat] of zone.coords) bounds.extend([lng, lat])
    setPitch(60)
    setBearing(0)
    setFocusedZoneId(zoneId)
    map.fitBounds(bounds, { padding: 70, pitch: 60, bearing: 0, duration: 900, maxZoom: 19 })
  }, [zones])

  const exit3DFocus = useCallback(() => {
    setFocusedZoneId(null)
    setPitch(INITIAL_PITCH)
    setBearing(0)
    mapRef.current?.easeTo({ pitch: INITIAL_PITCH, bearing: 0, duration: 500 })
  }, [])

  const startDrawing = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    // Vue dessus automatique
    setPitch(0)
    setBearing(0)
    map.easeTo({ pitch: 0, bearing: 0, duration: 350 })
    drawStartRef.current = null
    drawEndRef.current = null
    setDrawing(true)
    setDrawVersion((v) => v + 1)
    map.dragPan.disable()
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

    // Navigation 3D standard : gauche = rotation, droite = pan, double-clic = centrer.
    // On désactive les gestionnaires MapLibre par défaut et on câble nos propres
    // événements mousedown/move/up sur le canvas.
    map.dragPan.disable()
    map.dragRotate.disable()
    map.doubleClickZoom.disable()

    type NavState =
      | { mode: 'rotate'; sx: number; sy: number; sBearing: number; sPitch: number }
      | {
          mode: 'pending-right'
          sx: number; sy: number; sTime: number
          sCenter: { lng: number; lat: number }
          sLngLat: { lng: number; lat: number }
        }
      | { mode: 'pan'; sx: number; sy: number; sCenter: { lng: number; lat: number } }
      | { mode: 'idle' }
    const nav: { current: NavState } = { current: { mode: 'idle' } }

    const canvas = map.getCanvas()
    const RIGHT_CLICK_THRESHOLD_MS = 200
    const RIGHT_CLICK_THRESHOLD_PX = 3

    const onCanvasMouseDown = (e: MouseEvent) => {
      if (drawingRef.current || measureToolRef.current) return
      if (e.button === 0) {
        nav.current = {
          mode: 'rotate', sx: e.clientX, sy: e.clientY,
          sBearing: map.getBearing(), sPitch: map.getPitch(),
        }
      } else if (e.button === 2) {
        const c = map.getCenter()
        const rect = canvas.getBoundingClientRect()
        const pt: [number, number] = [e.clientX - rect.left, e.clientY - rect.top]
        const ll = map.unproject(pt)
        nav.current = {
          mode: 'pending-right',
          sx: e.clientX, sy: e.clientY,
          sTime: performance.now(),
          sCenter: { lng: c.lng, lat: c.lat },
          sLngLat: { lng: ll.lng, lat: ll.lat },
        }
      }
    }

    const applyPan = (p: { sx: number; sy: number; sCenter: { lng: number; lat: number } }, e: MouseEvent) => {
      const dx = e.clientX - p.sx
      const dy = e.clientY - p.sy
      const rect = canvas.getBoundingClientRect()
      const startPx: [number, number] = [rect.width / 2 - dx, rect.height / 2 - dy]
      const endPx: [number, number] = [rect.width / 2, rect.height / 2]
      const startLL = map.unproject(startPx)
      const endLL = map.unproject(endPx)
      map.jumpTo({
        center: [
          p.sCenter.lng + (startLL.lng - endLL.lng),
          p.sCenter.lat + (startLL.lat - endLL.lat),
        ],
      })
    }

    const onWindowMouseMove = (e: MouseEvent) => {
      const s = nav.current
      if (s.mode === 'rotate') {
        const dx = e.clientX - s.sx
        const dy = e.clientY - s.sy
        // Inversion du pivot : signes + sur bearing et pitch (au lieu de -)
        map.jumpTo({
          bearing: s.sBearing + dx * 0.3,
          pitch: Math.max(0, Math.min(60, s.sPitch + dy * 0.3)),
        })
        return
      }
      if (s.mode === 'pending-right') {
        const dx = e.clientX - s.sx
        const dy = e.clientY - s.sy
        const movedPx2 = dx * dx + dy * dy
        const elapsed = performance.now() - s.sTime
        if (movedPx2 > RIGHT_CLICK_THRESHOLD_PX * RIGHT_CLICK_THRESHOLD_PX || elapsed > RIGHT_CLICK_THRESHOLD_MS) {
          // Transition vers pan
          nav.current = { mode: 'pan', sx: s.sx, sy: s.sy, sCenter: s.sCenter }
          applyPan(nav.current, e)
        }
        return
      }
      if (s.mode === 'pan') {
        applyPan(s, e)
      }
    }

    const onWindowMouseUp = (e: MouseEvent) => {
      const s = nav.current
      if (s.mode === 'pending-right') {
        // Clic droit court et immobile → menu contextuel
        const elapsed = performance.now() - s.sTime
        if (elapsed < RIGHT_CLICK_THRESHOLD_MS) {
          const rect = canvas.getBoundingClientRect()
          const localX = e.clientX - rect.left
          const localY = e.clientY - rect.top
          const feats = map.queryRenderedFeatures([localX, localY], {
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
          setContextMenu({ x: localX, y: localY, lng: s.sLngLat.lng, lat: s.sLngLat.lat, target })
        }
        // Supprime le menu natif résiduel (si clic long sans déplacement)
        rightDragMovedRef.current = true
      } else if (s.mode === 'pan') {
        rightDragMovedRef.current = true
      }
      nav.current = { mode: 'idle' }
    }
    canvas.addEventListener('mousedown', onCanvasMouseDown)
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)

    // Double-clic gauche = centrer la vue sur ce point
    map.on('dblclick', (e) => {
      map.flyTo({ center: [e.lngLat.lng, e.lngLat.lat], duration: 500 })
    })

    map.on('load', () => {
      // Buildings
      map.addSource('osm-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'buildings-3d', type: 'fill-extrusion', source: 'osm-buildings',
        paint: {
          'fill-extrusion-color': ['coalesce', ['get', 'color'], '#c8c8c8'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      })
      // Toit : deuxième extrusion 0.5m plus haute, couleur légèrement plus sombre
      map.addLayer({
        id: 'buildings-roof', type: 'fill-extrusion', source: 'osm-buildings',
        paint: {
          'fill-extrusion-color': '#9ca3af',
          'fill-extrusion-height': ['+', ['get', 'height'], 0.5],
          'fill-extrusion-base': ['get', 'height'],
          'fill-extrusion-opacity': 0.9,
        },
      })
      // Arêtes : contour au sol en noir fin (subtil)
      map.addLayer({
        id: 'buildings-outline', type: 'line', source: 'osm-buildings',
        paint: {
          'line-color': '#000000',
          'line-opacity': 0.15,
          'line-width': 1,
        },
      })

      // Bâtiments ajoutés manuellement par l'utilisateur
      map.addSource('user-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'user-buildings-3d', type: 'fill-extrusion', source: 'user-buildings',
        paint: {
          'fill-extrusion-color': '#fbbf24',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.85,
          'fill-extrusion-vertical-gradient': true,
        },
      })
      map.addLayer({
        id: 'user-buildings-outline', type: 'line', source: 'user-buildings',
        paint: {
          'line-color': '#78350f',
          'line-opacity': 0.5,
          'line-width': 1.25,
        },
      })

      // Outil de mesure de distance : lignes + labels
      map.addSource('measurements', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'measurement-line', type: 'line', source: 'measurements',
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': '#fbbf24',
          'line-width': 2,
          'line-dasharray': [2, 1.5],
        },
      })
      map.addLayer({
        id: 'measurement-dot', type: 'circle', source: 'measurements',
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#fbbf24',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#422006',
        },
      })
      map.addLayer({
        id: 'measurement-label', type: 'symbol', source: 'measurements',
        filter: ['==', '$type', 'Point'],
        layout: {
          'text-field': ['get', 'label'],
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

      // Masque de focus 3D : polygone monde troué par la zone focus
      map.addSource('zone-mask', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'zone-mask-fill', type: 'fill', source: 'zone-mask',
        paint: { 'fill-color': '#000000', 'fill-opacity': 0.55 },
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

      // Zone draft (rectangle en cours de tracé)
      map.addSource('zone-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'zone-draft-fill', type: 'fill', source: 'zone-draft',
        paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.15 },
      })
      map.addLayer({
        id: 'zone-draft-outline', type: 'line', source: 'zone-draft',
        paint: { 'line-color': '#60a5fa', 'line-width': 2, 'line-dasharray': [2, 2] },
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

    // --- Left-click : sélection / placement de source (hors mode tracé) ---
    const onClick = (e: MapMouseEvent) => {
      setContextMenu(null)
      if (drawingRef.current) return // le tracé se fait via mousedown/move/up

      // Outil de mesure : premier clic = ancrage, deuxième clic = finalisation
      if (measureToolRef.current) {
        const pending = measurePendingRef.current
        if (!pending) {
          measurePendingRef.current = [e.lngLat.lng, e.lngLat.lat]
          // Affichage d'un point provisoire
        } else {
          const b: [number, number] = [e.lngLat.lng, e.lngLat.lat]
          const d = haversineMeters(pending, b)
          setMeasurements((prev) => [...prev, {
            id: genId('m'),
            a: pending,
            b,
            dMeters: d,
          }])
          measurePendingRef.current = null
        }
        return
      }

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

    // --- Tracé de zone : mousedown / mousemove / mouseup (rectangle drag) ---
    const onMouseDown = (e: MapMouseEvent) => {
      if (!drawingRef.current) return
      drawStartRef.current = [e.lngLat.lng, e.lngLat.lat]
      drawEndRef.current = [e.lngLat.lng, e.lngLat.lat]
      setDrawVersion((v) => v + 1)
    }
    const onMouseMove = (e: MapMouseEvent) => {
      if (!drawingRef.current || !drawStartRef.current) return
      drawEndRef.current = [e.lngLat.lng, e.lngLat.lat]
      setDrawVersion((v) => v + 1)
    }
    const onMouseUp = (e: MapMouseEvent) => {
      if (!drawingRef.current || !drawStartRef.current) return
      const s = drawStartRef.current
      const end: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      const minLng = Math.min(s[0], end[0]), maxLng = Math.max(s[0], end[0])
      const minLat = Math.min(s[1], end[1]), maxLat = Math.max(s[1], end[1])
      // Rejeter rectangles dégénérés (< ~1 m)
      if ((maxLng - minLng) < 1e-5 || (maxLat - minLat) < 1e-5) {
        cancelDrawing()
        return
      }
      const coords: [number, number][] = [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
      ]
      const defaultName = `Zone ${zones.length + 1}`
      const name = window.prompt('Nom de la zone :', defaultName)?.trim() || defaultName
      setZones((prev) => [...prev, { id: genId('zone'), name, coords }])
      drawStartRef.current = null
      drawEndRef.current = null
      setDrawing(false)
      setDrawVersion((v) => v + 1)
      map.dragPan.enable()
    }
    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)

    // Menu contextuel : géré via mouseup ci-dessus (clic droit court + immobile).

    // Suppress the native browser context menu on the map container as a safety net
    const suppressNative = (ev: MouseEvent) => ev.preventDefault()
    container.addEventListener('contextmenu', suppressNative)

    return () => {
      if (osmAbortRef.current) osmAbortRef.current.abort()
      if (moveTimerRef.current) clearTimeout(moveTimerRef.current)
      container.removeEventListener('contextmenu', suppressNative)
      canvas.removeEventListener('mousedown', onCanvasMouseDown)
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
      map.off('click', onClick)
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
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
    if (drawing || measureTool) map.getCanvas().style.cursor = 'crosshair'
    else map.getCanvas().style.cursor = selectedSourceId ? 'crosshair' : ''
  }, [selectedSourceId, drawing, measureTool])

  // --- Keyboard: Esc closes menu / cancels drawing ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contextMenu) { setContextMenu(null); return }
        if (drawing) { cancelDrawing(); return }
        if (measureTool) {
          setMeasureTool(false)
          measurePendingRef.current = null
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [contextMenu, drawing, cancelDrawing, measureTool])

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
    ;(map.getSource('zone-draft') as GeoJSONSource | undefined)?.setData(buildDraftGeoJSON())
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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const src = map.getSource('user-buildings') as GeoJSONSource | undefined
    if (!src) return
    src.setData({
      type: 'FeatureCollection',
      features: userBuildings.map((b) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [b.ring] },
        properties: { id: b.id, height: b.height },
      })),
    } as GeoJSON.FeatureCollection)
  }, [userBuildings])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const features: GeoJSON.Feature[] = []
    for (const m of measurements) {
      const label = m.dMeters >= 1000
        ? `${(m.dMeters / 1000).toFixed(2)} km`
        : `${m.dMeters.toFixed(1)} m`
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [m.a, m.b] },
        properties: { id: m.id, label },
      })
      const mid: [number, number] = [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2]
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: mid },
        properties: { id: m.id, label },
      })
    }
    ;(map.getSource('measurements') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection', features,
    } as GeoJSON.FeatureCollection)
  }, [measurements])

  // Clear focus si la zone ciblée n'existe plus
  useEffect(() => {
    if (focusedZoneId && !zones.some((z) => z.id === focusedZoneId)) {
      setFocusedZoneId(null)
    }
  }, [zones, focusedZoneId])


  // Mask focus 3D : outer monde + zone en trou
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const src = map.getSource('zone-mask') as GeoJSONSource | undefined
    if (!src) return
    if (!focusedZoneId) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const zone = zones.find((z) => z.id === focusedZoneId)
    if (!zone) { src.setData({ type: 'FeatureCollection', features: [] }); return }
    const outer: [number, number][] = [
      [-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85],
    ]
    const hole: [number, number][] = [...zone.coords]
    if (hole.length > 0) {
      const f = hole[0], l = hole[hole.length - 1]
      if (f[0] !== l[0] || f[1] !== l[1]) hole.push(f)
    }
    hole.reverse() // exterior CCW, hole CW
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [outer, hole] },
        properties: {},
      }],
    })
  }, [focusedZoneId, zones])

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
    addBuildingHere: (lng: number, lat: number) => {
      const wStr = window.prompt('Largeur du bâtiment (mètres) :', '10')
      if (wStr === null) return
      const lStr = window.prompt('Longueur du bâtiment (mètres) :', '15')
      if (lStr === null) return
      const hStr = window.prompt('Hauteur du bâtiment (mètres) :', '6')
      if (hStr === null) return
      const w = Math.max(1, parseFloat(wStr || '10'))
      const l = Math.max(1, parseFloat(lStr || '15'))
      const h = Math.max(1, parseFloat(hStr || '6'))
      // Convertit m → degrés (approx locale plane)
      const mPerDegLat = 111320
      const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180)
      const dLng = w / 2 / mPerDegLng
      const dLat = l / 2 / mPerDegLat
      const ring: [number, number][] = [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ]
      setUserBuildings((prev) => [...prev, { id: genId('ub'), ring, height: h }])
    },
    addBarrierHere: (_lng: number, _lat: number) => {
      window.alert('Barrière acoustique — fonctionnalité à venir (tracé linéaire + hauteur).')
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
      { label: 'Ajouter un bâtiment ici', icon: <Building2 size={12} />, action: () => act.addBuildingHere(lng, lat) },
      { label: 'Ajouter une barrière acoustique ici', icon: <Minus size={12} />, action: () => act.addBarrierHere(lng, lat) },
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

        {/* Bandeau focus modèle 3D */}
        {focusedZoneId && (() => {
          const z = zones.find((x) => x.id === focusedZoneId)
          if (!z) return null
          return (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-gray-950/95 border border-emerald-600 rounded px-3 py-1.5 text-xs text-emerald-300 shadow-lg z-10 flex items-center gap-2">
              <Box size={12} />
              Modèle 3D — {z.name} · {buildingCount} bâtiment{buildingCount > 1 ? 's' : ''}
              <button
                onClick={exit3DFocus}
                className="ml-2 text-xs text-gray-300 hover:text-gray-100 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-2 py-0.5 flex items-center gap-1 transition-colors"
              >
                <ArrowLeft size={11} /> Retour à la carte
              </button>
            </div>
          )
        })()}

        {/* Drawing hint overlay */}
        {drawing && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-gray-950/95 border border-blue-600 rounded px-3 py-1.5 text-xs text-blue-300 shadow-lg z-10 flex items-center gap-2">
            <Pencil size={12} />
            Cliquez-glissez sur la carte pour définir un rectangle · Relâchez pour valider · Échap pour annuler
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
          <p className="text-[10px] text-gray-500 leading-tight">
            Clic gauche = rotation · Clic droit = pan · Molette = zoom · Double-clic = centrer
          </p>
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

        {/* Outils de mesure */}
        <div className="px-3 py-3 border-b border-gray-800 space-y-1.5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
            <Ruler size={12} /> Outils
          </h3>
          <button
            onClick={() => {
              setMeasureTool((v) => {
                if (v) measurePendingRef.current = null
                return !v
              })
            }}
            className={`w-full flex items-center justify-center gap-1.5 text-[11px] border rounded px-2 py-1.5 transition-colors ${
              measureTool
                ? 'bg-amber-950/60 border-amber-600 text-amber-200 hover:bg-amber-900/70'
                : 'bg-gray-900 hover:bg-gray-800 border-gray-700 text-gray-300'
            }`}
          >
            {measureTool ? <><X size={11} /> Quitter mesure</> : <><Ruler size={11} /> Mesurer distance</>}
          </button>
          {measurements.length > 0 && (
            <>
              <div className="space-y-0.5 max-h-36 overflow-y-auto">
                {measurements.map((m, i) => (
                  <div key={m.id} className="flex items-center gap-1 text-[10px] text-gray-400 bg-gray-900 rounded px-1.5 py-0.5">
                    <span className="text-amber-300 shrink-0">#{i + 1}</span>
                    <span className="flex-1 truncate font-mono">
                      {m.dMeters >= 1000 ? `${(m.dMeters / 1000).toFixed(2)} km` : `${m.dMeters.toFixed(1)} m`}
                    </span>
                    <button
                      onClick={() => setMeasurements((prev) => prev.filter((x) => x.id !== m.id))}
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Supprimer mesure"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setMeasurements([])}
                className="w-full flex items-center justify-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 bg-gray-900 hover:bg-gray-800 border border-gray-800 rounded px-2 py-1 transition-colors"
              >
                <Trash2 size={10} /> Effacer toutes les mesures
              </button>
            </>
          )}
        </div>

        {/* Drawing tool */}
        <div className="px-3 py-3 border-b border-gray-800 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
            <Pencil size={12} /> Zones de modélisation
          </h3>
          <button
            onClick={() => {
              if (drawing) cancelDrawing(); else startDrawing()
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
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {zones.map((z) => {
                const isFocused = focusedZoneId === z.id
                return (
                  <div key={z.id} className={`bg-gray-900 border rounded px-2 py-1.5 space-y-1 ${isFocused ? 'border-emerald-600/80' : 'border-gray-800'}`}>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                      <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 shrink-0" />
                      <span className="flex-1 truncate">{z.name}</span>
                      <span className="text-[10px] text-gray-600 shrink-0">{z.coords.length} pts</span>
                      <button
                        onClick={() => { if (isFocused) exit3DFocus(); act.deleteZone(z.id) }}
                        className="text-gray-500 hover:text-red-400"
                        aria-label="Supprimer la zone"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <button
                      onClick={() => isFocused ? exit3DFocus() : focus3DOnZone(z.id)}
                      className={`w-full flex items-center justify-center gap-1.5 text-[10px] rounded px-2 py-1 border transition-colors ${
                        isFocused
                          ? 'bg-emerald-950/60 border-emerald-700 text-emerald-200 hover:bg-emerald-900/60'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <Box size={10} />
                      {isFocused ? 'Modèle 3D actif — sortir' : 'Générer le modèle 3D'}
                    </button>
                  </div>
                )
              })}
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
          {osmStatus === 'error' && <span className="text-amber-400/80">Bâtiments OSM indisponibles (Overpass hors-ligne)</span>}
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
