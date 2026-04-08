/**
 * Historique multi-campagnes
 *
 * Permet de stocker jusqu'à 10 projets sauvegardés (.json) dans le localStorage
 * et d'en comparer 2 côte à côte (table d'indices + évolution Δ + export Excel).
 *
 * Source des données : ProjectData.indicesSnapshot — déjà présent dans les
 * exports projet, donc pas besoin de recharger les fichiers bruts.
 */
import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { History, Plus, Trash2, GitCompare, X, Download } from 'lucide-react'
import type { ProjectData, IndicesSnapshot } from '../types'

// ─── Stockage localStorage ──────────────────────────────────────────────────
const STORAGE_KEY = 'acoustiq_history'
const MAX_CAMPAIGNS = 10

interface Campaign {
  /** Identifiant local pour la liste */
  id: string
  /** Nom du projet (ProjectData.projectName ou nom de fichier) */
  name: string
  /** Date de la mesure (date la plus fréquente parmi les fichiers) */
  date: string
  /** Date de sauvegarde du projet */
  savedAt: string
  /** Nombre de points assignés */
  pointCount: number
  /** Snapshot des indices par "BV-XX|YYYY-MM-DD" ou "BV-XX" */
  indicesSnapshot: Record<string, IndicesSnapshot>
}

function loadCampaigns(): Campaign[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveCampaigns(list: Campaign[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

// ─── Helpers : moyennage / agrégation par point ─────────────────────────────
const KEYS = ['laeq', 'l10', 'l50', 'l90', 'lafmax', 'lafmin'] as const
type IKey = (typeof KEYS)[number]
const LABELS: Record<IKey, string> = {
  laeq: 'LAeq', l10: 'L10', l50: 'L50', l90: 'L90', lafmax: 'LAFmax', lafmin: 'LAFmin',
}

/** Énergie → moyenne dB d'un tableau de niveaux */
function eAvg(values: number[]): number {
  if (values.length === 0) return 0
  return 10 * Math.log10(values.reduce((a, v) => a + Math.pow(10, v / 10), 0) / values.length)
}

/** Pour une campagne, renvoie un seul indicesSnapshot agrégé énergétiquement
 *  par nom de point (en cas de plusieurs jours par point). */
function aggregateSnapshot(snap: Record<string, IndicesSnapshot>): Record<string, IndicesSnapshot> {
  const buckets = new Map<string, IndicesSnapshot[]>()
  for (const [key, idx] of Object.entries(snap)) {
    const pt = key.includes('|') ? key.split('|')[0] : key
    if (!buckets.has(pt)) buckets.set(pt, [])
    buckets.get(pt)!.push(idx)
  }
  const out: Record<string, IndicesSnapshot> = {}
  for (const [pt, list] of buckets) {
    out[pt] = {
      laeq: eAvg(list.map((s) => s.laeq)),
      l10: eAvg(list.map((s) => s.l10)),
      l50: eAvg(list.map((s) => s.l50)),
      l90: eAvg(list.map((s) => s.l90)),
      lafmax: Math.max(...list.map((s) => s.lafmax)),
      lafmin: Math.min(...list.map((s) => s.lafmin)),
    }
  }
  return out
}

// ─── Composant principal ────────────────────────────────────────────────────
export default function HistoryTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>(loadCampaigns)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 2) next.add(id)
      return next
    })
  }

  async function handleAdd(file: File) {
    try {
      const text = await file.text()
      const project = JSON.parse(text) as ProjectData
      if (!project.indicesSnapshot) {
        alert('Ce projet ne contient pas de snapshot d\'indices (sauvegardez-le à nouveau depuis AcoustiQ pour l\'ajouter à l\'historique).')
        return
      }
      // Date dominante : la date la plus fréquente parmi les fichiers
      const dateCounts = new Map<string, number>()
      for (const f of project.files ?? []) {
        dateCounts.set(f.date, (dateCounts.get(f.date) ?? 0) + 1)
      }
      const date = [...dateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
      const pointCount = new Set(Object.values(project.pointAssignments ?? {})).size

      const camp: Campaign = {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: project.projectName || file.name.replace(/\.json$/i, ''),
        date,
        savedAt: project.savedAt ?? new Date().toISOString(),
        pointCount,
        indicesSnapshot: project.indicesSnapshot,
      }
      setCampaigns((prev) => {
        const next = [camp, ...prev].slice(0, MAX_CAMPAIGNS)
        saveCampaigns(next)
        return next
      })
    } catch (err) {
      alert(`Lecture du projet échouée : ${String(err)}`)
    }
  }

  function handleRemove(id: string) {
    setCampaigns((prev) => {
      const next = prev.filter((c) => c.id !== id)
      saveCampaigns(next)
      return next
    })
    setSelected((prev) => {
      const n = new Set(prev)
      n.delete(id)
      return n
    })
  }

  // LAeq « moyen » (énergétique) sur tous les points de la campagne, pour l'aperçu
  function laeqMean(c: Campaign): number | null {
    const agg = aggregateSnapshot(c.indicesSnapshot)
    const vals = Object.values(agg).map((s) => s.laeq)
    if (vals.length === 0) return null
    return eAvg(vals)
  }

  const compareList = useMemo(
    () => campaigns.filter((c) => selected.has(c.id)),
    [campaigns, selected],
  )

  return (
    <div className="flex flex-col h-full">
      {/* Barre */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 shrink-0">
        <History size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Historique des campagnes
        </span>
        <span className="text-[10px] text-gray-600">{campaigns.length} / {MAX_CAMPAIGNS}</span>

        <label
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                     border border-gray-600 cursor-pointer transition-colors"
          title="Charger un projet AcoustiQ (.json)"
        >
          <Plus size={12} />
          Ajouter campagne
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleAdd(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-600 gap-3">
            <History size={48} className="opacity-20" />
            <p className="text-sm">Aucune campagne chargée.</p>
            <p className="text-xs text-gray-700">
              Cliquez « Ajouter campagne » pour importer un fichier projet AcoustiQ (.json).
            </p>
          </div>
        ) : (
          <div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 text-gray-500">
                  <th className="px-2 py-2 w-8"></th>
                  <th className="text-left px-2 py-2 font-medium">Site</th>
                  <th className="text-left px-2 py-2 font-medium">Date</th>
                  <th className="text-center px-2 py-2 font-medium">Points</th>
                  <th className="text-right px-2 py-2 font-medium">LAeq moyen</th>
                  <th className="text-center px-2 py-2 font-medium">Conformité</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const mean = laeqMean(c)
                  const isSelected = selected.has(c.id)
                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-gray-800/50 ${
                        isSelected ? 'bg-emerald-950/20' : ''
                      }`}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(c.id)}
                          className="accent-emerald-500"
                        />
                      </td>
                      <td className="px-2 py-2 text-gray-200 font-medium">{c.name}</td>
                      <td className="px-2 py-2 text-gray-400">{c.date}</td>
                      <td className="px-2 py-2 text-center text-gray-400">{c.pointCount}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-200">
                        {mean !== null ? `${mean.toFixed(1)} dB(A)` : '—'}
                      </td>
                      <td className="px-2 py-2 text-center text-gray-600 text-[10px]">
                        — non évalué
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => handleRemove(c.id)}
                          className="text-gray-600 hover:text-rose-400"
                          title="Retirer de l'historique"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {selected.size === 2 && (
              <ComparisonView campaigns={compareList} onClose={() => setSelected(new Set())} />
            )}
            {selected.size === 1 && (
              <p className="mt-3 text-[11px] text-gray-600 italic">
                Sélectionnez une seconde campagne pour la comparaison.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Vue comparaison côte-à-côte ────────────────────────────────────────────
function ComparisonView({ campaigns, onClose }: { campaigns: Campaign[]; onClose: () => void }) {
  const [c1, c2] = campaigns
  // Agréger chaque campagne par nom de point
  const agg1 = useMemo(() => aggregateSnapshot(c1.indicesSnapshot), [c1])
  const agg2 = useMemo(() => aggregateSnapshot(c2.indicesSnapshot), [c2])
  const sharedPoints = useMemo(() => {
    const set = new Set<string>([...Object.keys(agg1), ...Object.keys(agg2)])
    return [...set].sort()
  }, [agg1, agg2])

  function handleExport() {
    const wb = XLSX.utils.book_new()
    for (const pt of sharedPoints) {
      const v1 = agg1[pt]
      const v2 = agg2[pt]
      const rows = KEYS.map((k) => ({
        Indice: LABELS[k],
        [`${c1.name}`]: v1 ? v1[k].toFixed(1) : '',
        [`${c2.name}`]: v2 ? v2[k].toFixed(1) : '',
        Δ: v1 && v2 ? (v2[k] - v1[k]).toFixed(1) : '',
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), pt.slice(0, 31))
    }
    XLSX.writeFile(wb, `acoustiq_comparaison_${c1.name}_vs_${c2.name}.xlsx`.replace(/[\\/:*?"<>|]/g, '_'))
  }

  return (
    <div className="mt-5 border-t border-gray-800 pt-4">
      <div className="flex items-center gap-2 mb-3">
        <GitCompare size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Comparaison
        </span>
        <span className="text-[10px] text-gray-600">
          {c1.name} ({c1.date}) ↔ {c2.name} ({c2.date})
        </span>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                     border border-gray-600"
        >
          <Download size={11} />
          Exporter Excel
        </button>
        <button
          onClick={onClose}
          className="p-1 text-gray-600 hover:text-gray-300 rounded hover:bg-gray-800"
          title="Fermer la comparaison"
        >
          <X size={12} />
        </button>
      </div>

      {sharedPoints.map((pt) => {
        const v1 = agg1[pt]
        const v2 = agg2[pt]
        return (
          <div key={pt} className="mb-3 border border-gray-800 rounded overflow-hidden">
            <div className="px-3 py-1.5 bg-gray-900/60 text-xs font-semibold text-gray-300">
              {pt}
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800/60">
                  <th className="text-left px-3 py-1 font-medium">Indice</th>
                  <th className="text-right px-3 py-1 font-medium">{c1.name}</th>
                  <th className="text-right px-3 py-1 font-medium">{c2.name}</th>
                  <th className="text-right px-3 py-1 font-medium">Évolution</th>
                </tr>
              </thead>
              <tbody>
                {KEYS.map((k) => {
                  const a = v1?.[k]
                  const b = v2?.[k]
                  const d = a !== undefined && b !== undefined ? b - a : null
                  // Convention : pour LAeq/L*, baisser = mieux (vert si Δ ≤ -0.5)
                  const colorClass =
                    d === null ? 'text-gray-600' :
                    d <= -0.5 ? 'text-emerald-400' :
                    d >= 0.5 ? 'text-rose-400' : 'text-gray-400'
                  const arrow = d === null ? '' : d <= -0.5 ? '↓' : d >= 0.5 ? '↑' : '→'
                  return (
                    <tr key={k} className="border-b border-gray-800/30">
                      <td className="px-3 py-1 text-gray-400">{LABELS[k]}</td>
                      <td className="px-3 py-1 text-right tabular-nums text-gray-200">
                        {a !== undefined ? `${a.toFixed(1)} dB` : '—'}
                      </td>
                      <td className="px-3 py-1 text-right tabular-nums text-gray-200">
                        {b !== undefined ? `${b.toFixed(1)} dB` : '—'}
                      </td>
                      <td className={`px-3 py-1 text-right tabular-nums font-semibold ${colorClass}`}>
                        {d !== null ? `${arrow} ${d > 0 ? '+' : ''}${d.toFixed(1)} dB` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
