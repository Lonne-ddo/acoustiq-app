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
import { Box, RotateCcw, Eye, ArrowLeft, Search, Loader2, MapPin, ImageIcon, X, AlertTriangle } from 'lucide-react'
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

function parseOsmXml(xmlText: string, bbox: BBox): BuildingFootprint[] {
  const parser = new DOMParser()
  const xml = parser.parseFromString(xmlText, 'application/xml')

  // Build node lookup: id → {lat, lon}
  const nodes = new Map<string, { lat: number; lon: number }>()
  for (const node of xml.querySelectorAll('node')) {
    const id = node.getAttribute('id')
    const lat = node.getAttribute('lat')
    const lon = node.getAttribute('lon')
    if (id && lat && lon) nodes.set(id, { lat: parseFloat(lat), lon: parseFloat(lon) })
  }

  const centerLat = (bbox.south + bbox.north) / 2
  const centerLon = (bbox.west + bbox.east) / 2
  const mPerDegLat = 111000
  const mPerDegLon = 111000 * Math.cos((centerLat * Math.PI) / 180)

  const buildings: BuildingFootprint[] = []
  for (const way of xml.querySelectorAll('way')) {
    // Check if this way has a building tag
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

    // Reconstruct polygon from nd refs
    const coords: Array<{ x: number; z: number }> = []
    for (const nd of way.querySelectorAll('nd')) {
      const ref = nd.getAttribute('ref')
      if (!ref) continue
      const node = nodes.get(ref)
      if (!node) continue
      coords.push({
        x: (node.lon - centerLon) * mPerDegLon,
        z: -(node.lat - centerLat) * mPerDegLat,
      })
    }
    if (coords.length < 3) continue

    let height = 10
    if (levelsTag) height = levelsTag * 3.5
    if (heightTag) height = heightTag

    buildings.push({ coords, height })
  }
  return buildings
}

// --- Map helpers --------------------------------------------------------------

function computeBoundsArea(bounds: L.LatLngBounds): number {
  const s = bounds.getSouth(), n = bounds.getNorth()
  const w = bounds.getWest(), e = bounds.getEast()
  const centerLat = (s + n) / 2
  const dLatKm = (n - s) * 111
  const dLngKm = (e - w) * 111 * Math.cos((centerLat * Math.PI) / 180)
  return dLatKm * dLngKm
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
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [bbox, setBbox] = useState<BBox | null>(initialBbox ?? null)
  const [searching, setSearching] = useState(false)
  const [areaKm2, setAreaKm2] = useState<number | null>(() => {
    if (!initialBbox) return null
    const b = L.latLngBounds(
      [initialBbox.south, initialBbox.west],
      [initialBbox.north, initialBbox.east],
    )
    return computeBoundsArea(b)
  })
  const [isDrawing, setIsDrawing] = useState(false)
  const [flashMsg, setFlashMsg] = useState<string | null>(null)

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

    // Force Leaflet to recalculate dimensions after layout settles
    setTimeout(() => { map.invalidateSize() }, 100)

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
      setIsDrawing(true)
      drawStartRef.current = e.latlng
      map.dragging.disable()
      if (rectRef.current) { map.removeLayer(rectRef.current); rectRef.current = null }
      setBbox(null)
      setAreaKm2(null)
      setFlashMsg(null)
    }

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!drawing || !drawStartRef.current) return
      const bounds = L.latLngBounds(drawStartRef.current, e.latlng)
      const area = computeBoundsArea(bounds)
      setAreaKm2(area)

      const color = area > 1.0 ? '#E24B4A' : area > 0.8 ? '#EF9F27' : '#3b82f6'

      if (rectRef.current) {
        rectRef.current.setBounds(bounds)
        rectRef.current.setStyle({ color, fillOpacity: 0.15 })
      } else {
        rectRef.current = L.rectangle(bounds, {
          color, weight: 2, fillOpacity: 0.15,
        }).addTo(map)
      }
    }

    const onMouseUp = () => {
      if (!drawing) return
      drawing = false
      setIsDrawing(false)
      map.dragging.enable()
      drawStartRef.current = null

      if (rectRef.current) {
        const b = rectRef.current.getBounds()
        const area = computeBoundsArea(b)
        setAreaKm2(area)

        if (area > 1.0) {
          // Too large — remove rectangle and flash message
          map.removeLayer(rectRef.current)
          rectRef.current = null
          setBbox(null)
          setFlashMsg('Zone trop grande — recommencez avec une zone plus petite')
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
          flashTimerRef.current = setTimeout(() => setFlashMsg(null), 2000)
        } else {
          // Valid — set green color and store bbox
          rectRef.current.setStyle({ color: '#22c55e', fillOpacity: 0.15 })
          setBbox({
            south: b.getSouth(),
            west: b.getWest(),
            north: b.getNorth(),
            east: b.getEast(),
          })
        }
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
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
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

  const areaColor = areaKm2 === null ? 'text-gray-300'
    : areaKm2 > 1.0 ? 'text-red-400'
    : areaKm2 > 0.8 ? 'text-amber-400'
    : 'text-gray-300'

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
      {/* Map + overlays */}
      <div className="relative flex-1 min-h-0">
        <div ref={mapContainerRef} style={{ height: '500px', width: '100%', cursor: 'crosshair' }} />

        {/* Surface indicator */}
        {areaKm2 !== null && (
          <div
            className="absolute z-[1000] pointer-events-none"
            style={{ bottom: 8, left: '50%', transform: 'translateX(-50%)' }}
          >
            <div className={`bg-gray-900/80 backdrop-blur-sm rounded px-3 py-1 text-xs font-medium ${areaColor}`}>
              {areaKm2.toFixed(2)} {isDrawing ? '/ 1.0 km² max' : 'km²'}
            </div>
          </div>
        )}

        {/* Flash message */}
        {flashMsg && (
          <div
            className="absolute z-[1000] pointer-events-none"
            style={{ bottom: 40, left: '50%', transform: 'translateX(-50%)' }}
          >
            <div className="bg-red-900/90 text-red-200 rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap">
              {flashMsg}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// --- 3D Mode ------------------------------------------------------------------

interface SatelliteState {
  dataUrl: string
  opacity: number
}

function ThreeDMode({ buildings, bbox, lwSources, sources3D, setSources3D, selectedSourceId, setSelectedSourceId, onBack, satelliteImage, onSatelliteChange, noOsmBuildings }: {
  buildings: BuildingFootprint[]
  bbox: BBox
  lwSources: LwSourceSummary[]
  sources3D: Source3D[]
  setSources3D: React.Dispatch<React.SetStateAction<Source3D[]>>
  selectedSourceId: string | null
  setSelectedSourceId: React.Dispatch<React.SetStateAction<string | null>>
  onBack: () => void
  satelliteImage: SatelliteState | null
  onSatelliteChange: (sat: SatelliteState | null) => void
  noOsmBuildings: boolean
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const spheresRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const groundRef = useRef<THREE.Mesh | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const roofMeshesRef = useRef<THREE.Mesh[]>([])
  const satTextureRef = useRef<THREE.Texture | null>(null)
  const animFrameRef = useRef<number>(0)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [sizeWarning, setSizeWarning] = useState(false)

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
    const gndMat = new THREE.MeshLambertMaterial({ color: 0x4a5c3a })
    const ground = new THREE.Mesh(gndGeo, gndMat)
    ground.rotation.x = -Math.PI / 2
    ground.name = 'ground'
    scene.add(ground)
    groundRef.current = ground

    // Grid (visible only when no satellite image)
    const gridSize = Math.max(groundW, groundD) * 1.3
    const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / 10), 0x555555, 0x333333)
    grid.position.y = 0.05
    scene.add(grid)
    gridRef.current = grid

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
      // Dispose satellite texture if active
      if (satTextureRef.current) { satTextureRef.current.dispose(); satTextureRef.current = null }
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

  // --- Satellite texture on ground ---
  useEffect(() => {
    const ground = groundRef.current
    const grid = gridRef.current
    if (!ground) return

    if (satelliteImage) {
      // Dispose previous texture
      if (satTextureRef.current) { satTextureRef.current.dispose(); satTextureRef.current = null }

      const texture = new THREE.TextureLoader().load(satelliteImage.dataUrl)
      texture.wrapS = THREE.ClampToEdgeWrapping
      texture.wrapT = THREE.ClampToEdgeWrapping
      satTextureRef.current = texture

      const oldMat = ground.material as THREE.Material
      oldMat.dispose()
      ground.material = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        opacity: satelliteImage.opacity,
      })

      if (grid) grid.visible = false
    } else {
      // Restore default ground
      if (satTextureRef.current) { satTextureRef.current.dispose(); satTextureRef.current = null }
      const oldMat = ground.material as THREE.Material
      oldMat.dispose()
      ground.material = new THREE.MeshLambertMaterial({ color: 0x4a5c3a })
      if (grid) grid.visible = true
    }
  }, [satelliteImage?.dataUrl]) // only reload texture when image changes, not opacity

  // --- Satellite opacity live update ---
  useEffect(() => {
    const ground = groundRef.current
    if (!ground || !satelliteImage) return
    const mat = ground.material as THREE.MeshLambertMaterial
    if (mat.transparent) mat.opacity = satelliteImage.opacity
  }, [satelliteImage?.opacity, satelliteImage])

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

        {/* Satellite image section */}
        <div className="px-3 py-2 border-t border-gray-800 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
            <ImageIcon size={12} /> Image satellite
          </h3>

          {!satelliteImage ? (
            <>
              <label className="flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 border-dashed rounded px-2 py-2 cursor-pointer transition-colors">
                <ImageIcon size={12} />
                Importer une image satellite
                <input
                  type="file"
                  accept="image/*,image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    if (file.size > 5 * 1024 * 1024) setSizeWarning(true)
                    else setSizeWarning(false)
                    const reader = new FileReader()
                    reader.onload = () => {
                      onSatelliteChange({ dataUrl: reader.result as string, opacity: 0.8 })
                    }
                    reader.readAsDataURL(file)
                    e.target.value = ''
                  }}
                />
              </label>
              {sizeWarning && (
                <div className="flex items-start gap-1 text-[10px] text-amber-400">
                  <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                  <span>Image volumineuse (&gt;5 Mo) — le projet sera plus lourd.</span>
                </div>
              )}
              <p className="text-[10px] text-gray-600 leading-tight">
                Capturez la zone depuis Google Earth ou Maps et importez l'image. Elle sera automatiquement alignée sur la zone OSM sélectionnée.
              </p>
            </>
          ) : (
            <>
              {/* Preview + remove */}
              <div className="relative">
                <img
                  src={satelliteImage.dataUrl}
                  alt="Satellite"
                  className="w-full rounded border border-gray-700 object-cover"
                  style={{ maxHeight: 80 }}
                />
                <button
                  onClick={() => { onSatelliteChange(null); setSizeWarning(false) }}
                  className="absolute top-1 right-1 bg-gray-900/80 hover:bg-red-900/80 text-gray-400 hover:text-red-300 rounded-full p-0.5 transition-colors"
                  title="Supprimer l'image"
                >
                  <X size={12} />
                </button>
              </div>
              {sizeWarning && (
                <div className="flex items-start gap-1 text-[10px] text-amber-400">
                  <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                  <span>Image volumineuse (&gt;5 Mo) — le projet sera plus lourd.</span>
                </div>
              )}
              {/* Opacity slider */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-gray-500 shrink-0">Opacité</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={satelliteImage.opacity}
                  onChange={(e) => onSatelliteChange({ ...satelliteImage, opacity: parseFloat(e.target.value) })}
                  className="flex-1 h-1 accent-blue-500"
                />
                <span className="text-[10px] text-gray-400 w-7 text-right">{Math.round(satelliteImage.opacity * 100)}%</span>
              </div>
            </>
          )}
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

        {noOsmBuildings && (
          <div className="px-3 py-2 border-t border-gray-800">
            <p className="text-[10px] text-amber-500/70 leading-tight">
              Aucun bâtiment OSM dans cette zone — ajoutez une image satellite pour le contexte visuel.
            </p>
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
  const [failedBbox, setFailedBbox] = useState<BBox | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [noOsmMode, setNoOsmMode] = useState(false)
  const [satellite, setSatellite] = useState<SatelliteState | null>(() => {
    if (scene3D?.satelliteImage) return { dataUrl: scene3D.satelliteImage.dataUrl, opacity: scene3D.satelliteImage.opacity }
    return null
  })

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
  const persistScene = useCallback((bx: BBox | undefined, srcs: Source3D[], sat: SatelliteState | null) => {
    const bld = scene3D?.building ?? { width: 120, depth: 70, height: 15 }
    const satData = sat && bx ? { dataUrl: sat.dataUrl, opacity: sat.opacity, bbox: bx } : undefined
    onScene3DChange({ building: bld, sources: srcs, bbox: bx, satelliteImage: satData })
  }, [onScene3DChange, scene3D?.building])

  useEffect(() => { persistScene(bbox, sources3D, satellite) }, [bbox, sources3D, satellite, persistScene])

  // Fetch buildings from Overpass when bbox saved + mode is 3d but no buildings loaded
  useEffect(() => {
    if (mode !== '3d' || !bbox || buildings.length > 0) return
    fetchBuildings(bbox)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const fetchBuildings = async (b: BBox) => {
    setLoading(true)
    setLoadError(null)
    setFailedBbox(b)

    const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${b.west},${b.south},${b.east},${b.north}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)

    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const parsed = parseOsmXml(text, b)

      // Case B: success but 0 buildings — go to 3D with empty array
      setBuildings(parsed)
      setBbox(b)
      setNoOsmMode(parsed.length === 0)
      setMode('3d')
      setLoading(false)
      setFailedBbox(null)
    } catch (err) {
      clearTimeout(timer)
      const msg = err instanceof DOMException && err.name === 'AbortError'
        ? 'Timeout — l\'API OpenStreetMap n\'a pas répondu dans les 20 secondes.'
        : `Erreur réseau : ${(err as Error).message}`
      setLoadError(msg)
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
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4 p-10">
        <Box size={40} className="opacity-40" />
        <p className="text-sm text-center text-red-400 max-w-md leading-relaxed">{loadError}</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setLoadError(null); setFailedBbox(null); setMode('map') }}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-200 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded px-4 py-2 transition-colors"
          >
            <ArrowLeft size={14} />
            Retour à la carte
          </button>
          {failedBbox && (
            <button
              onClick={() => {
                setLoadError(null)
                setBuildings([])
                setBbox(failedBbox)
                setNoOsmMode(true)
                setMode('3d')
                setFailedBbox(null)
              }}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-4 py-2 transition-colors"
            >
              Continuer sans bâtiments
              <ArrowLeft size={14} className="rotate-180" />
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-600 text-center max-w-sm leading-relaxed">
          L'API OpenStreetMap est peut-être temporairement indisponible. Continuez sans bâtiments et ajoutez une image satellite.
        </p>
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
      satelliteImage={satellite}
      onSatelliteChange={setSatellite}
      noOsmBuildings={noOsmMode}
    />
  )
}
