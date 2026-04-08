/**
 * Inventaire complet (onglet `Table_ecme`) — paginé + recherche.
 */
import { useState, useMemo } from 'react'
import { Search, Download } from 'lucide-react'
import type { InventoryEntry } from '../../utils/ecmeParser'
import { inventoryToCSV } from '../../utils/ecmeParser'
import { formatFrShort } from '../../utils/dateUtils'

const PAGE_SIZE = 25

interface Props {
  inventory: InventoryEntry[]
  /** Map Réf. BV → nb de jours depuis la dernière utilisation (calculé par EcmePage) */
  lastUsedDays?: Record<string, number | null>
}

export default function InventoryTable({ inventory, lastUsedDays = {} }: Props) {
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
      {/* Recherche + export */}
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
        <button
          onClick={() => {
            const csv = inventoryToCSV(inventory, lastUsedDays)
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.download = 'acoustiq_ecme_inventaire.csv'
            link.href = url
            link.click()
            URL.revokeObjectURL(url)
          }}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                     border border-gray-600 transition-colors"
          title="Exporter l'inventaire en CSV"
        >
          <Download size={11} />
          CSV
        </button>
        <span className="text-[11px] text-gray-600">
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
              <th className="text-right px-3 py-1.5 font-medium" title="Jours écoulés depuis la dernière utilisation (statut I ou S)">
                Dern. usage
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-gray-600 italic">
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
                const days = lastUsedDays[e.refBv]
                let daysLabel: string
                let daysColor = 'text-gray-500'
                if (days === undefined || days === null) {
                  daysLabel = '—'
                } else if (days === 0) {
                  daysLabel = "aujourd'hui"
                  daysColor = 'text-emerald-400'
                } else if (days < 30) {
                  daysLabel = `il y a ${days} j`
                  daysColor = 'text-gray-300'
                } else if (days < 180) {
                  daysLabel = `il y a ${days} j`
                  daysColor = 'text-amber-400'
                } else {
                  daysLabel = `il y a ${days} j`
                  daysColor = 'text-rose-400'
                }
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
                    <td className={`px-3 py-1 text-right tabular-nums ${daysColor}`}>{daysLabel}</td>
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
