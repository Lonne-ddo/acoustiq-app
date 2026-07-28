import { Loader2, AlertCircle } from 'lucide-react'

export interface DataverseProjectRow {
  id: string
  name: string
  numero: string
}

interface Props {
  /** Lignes chargées ; `null` = chargement de la liste en cours. */
  rows: DataverseProjectRow[] | null
  /** Message d'erreur du chargement de la liste, ou `null`. */
  error: string | null
  /** id du projet en cours d'ouverture (spinner sur la ligne), ou `null`. */
  loadingId: string | null
  /** Clic sur une ligne : déclenche l'ouverture côté parent. */
  onPick: (id: string) => void
  /** Rendu compact pour le popover du header (défaut : style modal aéré). */
  dense?: boolean
}

/**
 * Affichage partagé de la liste des projets Dataverse : gère les 4 états
 * (chargement / erreur / vide / liste). Utilisé par le modal « Ouvrir depuis
 * Dataverse » (DataverseOpenModal) et par la section « Projets Dataverse » du
 * popover du header (MainPanel).
 *
 * Purement présentationnel : ne fait AUCUN fetch. Le parent fournit
 * `rows`/`error` (il choisit quand charger) et réagit à `onPick`.
 */
export default function DataverseProjectList({ rows, error, loadingId, onPick, dense = false }: Props) {
  const busy = loadingId !== null

  if (error !== null) {
    return (
      <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded px-2 py-1.5 m-1">
        <AlertCircle size={12} className="mt-0.5 shrink-0" />
        <span className="flex-1">{error}</span>
      </div>
    )
  }

  if (rows === null) {
    return (
      <div className="flex items-center justify-center gap-2 text-xs text-gray-400 py-8">
        <Loader2 size={14} className="animate-spin" /> Chargement de la liste…
      </div>
    )
  }

  if (rows.length === 0) {
    return <div className="text-xs text-gray-500 text-center py-6">Aucun projet sauvegardé.</div>
  }

  return (
    <ul className="space-y-0.5">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            onClick={() => onPick(r.id)}
            disabled={busy}
            className={`w-full flex items-center gap-2 rounded text-left
                        hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent transition-colors
                        ${dense ? 'px-2.5 py-1.5' : 'px-2.5 py-2'}`}
          >
            <div className="flex-1 min-w-0">
              <div className={`${dense ? 'text-xs' : 'text-sm'} text-gray-200 truncate`}>{r.name || 'Sans titre'}</div>
              {r.numero && <div className="text-xs text-gray-500 tabular-nums truncate">{r.numero}</div>}
            </div>
            {loadingId === r.id && <Loader2 size={14} className="animate-spin text-emerald-400 shrink-0" />}
          </button>
        </li>
      ))}
    </ul>
  )
}
