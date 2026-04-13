/**
 * Vue 3D — sélection de zone sur carte OSM → modèle 3D avec bâtiments extrudés
 * Mode 1 : carte Leaflet avec dessin rectangle + recherche
 * Mode 2 : scène Three.js avec bâtiments OSM + placement de sources
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Box, RotateCcw, Eye, ArrowLeft, Search, Loader2, MapPin } from 'lucide-react'
import type { LwSourceSummary, Scene3DData } from '../types'

// Fix default Leaflet icon bug
/* eslint-disable @typescript-eslint/no-explicit-any */
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
/* eslint-enable @typescript-eslint/no-explicit-any */
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// --- Constants ----------------------------------------------------------------

function lwColor(lw: number): string {
  if (lw >= 115) return '#E24B4A'
  if (lw >= 110) return '#EF9F27'
  if (lw >= 100) return '#FAC775'
  if (lw >= 90) return '#639922'
  return '#1D9E75'
}

function lwColorHex(lw: number): number {
  if (lw >= 115) return 0xe24b4a
  if (lw >= 110) return 0xef9f27
  if (lw >= 100) return 0xfac775
  if (lw >= 90) return 0x639922
  return 0x1d9e75
}

// --- Types --------------------------------------------------------------------

interface Source3D {
  id: string
  x: number
  y: number
  z: number
  placed: boolean
}

interface BBox {
  south: number
  west: number
  north: number
  east: number
}

interface OsmNode {
  type: 'node'
  id: number
  lat: number
  lon: number
}

interface OsmWay {
  type: 'way'
  id: number
  nodes: number[]
  tags?: Record<string, string>
}

interface BuildingFootprint {
  coords: Array<{ x: number; z: number }>  // in local meters
  height: number
}

interface Props {
  lwSources: LwSourceSummary[]
  scene3D: Scene3DData | undefined
  onScene3DChange: (data: Scene3DData) => void
}

// --- OSM helpers --------------------------------------------------------------

function parseOsmBuildings(
  data: { elements: Array<OsmNode | OsmWay> },
  bbox: BBox,
): BuildingFootprint[] {
  const nodes = new Map<number, { lat: number; lon: number }>()
  for (const el of data.elements) {
    if (el.type === 'node') nodes.set(el.id, { lat: el.lat, lon: el.lon })
  }

  const centerLat = (bbox.south + bbox.north) / 2
  const centerLon = (bbox.west + bbox.east) / 2
  const mPerDegLat = 111000
  const mPerDegLon = 111000 * Math.cos((centerLat * Math.PI) / 180)

  const buildings: BuildingFootprint[] = []
  for (const el of data.elements) {
    if (el.type !== 'way') continue
    const way = el as OsmWay
    if (!way.tags?.building) continue

    const coords: Array<{ x: number; z: number }> = []
    for (const nid of way.nodes) {
      const nd = nodes.get(nid)
      if (!nd) continue
      coords.push({
        x: (nd.lon - centerLon) * mPerDegLon,
        z: -(nd.lat - centerLat) * mPerDegLat,  // flip Z so north is -Z
      })
    }
    if (coords.length < 3) continue

    let height = 10
    if (way.tags['building:levels']) {
      const levels = parseFloat(way.tags['building:levels'])
      if (!isNaN(levels) && levels > 0) height = levels * 3
    }
    if (way.tags['height']) {
      const h = parseFloat(way.tags['height'])
      if (!isNaN(h) && h > 0) height = h
    }

    buildings.push({ coords, height })
  }
  return buildings
}

// --- Map Mode -----------------------------------------------------------------

function MapMode({ onBuild, initialBbox }: {
  onBuild: (bbox: BBox) => void
  initialBbox: BBox | undefined
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const rectRef = useRef<L.Rectangle | null>(null)
  const drawStartRef = useRef<L.LatLng | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [bbox, setBbox] = useState<BBox | null>(initialBbox ?? null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const container = mapContainerRef.current
    if (!container || mapRef.current) return

    const map = L.map(container, {
      center: [46.3833, -75.9833],
      zoom: 15,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map

    // Restore existing rectangle if bbox was saved
    if (initialBbox) {
      const rect = L.rectangle(
        [[initialBbox.south, initialBbox.west], [initialBbox.north, initialBbox.east]],
        { color: '#3b82f6', weight: 2, fillOpacity: 0.15 },
      ).addTo(map)
      rectRef.current = rect
      map.fitBounds(rect.getBounds(), { padding: [40, 40] })
    }

    // Rectangle drawing
    let drawing = false

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.button !== 0) return
      drawing = true
      drawStartRef.current = e.latlng
      map.dragging.disable()
      if (rectRef.current) { map.removeLayer(rectRef.current); rectRef.current = null }
    }

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!drawing || !drawStartRef.current) return
      const bounds = L.latLngBounds(drawStartRef.current, e.latlng)
      if (rectRef.current) {
        rectRef.current.setBounds(bounds)
      } else {
        rectRef.current = L.rectangle(bounds, {
          color: '#3b82f6', weight: 2, fillOpacity: 0.15,
        }).addTo(map)
      }
    }

    const onMouseUp = () => {
      if (!drawing) return
      drawing = false
      map.dragging.enable()
      drawStartRef.current = null
      if (rectRef.current) {
        const b = rectRef.current.getBounds()
        setBbox({
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        })
      }
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)

    return () => {
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      map.remove()
      mapRef.current = null
    }
  }, [initialBbox])

  const handleSearch = async () => {
    if (!searchQuery.trim() || !mapRef.current) return
    setSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery.trim())}`,
      )
      const results: Array<{ lat: string; lon: string }> = await res.json()
      if (results.length > 0) {
        const lat = parseFloat(results[0].lat)
        const lon = parseFloat(results[0].lon)
        mapRef.current.setView([lat, lon], 16)
      }
    } catch { /* ignore geocoding errors */ }
    finally { setSearching(false) }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Search bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
        <Search size={14} className="text-gray-500 shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Rechercher un lieu..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={searching || !searchQuery.trim()}
          className="text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-3 py-1 transition-colors disabled:opacity-50"
        >
          {searching ? <Loader2 size={12} className="animate-spin" /> : 'Centrer'}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-gray-500">
            <MapPin size={10} className="inline mr-0.5" />
            Dessinez un rectangle autour de la zone à modéliser
          </span>
          <button
            onClick={() => bbox && onBuild(bbox)}
            disabled={!bbox}
            className="text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded px-3 py-1.5 transition-colors whitespace-nowrap"
          >
            Construire le modèle 3D
          </button>
        </div>
      </div>
      {/* Map */}
      <div ref={mapContainerRef} className="flex-1 min-h-0" style={{ cursor: 'crosshair' }} />
    </div>
  )
}

// --- 3D Mode ------------------------------------------------------------------

function ThreeDMode({ buildings, bbox, lwSources, sources3D, setSources3D, selectedSourceId, setSelectedSourceId, onBack }: {
  buildings: BuildingFootprint[]
  bbox: BBox
  lwSources: LwSourceSummary[]
  sources3D: Source3D[]
  setSources3D: React.Dispatch<React.SetStateAction<Source3D[]>>
  selectedSourceId: string | null
  setSelectedSourceId: React.Dispatch<React.SetStateAction<string | null>>
  onBack: () => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const spheresRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const groundRef = useRef<THREE.Mesh | null>(null)
  const roofMeshesRef = useRef<THREE.Mesh[]>([])
  const animFrameRef = useRef<number>(0)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  // Scene dimensions in meters
  const centerLat = (bbox.south + bbox.north) / 2
  const mPerDegLat = 111000
  const mPerDegLon = 111000 * Math.cos((centerLat * Math.PI) / 180)
  const groundW = (bbox.east - bbox.west) * mPerDegLon
  const groundD = (bbox.north - bbox.south) * mPerDegLat

  // --- Three.js setup ---
  useEffect(() => {
    const container = canvasRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)
    sceneRef.current = scene

    const w = container.clientWidth
    const h = container.clientHeight
    const diagonal = Math.sqrt(groundW * groundW + groundD * groundD)
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, diagonal * 5)
    camera.position.set(groundW * 0.6, diagonal * 0.4, groundD * 0.6)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2 - 0.05

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(groundW * 0.5, diagonal * 0.5, groundD * 0.5)
    scene.add(dirLight)

    // Ground
    const gndGeo = new THREE.PlaneGeometry(groundW * 1.3, groundD * 1.3)
    const gndMat = new THREE.MeshStandardMaterial({ color: 0x4a6741, roughness: 0.9 })
    const ground = new THREE.Mesh(gndGeo, gndMat)
    ground.rotation.x = -Math.PI / 2
    ground.name = 'ground'
    scene.add(ground)
    groundRef.current = ground

    // Grid
    const gridSize = Math.max(groundW, groundD) * 1.3
    const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / 10), 0x555555, 0x333333)
    grid.position.y = 0.05
    scene.add(grid)

    // Buildings
    const buildingMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.15 })
    const roofMeshes: THREE.Mesh[] = []
    for (const b of buildings) {
      const shape = new THREE.Shape()
      shape.moveTo(b.coords[0].x, b.coords[0].z)
      for (let i = 1; i < b.coords.length; i++) {
        shape.lineTo(b.coords[i].x, b.coords[i].z)
      }
      shape.closePath()

      const extGeo = new THREE.ExtrudeGeometry(shape, {
        depth: b.height,
        bevelEnabled: false,
      })
      const mesh = new THREE.Mesh(extGeo, buildingMat.clone())
      // ExtrudeGeometry extrudes along Z; we rotate so extrusion goes up (Y)
      mesh.rotation.x = -Math.PI / 2
      mesh.name = 'building-osm'
      roofMeshes.push(mesh)
      scene.add(mesh)
    }
    roofMeshesRef.current = roofMeshes

    // Animation
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize
    const resObs = new ResizeObserver(() => {
      const cw = container.clientWidth
      const ch = container.clientHeight
      camera.aspect = cw / ch
      camera.updateProjectionMatrix()
      renderer.setSize(cw, ch)
    })
    resObs.observe(container)

    return () => {
      resObs.disconnect()
      cancelAnimationFrame(animFrameRef.current)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const mat = obj.material
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat.dispose()
        }
      })
    }
  }, [buildings, bbox, groundW, groundD])

  // --- Source spheres ---
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    for (const [, mesh] of spheresRef.current) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      scene.remove(mesh)
    }
    spheresRef.current.clear()

    for (const s3d of sources3D) {
      if (!s3d.placed) continue
      const lwSrc = lwSources.find((ls) => ls.id === s3d.id)
      if (!lwSrc) continue
      const geo = new THREE.SphereGeometry(3, 24, 24)
      const mat = new THREE.MeshStandardMaterial({
        color: lwColorHex(lwSrc.lw), roughness: 0.4,
        emissive: lwColorHex(lwSrc.lw), emissiveIntensity: 0.15,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(s3d.x, s3d.y, s3d.z)
      mesh.name = `source-${s3d.id}`
      mesh.userData = { sourceId: s3d.id }
      scene.add(mesh)
      spheresRef.current.set(s3d.id, mesh)
    }
  }, [sources3D, lwSources])

  // --- Raycasting ---
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer) return

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    function onClick(e: MouseEvent) {
      const camera = cameraRef.current
      const scene = sceneRef.current
      if (!camera || !scene) return

      const rect = renderer!.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)

      // Check spheres first
      const sphereArr = Array.from(spheresRef.current.values())
      const sphereHits = raycaster.intersectObjects(sphereArr)
      if (sphereHits.length > 0) {
        const srcId = (sphereHits[0].object as THREE.Mesh).userData.sourceId as string
        setSelectedSourceId(srcId)
        return
      }

      // Check roof meshes + ground
      const targets: THREE.Object3D[] = [...roofMeshesRef.current]
      if (groundRef.current) targets.push(groundRef.current)
      const hits = raycaster.intersectObjects(targets)
      if (hits.length > 0) {
        const pt = hits[0].point
        setSelectedSourceId((sel) => {
          if (!sel) return sel
          setSources3D((prev) => prev.map((s) =>
            s.id === sel ? { ...s, x: pt.x, y: pt.y, z: pt.z, placed: true } : s
          ))
          return sel
        })
      }
    }

    function onMouseMove(e: MouseEvent) {
      const camera = cameraRef.current
      if (!camera) return

      const rect = renderer!.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)

      const sphereArr = Array.from(spheresRef.current.values())
      const hits = raycaster.intersectObjects(sphereArr)
      if (hits.length > 0) {
        const srcId = (hits[0].object as THREE.Mesh).userData.sourceId as string
        const lwSrc = lwSources.find((ls) => ls.id === srcId)
        if (lwSrc) {
          const canvasRect = canvasRef.current?.getBoundingClientRect()
          setTooltip({
            x: e.clientX - (canvasRect?.left ?? 0),
            y: e.clientY - (canvasRect?.top ?? 0),
            text: `${lwSrc.name} — ${lwSrc.lw.toFixed(1)} dBA`,
          })
          return
        }
      }
      setTooltip(null)
    }

    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    return () => {
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
    }
  }, [lwSources, setSources3D, setSelectedSourceId])

  // --- Highlight selected ---
  useEffect(() => {
    for (const [id, mesh] of spheresRef.current) {
      const lwSrc = lwSources.find((ls) => ls.id === id)
      const baseColor = lwSrc ? lwColorHex(lwSrc.lw) : 0x888888
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (id === selectedSourceId) {
        mat.emissiveIntensity = 0.6
        mesh.scale.setScalar(1.3)
      } else {
        mat.color.setHex(baseColor)
        mat.emissiveIntensity = 0.15
        mesh.scale.setScalar(1.0)
      }
    }
  }, [selectedSourceId, lwSources])

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Canvas */}
      <div className="flex-1 relative" ref={canvasRef} style={{ minHeight: 400 }}>
        {tooltip && (
          <div
            className="absolute pointer-events-none bg-gray-900/90 text-gray-100 text-xs px-2 py-1 rounded shadow-lg border border-gray-700 z-10"
            style={{ left: tooltip.x + 12, top: tooltip.y - 28 }}
          >
            {tooltip.text}
          </div>
        )}
        {selectedSourceId && (
          <div className="absolute top-3 left-3 bg-gray-900/80 text-gray-300 text-xs px-3 py-1.5 rounded border border-gray-700 z-10">
            Cliquez sur un bâtiment ou le sol pour placer la source
          </div>
        )}
        <div className="absolute bottom-2 left-2 text-[10px] text-gray-600">
          {buildings.length} bâtiment{buildings.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Side panel */}
      <div className="w-60 shrink-0 border-l border-gray-800 bg-gray-950 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-800">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            <ArrowLeft size={13} />
            Retour à la carte
          </button>
        </div>

        {/* Sources */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Sources ({lwSources.length})
          </h3>
          {lwSources.length === 0 && (
            <p className="text-[11px] text-gray-600 leading-tight">
              Aucune source disponible — calculez les Lw dans l'onglet <strong className="text-gray-500">Puissance Lw</strong> d'abord.
            </p>
          )}
          {lwSources.map((ls) => {
            const s3d = sources3D.find((s) => s.id === ls.id)
            const isPlaced = s3d?.placed ?? false
            const isSelected = selectedSourceId === ls.id
            return (
              <button
                key={ls.id}
                onClick={() => setSelectedSourceId(ls.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-2 ${
                  isSelected
                    ? 'bg-gray-800 ring-1 ring-blue-500 text-gray-100'
                    : 'hover:bg-gray-900 text-gray-400'
                }`}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: lwColor(ls.lw) }}
                />
                <span className="flex-1 truncate">{ls.name}</span>
                <span className="text-[10px] text-gray-500 shrink-0">{ls.lw.toFixed(0)} dB</span>
                <span className="text-[10px] shrink-0" title={isPlaced ? 'Placée' : 'Non placée'}>
                  {isPlaced ? (
                    <Eye size={11} className="text-green-400" />
                  ) : (
                    <span className="text-gray-600">○</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>

        {lwSources.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-800">
            <button
              onClick={() => {
                setSources3D((prev) => prev.map((s) => ({ ...s, x: 0, y: 0, z: 0, placed: false })))
                setSelectedSourceId(null)
              }}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1.5 transition-colors"
            >
              <RotateCcw size={12} />
              Réinitialiser positions
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// --- Main component -----------------------------------------------------------

export default function Vue3DTab({ lwSources, scene3D, onScene3DChange }: Props) {
  const [mode, setMode] = useState<'map' | '3d'>(scene3D?.bbox ? '3d' : 'map')
  const [buildings, setBuildings] = useState<BuildingFootprint[]>([])
  const [bbox, setBbox] = useState<BBox | undefined>(scene3D?.bbox)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)

  const [sources3D, setSources3D] = useState<Source3D[]>(() => {
    if (scene3D?.sources) return scene3D.sources
    return lwSources.map((s) => ({ id: s.id, x: 0, y: 0, z: 0, placed: false }))
  })

  // Sync sources3D when lwSources changes
  useEffect(() => {
    setSources3D((prev) => {
      const existing = new Map(prev.map((s) => [s.id, s]))
      return lwSources.map((ls) => existing.get(ls.id) ?? { id: ls.id, x: 0, y: 0, z: 0, placed: false })
    })
  }, [lwSources])

  // Persist to parent
  const persistScene = useCallback((bx: BBox | undefined, srcs: Source3D[]) => {
    const bld = scene3D?.building ?? { width: 120, depth: 70, height: 15 }
    onScene3DChange({ building: bld, sources: srcs, bbox: bx })
  }, [onScene3DChange, scene3D?.building])

  useEffect(() => { persistScene(bbox, sources3D) }, [bbox, sources3D, persistScene])

  // Fetch buildings from Overpass when bbox saved + mode is 3d but no buildings loaded
  useEffect(() => {
    if (mode !== '3d' || !bbox || buildings.length > 0) return
    fetchBuildings(bbox)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const fetchBuildings = async (b: BBox) => {
    setLoading(true)
    setLoadError(null)
    try {
      const query = `[out:json][timeout:25];(way["building"](${b.south},${b.west},${b.north},${b.east}););out body;>;out skel qt;`
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      if (!res.ok) throw new Error(`Overpass API: ${res.status}`)
      const data = await res.json()
      const parsed = parseOsmBuildings(data, b)
      setBuildings(parsed)
      setBbox(b)
      setMode('3d')
    } catch (err) {
      setLoadError(String((err as Error).message ?? err))
    } finally {
      setLoading(false)
    }
  }

  const handleBuild = (b: BBox) => {
    setBuildings([])
    fetchBuildings(b)
  }

  const handleBack = () => {
    setMode('map')
  }

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
        <Loader2 size={32} className="animate-spin text-blue-500" />
        <p className="text-sm">Récupération des bâtiments...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3 p-10">
        <Box size={40} className="opacity-40" />
        <p className="text-sm text-center text-red-400">{loadError}</p>
        <button
          onClick={() => { setLoadError(null); setMode('map') }}
          className="text-xs text-gray-400 hover:text-gray-200 bg-gray-900 border border-gray-700 rounded px-3 py-1.5"
        >
          Retour à la carte
        </button>
      </div>
    )
  }

  if (mode === 'map') {
    return <MapMode onBuild={handleBuild} initialBbox={bbox} />
  }

  return (
    <ThreeDMode
      buildings={buildings}
      bbox={bbox!}
      lwSources={lwSources}
      sources3D={sources3D}
      setSources3D={setSources3D}
      selectedSourceId={selectedSourceId}
      setSelectedSourceId={setSelectedSourceId}
      onBack={handleBack}
    />
  )
}
