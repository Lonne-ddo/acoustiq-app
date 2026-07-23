import { useEffect, useState } from 'react'
import { Database, Loader2, X, AlertCircle } from 'lucide-react'

export interface DataverseProjectRow {
  id: string
  name: string
  numero: string
}

interface Props {
  onClose: () => void
  /** Appelé au clic sur une ligne : déclenche le download + restauration côté App. */
  onPick: (id: string) => void
  /** id en cours de téléchargement (spinner + verrouillage), ou null. */
  loadingId: string | null
  /** Charge la liste des projets Dataverse (listProjects via le client injecté). */
  fetchProjects: () => Promise<DataverseProjectRow[]>
}

/**
 * Modal « Ouvrir depuis Dataverse ». Récupère la liste au montage, affiche
 * nom + N° projet, clic = load. Style neutre cohérent avec l'UI AcoustiQ.
 */
export default function DataverseOpenModal({ onClose, onPick, loadingId, fetchProjects }: Props) {
  const [rows, setRows] = useState<DataverseProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchProjects()
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [fetchProjects])

  const busy = loadingId !== null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-[420px] max-h-[70vh] flex flex-col bg-gray-900 border border-gray-700 rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700 shrink-0">
          <Database size={16} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-200">Ouvrir depuis Dataverse</span>
          <button
            onClick={onClose}
            disabled={busy}
            className="ml-auto p-1 text-gray-500 hover:text-gray-200 disabled:opacity-30 transition-colors"
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto p-2">
          {error !== null ? (
            <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-2 py-1.5 m-1">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          ) : rows === null ? (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400 py-8">
              <Loader2 size={14} className="animate-spin" /> Chargement de la liste…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-8">Aucun projet enregistré.</div>
          ) : (
            <ul className="space-y-0.5">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onPick(r.id)}
                    disabled={busy}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded text-left
                               hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-200 truncate">{r.name || 'Sans titre'}</div>
                      {r.numero && <div className="text-xs text-gray-500 tabular-nums truncate">{r.numero}</div>}
                    </div>
                    {loadingId === r.id && <Loader2 size={14} className="animate-spin text-emerald-400 shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
