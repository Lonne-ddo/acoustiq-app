import { useState } from 'react'
import { Plus, X, MapPin, Loader2 } from 'lucide-react'
import { geocode } from '../../utils/geocoding'

export interface MeteoPoint {
  id: string
  label: string
  /** Texte saisi par l'utilisateur (adresse OU « lat, lng »). */
  query: string
  lat: number | null
  lng: number | null
  displayName: string | null
  geocoding: 'idle' | 'pending' | 'ok' | 'error'
  geocodingError?: string | null
}

interface Props {
  points: MeteoPoint[]
  onChange: (points: MeteoPoint[]) => void
  onImportFromProject?: () => void
  importDisabled?: boolean
  importHint?: string
}

let nextId = 1
export function makeMeteoPoint(label?: string): MeteoPoint {
  return {
    id: `mp-${Date.now()}-${nextId++}`,
    label: label || '',
    query: '',
    lat: null,
    lng: null,
    displayName: null,
    geocoding: 'idle',
  }
}

export default function PointsList({
  points,
  onChange,
  onImportFromProject,
  importDisabled,
  importHint,
}: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null)

  function update(id: string, patch: Partial<MeteoPoint>) {
    onChange(points.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function remove(id: string) {
    onChange(points.filter((p) => p.id !== id))
  }

  function add() {
    onChange([...points, makeMeteoPoint(`Point ${points.length + 1}`)])
  }

  async function resolveQuery(p: MeteoPoint) {
    const query = p.query.trim()
    if (!query) return
    update(p.id, { geocoding: 'pending', geocodingError: null })
    setPendingId(p.id)
    try {
      const r = await geocode(query)
      update(p.id, {
        lat: r.lat,
        lng: r.lng,
        displayName: r.displayName,
        geocoding: 'ok',
        geocodingError: null,
      })
    } catch (e) {
      update(p.id, {
        geocoding: 'error',
        geocodingError: (e as Error).message,
      })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {points.length === 0 && (
          <div className="text-xs text-gray-500 italic px-1 py-2">
            Aucun point. Ajoutez-en un ou importez depuis le projet actif.
          </div>
        )}
        {points.map((p) => (
          <div
            key={p.id}
            className="grid grid-cols-[120px_1fr_auto] gap-2 items-start"
          >
            <input
              value={p.label}
              onChange={(e) => update(p.id, { label: e.target.value })}
              placeholder="Label"
              className="text-xs bg-gray-800 text-gray-200 border border-gray-700
                         rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <div className="space-y-1">
              <div className="flex gap-1">
                <input
                  value={p.query}
                  onChange={(e) =>
                    update(p.id, {
                      query: e.target.value,
                      geocoding: 'idle',
                      geocodingError: null,
                    })
                  }
                  onBlur={() => {
                    if (p.query.trim() && p.geocoding !== 'ok') {
                      void resolveQuery(p)
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void resolveQuery(p)
                    }
                  }}
                  placeholder="Adresse, ville ou « lat, lng »"
                  className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-700
                             rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  onClick={() => void resolveQuery(p)}
                  disabled={pendingId === p.id || !p.query.trim()}
                  className="px-2 rounded bg-gray-800 text-gray-300 border border-gray-700
                             hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed
                             text-xs flex items-center gap-1"
                  title="Géocoder"
                >
                  {pendingId === p.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <MapPin size={12} />
                  )}
                </button>
              </div>
              {p.geocoding === 'ok' && p.lat != null && p.lng != null && (
                <div className="text-[10px] text-emerald-400 truncate">
                  ✓ {p.displayName} ({p.lat.toFixed(4)}, {p.lng.toFixed(4)})
                </div>
              )}
              {p.geocoding === 'error' && (
                <div className="text-[10px] text-rose-400 truncate">
                  ✗ {p.geocodingError || 'erreur de géocodage'}
                </div>
              )}
            </div>
            <button
              onClick={() => remove(p.id)}
              className="px-2 py-1 rounded bg-gray-800 text-gray-500 border border-gray-700
                         hover:bg-rose-900/30 hover:text-rose-400 hover:border-rose-700
                         text-xs"
              title="Retirer"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={add}
          className="px-3 py-1.5 rounded border border-dashed border-gray-700
                     text-gray-400 hover:text-gray-200 hover:border-gray-500
                     text-xs flex items-center gap-1.5"
        >
          <Plus size={12} /> Ajouter un point
        </button>
        {onImportFromProject && (
          <button
            onClick={onImportFromProject}
            disabled={importDisabled}
            title={importHint}
            className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 border border-gray-700
                       hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed
                       text-xs"
          >
            Importer les points du projet
          </button>
        )}
      </div>
    </div>
  )
}
