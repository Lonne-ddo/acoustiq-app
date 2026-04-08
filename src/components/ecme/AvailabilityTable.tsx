/**
 * Tableau de disponibilité du jour — un statut par équipement.
 * Filtre par type (Sono / Calibrateur / Dosimètre / Modem / Géophone)
 * et par disponibilité.
 */
import { useState, useMemo } from 'react'
import type { AvailabilityRow, EquipmentType } from '../../utils/ecmeParser'

const TYPE_FILTERS: Array<EquipmentType | 'Tous'> = [
  'Tous', 'Sono', 'Calibrateur', 'Dosimètre', 'Modem', 'Géophone',
]

const STATUS_TINT: Record<string, string> = {
  Disponible: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60',
  Installé: 'bg-blue-900/40 text-blue-300 border-blue-800/60',
  'Suivi chantier': 'bg-orange-900/40 text-orange-300 border-orange-800/60',
  Autre: 'bg-gray-800 text-gray-400 border-gray-700',
}

interface Props {
  rows: AvailabilityRow[]
}

export default function AvailabilityTable({ rows }: Props) {
  const [typeFilter, setTypeFilter] = useState<EquipmentType | 'Tous'>('Tous')
  const [availableOnly, setAvailableOnly] = useState(false)

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== 'Tous' && r.type !== typeFilter) return false
      if (availableOnly && r.status !== 'Disponible') return false
      return true
    })
  }, [rows, typeFilter, availableOnly])

  const dispoCount = filtered.filter((r) => r.status === 'Disponible').length

  return (
    <div className="space-y-3">
      {/* Filtres */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                typeFilter === t
                  ? 'bg-emerald-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 ml-2">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
            className="accent-emerald-500"
          />
          Disponibles seulement
        </label>
        <span className="text-[11px] text-gray-600 ml-auto">
          {filtered.length} équipement(s) · {dispoCount} disponible(s)
        </span>
      </div>

      {/* Tableau */}
      <div className="border border-gray-800 rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60 text-gray-500">
            <tr className="border-b border-gray-800">
              <th className="text-left  px-3 py-1.5 font-medium">Réf. BV</th>
              <th className="text-left  px-3 py-1.5 font-medium">Modèle</th>
              <th className="text-left  px-3 py-1.5 font-medium">Type</th>
              <th className="text-center px-3 py-1.5 font-medium">Statut</th>
              <th className="text-left  px-3 py-1.5 font-medium">Localisation</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-gray-600 italic">
                  Aucun équipement ne correspond aux filtres.
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr
                  key={r.refBv}
                  className={`border-b border-gray-800/40 ${i % 2 === 0 ? 'bg-gray-900/30' : ''}`}
                >
                  <td className="px-3 py-1 font-semibold text-gray-200">{r.refBv}</td>
                  <td className="px-3 py-1 text-gray-300">{r.modele}</td>
                  <td className="px-3 py-1 text-gray-500">{r.type}</td>
                  <td className="px-3 py-1 text-center">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        STATUS_TINT[r.status] ?? STATUS_TINT.Autre
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-1 text-gray-400">{r.localisation || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
