/**
 * Vue 3D — visualisation des sources acoustiques sur un modele simplifie d'usine
 * Utilise Three.js pour le rendu 3D et Tailwind pour le panneau lateral
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Box, RotateCcw, Eye } from 'lucide-react'
import type { LwSourceSummary, Scene3DData } from '../types'

// --- Constantes ---------------------------------------------------------------

const DEFAULT_BUILDING = { width: 120, depth: 70, height: 15 }

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

// --- Types internes -----------------------------------------------------------

interface Source3D {
  id: string
  x: number
  y: number
  z: number
  placed: boolean
}

interface Props {
  lwSources: LwSourceSummary[]
  scene3D: Scene3DData | undefined
  onScene3DChange: (data: Scene3DData) => void
}

// --- Composant ----------------------------------------------------------------

export default function Vue3DTab({ lwSources, scene3D, onScene3DChange }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const spheresRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const buildingRef = useRef<THREE.Mesh | null>(null)
  const groundRef = useRef<THREE.Mesh | null>(null)
  const animFrameRef = useRef<number>(0)

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [building, setBuilding] = useState(scene3D?.building ?? { ...DEFAULT_BUILDING })
  const [sources3D, setSources3D] = useState<Source3D[]>(() => {
    if (scene3D?.sources) return scene3D.sources
    return lwSources.map((s) => ({ id: s.id, x: 0, y: 0, z: 0, placed: false }))
  })

  // Sync sources3D when lwSources changes (new sources added / removed)
  useEffect(() => {
    setSources3D((prev) => {
      const existing = new Map(prev.map((s) => [s.id, s]))
      const next: Source3D[] = lwSources.map((ls) => {
        const ex = existing.get(ls.id)
        if (ex) return ex
        return { id: ls.id, x: 0, y: 0, z: 0, placed: false }
      })
      return next
    })
  }, [lwSources])

  // Persist to parent whenever scene state changes
  const persistScene = useCallback((bld: typeof building, srcs: Source3D[]) => {
    onScene3DChange({ building: bld, sources: srcs })
  }, [onScene3DChange])

  useEffect(() => { persistScene(building, sources3D) }, [building, sources3D, persistScene])

  // --- Three.js setup ---
  useEffect(() => {
    const container = canvasRef.current
    if (!container) return

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)
    sceneRef.current = scene

    // Camera
    const w = container.clientWidth
    const h = container.clientHeight
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000)
    camera.position.set(180, 140, 180)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI / 2 - 0.05
    controlsRef.current = controls

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(100, 200, 100)
    scene.add(dirLight)

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(400, 400)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a6741, roughness: 0.9 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.name = 'ground'
    scene.add(ground)
    groundRef.current = ground

    // Grid helper
    const grid = new THREE.GridHelper(400, 40, 0x555555, 0x333333)
    grid.position.y = 0.05
    scene.add(grid)

    // Rivers (decorative)
    const riverMat = new THREE.MeshStandardMaterial({ color: 0x2e86ab, roughness: 0.3, transparent: true, opacity: 0.7 })
    const river1Geo = new THREE.PlaneGeometry(15, 300)
    const river1 = new THREE.Mesh(river1Geo, riverMat)
    river1.rotation.x = -Math.PI / 2
    river1.position.set(180, 0.1, 0)
    scene.add(river1)

    const river2Geo = new THREE.PlaneGeometry(300, 12)
    const river2 = new THREE.Mesh(river2Geo, riverMat)
    river2.rotation.x = -Math.PI / 2
    river2.position.set(0, 0.1, 170)
    scene.add(river2)

    // Animation loop
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize handler
    const onResize = () => {
      const cw = container.clientWidth
      const ch = container.clientHeight
      camera.aspect = cw / ch
      camera.updateProjectionMatrix()
      renderer.setSize(cw, ch)
    }
    const resObs = new ResizeObserver(onResize)
    resObs.observe(container)

    return () => {
      resObs.disconnect()
      cancelAnimationFrame(animFrameRef.current)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
      // Dispose geometries & materials
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
          else obj.material.dispose()
        }
      })
    }
  }, [])  // mount-only

  // --- Update building mesh when dimensions change ---
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    // Remove old building
    if (buildingRef.current) {
      buildingRef.current.geometry.dispose()
      ;(buildingRef.current.material as THREE.Material).dispose()
      scene.remove(buildingRef.current)
    }
    const geo = new THREE.BoxGeometry(building.width, building.height, building.depth)
    const mat = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.6, metalness: 0.2 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = building.height / 2
    mesh.name = 'building'
    scene.add(mesh)
    buildingRef.current = mesh

    // Roof wireframe for visibility
    const edges = new THREE.EdgesGeometry(geo)
    const lineMat = new THREE.LineBasicMaterial({ color: 0xaaaacc })
    const wireframe = new THREE.LineSegments(edges, lineMat)
    wireframe.position.copy(mesh.position)
    wireframe.name = 'building-wireframe'
    // Remove old wireframe
    const oldWf = scene.getObjectByName('building-wireframe')
    if (oldWf) {
      if (oldWf instanceof THREE.LineSegments) {
        oldWf.geometry.dispose()
        ;(oldWf.material as THREE.Material).dispose()
      }
      scene.remove(oldWf)
    }
    scene.add(wireframe)
  }, [building])

  // --- Update source spheres ---
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Remove old spheres
    for (const [, mesh] of spheresRef.current) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      scene.remove(mesh)
    }
    spheresRef.current.clear()

    // Add placed sources
    for (const s3d of sources3D) {
      if (!s3d.placed) continue
      const lwSrc = lwSources.find((ls) => ls.id === s3d.id)
      if (!lwSrc) continue
      const geo = new THREE.SphereGeometry(3, 24, 24)
      const mat = new THREE.MeshStandardMaterial({
        color: lwColorHex(lwSrc.lw),
        roughness: 0.4,
        emissive: lwColorHex(lwSrc.lw),
        emissiveIntensity: 0.15,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(s3d.x, s3d.y, s3d.z)
      mesh.name = `source-${s3d.id}`
      mesh.userData = { sourceId: s3d.id }
      scene.add(mesh)
      spheresRef.current.set(s3d.id, mesh)
    }
  }, [sources3D, lwSources])

  // --- Raycasting: click to place / select ---
  useEffect(() => {
    const container = canvasRef.current
    const renderer = rendererRef.current
    if (!container || !renderer) return

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
        const hit = sphereHits[0].object as THREE.Mesh
        const srcId = hit.userData.sourceId as string
        setSelectedSourceId(srcId)
        return
      }

      // Check building roof + ground
      const targets: THREE.Object3D[] = []
      if (buildingRef.current) targets.push(buildingRef.current)
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
      const scene = sceneRef.current
      if (!camera || !scene) return

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
          setTooltip({
            x: e.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0),
            y: e.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0),
            text: `${lwSrc.name} — ${lwSrc.lw.toFixed(1)} dBA`,
          })
        }
      } else {
        setTooltip(null)
      }
    }

    renderer.domElement.addEventListener('click', onClick)
    renderer.domElement.addEventListener('mousemove', onMouseMove)
    return () => {
      renderer.domElement.removeEventListener('click', onClick)
      renderer.domElement.removeEventListener('mousemove', onMouseMove)
    }
  }, [lwSources])

  // --- Highlight selected source ---
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

  const handleResetPositions = () => {
    setSources3D((prev) => prev.map((s) => ({ ...s, x: 0, y: 0, z: 0, placed: false })))
    setSelectedSourceId(null)
  }

  const handleBuildingChange = (key: 'width' | 'depth' | 'height', val: string) => {
    const num = parseFloat(val)
    if (isNaN(num) || num <= 0) return
    setBuilding((prev) => {
      const next = { ...prev, [key]: num }
      return next
    })
  }

  // No sources state
  if (lwSources.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3 p-10">
        <Box size={48} className="opacity-40" />
        <p className="text-sm text-center max-w-md">
          Aucune source disponible — calculez les Lw dans l'onglet <strong>Puissance Lw</strong> d'abord.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Canvas 3D */}
      <div className="flex-1 relative" ref={canvasRef} style={{ minHeight: 500 }}>
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
            Cliquez sur le bâtiment ou le sol pour placer la source sélectionnée
          </div>
        )}
      </div>

      {/* Panneau latéral */}
      <div className="w-60 shrink-0 border-l border-gray-800 bg-gray-950 flex flex-col overflow-hidden">
        {/* Dimensions bâtiment */}
        <div className="px-3 py-3 border-b border-gray-800 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
            <Box size={13} /> Bâtiment
          </h3>
          <div className="grid grid-cols-3 gap-1.5">
            {(['width', 'depth', 'height'] as const).map((k) => (
              <div key={k}>
                <label className="text-[10px] text-gray-500 block mb-0.5">
                  {k === 'width' ? 'Larg.' : k === 'depth' ? 'Prof.' : 'Haut.'} (m)
                </label>
                <input
                  type="number"
                  min={1}
                  value={building[k]}
                  onChange={(e) => handleBuildingChange(k, e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200 focus:border-blue-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Liste des sources */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Sources ({lwSources.length})
          </h3>
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

        {/* Bouton reset */}
        <div className="px-3 py-2 border-t border-gray-800">
          <button
            onClick={handleResetPositions}
            className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1.5 transition-colors"
          >
            <RotateCcw size={12} />
            Réinitialiser positions
          </button>
        </div>
      </div>
    </div>
  )
}
