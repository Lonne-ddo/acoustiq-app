import { useEffect, useState } from 'react'
import { Database, X } from 'lucide-react'
import DataverseProjectList, { type DataverseProjectRow } from './DataverseProjectList'

// Ré-exporté pour compatibilité des imports existants (le type vit désormais
// dans DataverseProjectList, partagé avec la section Dataverse du header).
export type { DataverseProjectRow }

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
 * Modal « Ouvrir depuis Dataverse ». Récupère la liste au montage, délègue
 * l'affichage (chargement / erreur / vide / liste) à DataverseProjectList.
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

        {/* Corps — liste partagée */}
        <div className="flex-1 overflow-y-auto p-2">
          <DataverseProjectList rows={rows} error={error} loadingId={loadingId} onPick={onPick} />
        </div>
      </div>
    </div>
  )
}
