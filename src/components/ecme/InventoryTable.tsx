/**
 * Inventaire complet (onglet `Table_ecme`) — paginé + recherche.
 */
import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import type { InventoryEntry } from '../../utils/ecmeParser'
import { formatFrShort } from '../../utils/dateUtils'

const PAGE_SIZE = 25

interface Props {
  inventory: InventoryEntry[]
}

export default function InventoryTable({ inventory }: Props) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return inventory
    return inventory.filter(
      (e) =>
        e.refBv.toLowerCase().includes(q) ||
        e.modele.toLowerCase().includes(q) ||
        e.numeroSerie.toLowerCase().includes(q),
    )
  }, [inventory, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  return (
    <div className="space-y-3">
      {/* Recherche */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 max-w-md">
          <Search size={13} className="text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0) }}
            placeholder="Rechercher (Réf. BV, modèle, n° série)…"
            className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-700
                       rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <span className="text-[11px] text-gray-600 ml-auto">
          {filtered.length} équipement(s)
        </span>
      </div>

      {/* Tableau */}
      <div className="border border-gray-800 rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60 text-gray-500">
            <tr className="border-b border-gray-800">
              <th className="text-left  px-3 py-1.5 font-medium">Réf. BV</th>
              <th className="text-left  px-3 py-1.5 font-medium">Marque</th>
              <th className="text-left  px-3 py-1.5 font-medium">Modèle</th>
              <th className="text-left  px-3 py-1.5 font-medium">N° série</th>
              <th className="text-left  px-3 py-1.5 font-medium">Type</th>
              <th className="text-left  px-3 py-1.5 font-medium">Calibration</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-gray-600 italic">
                  Aucun équipement ne correspond à la recherche.
                </td>
              </tr>
            ) : (
              visible.map((e, i) => {
                const calibLabel = e.calibrationFlag
                  ? e.calibrationFlag
                  : e.prochaineCalibration
                  ? formatFrShort(e.prochaineCalibration)
                  : '—'
                const calibColor = e.calibrationFlag
                  ? 'text-rose-400'
                  : 'text-gray-400'
                return (
                  <tr
                    key={e.refBv + i}
                    className={`border-b border-gray-800/40 ${i % 2 === 0 ? 'bg-gray-900/30' : ''}`}
                  >
                    <td className="px-3 py-1 font-semibold text-gray-200">{e.refBv}</td>
                    <td className="px-3 py-1 text-gray-300">{e.marque || '—'}</td>
                    <td className="px-3 py-1 text-gray-300">{e.modele || '—'}</td>
                    <td className="px-3 py-1 text-gray-400 tabular-nums">{e.numeroSerie || '—'}</td>
                    <td className="px-3 py-1 text-gray-500">{e.type || '—'}</td>
                    <td className={`px-3 py-1 tabular-nums ${calibColor}`}>{calibLabel}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700
                       disabled:opacity-30 transition-colors"
          >
            ← Précédent
          </button>
          <span className="text-gray-500 tabular-nums">
            Page {safePage + 1} / {pageCount}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700
                       disabled:opacity-30 transition-colors"
          >
            Suivant →
          </button>
        </div>
      )}
    </div>
  )
}
