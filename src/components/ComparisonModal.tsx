/**
 * Modal de comparaison entre le projet courant et un second projet (.json).
 * Charge uniquement les indices snapshotés du second projet (pas les données
 * brutes). Affiche une table par point de mesure commun et permet l'export
 * Excel. Ne modifie pas l'état du projet courant.
 */
import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { X, Upload, Download, GitCompare } from 'lucide-react'
import type { IndicesSnapshot, ProjectData } from '../types'

interface Props {
  /** Snapshot d'indices du projet courant, calculé par App au montage */
  currentIndices: Record<string, IndicesSnapshot>
  currentProjectName: string
  onClose: () => void
}

const ROWS = [
  { key: 'laeq', label: 'LAeq' },
  { key: 'l10', label: 'L10' },
  { key: 'l50', label: 'L50' },
  { key: 'l90', label: 'L90' },
  { key: 'lafmax', label: 'LAFmax' },
  { key: 'lafmin', label: 'LAFmin' },
] as const

type RowKey = (typeof ROWS)[number]['key']

/** Extrait le nom de point de la clé "BV-94|2026-03-09" → "BV-94" */
function pointOf(key: string): string {
  const i = key.indexOf('|')
  return i >= 0 ? key.slice(0, i) : key
}

/** Agrège un snapshot par point de mesure (moyenne énergétique sur les dates) */
function aggregateByPoint(
  snap: Record<string, IndicesSnapshot>,
): Record<string, IndicesSnapshot> {
  const groups = new Map<string, IndicesSnapshot[]>()
  for (const [key, vals] of Object.entries(snap)) {
    const pt = pointOf(key)
    if (!groups.has(pt)) groups.set(pt, [])
    groups.get(pt)!.push(vals)
  }
  const out: Record<string, IndicesSnapshot> = {}
  for (const [pt, list] of groups) {
    if (list.length === 1) {
      out[pt] = list[0]
      continue
    }
    // Moyenne énergétique pour LAeq, moyenne arithmétique pour les percentiles
    const laeqEnergy =
      list.reduce((acc, v) => acc + Math.pow(10, v.laeq / 10), 0) / list.length
    const avg = (k: keyof IndicesSnapshot) =>
      list.reduce((acc, v) => acc + v[k], 0) / list.length
    out[pt] = {
      laeq: 10 * Math.log10(laeqEnergy),
      l10: avg('l10'),
      l50: avg('l50'),
      l90: avg('l90'),
      lafmax: avg('lafmax'),
      lafmin: avg('lafmin'),
    }
  }
  return out
}

export default function ComparisonModal({
  currentIndices,
  currentProjectName,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [otherSnapshot, setOtherSnapshot] = useState<Record<string, IndicesSnapshot> | null>(null)
  const [otherName, setOtherName] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as ProjectData
      if (!parsed.indicesSnapshot || Object.keys(parsed.indicesSnapshot).length === 0) {
        setError(
          'Ce projet ne contient pas d\'indices snapshotés. ' +
            'Re-sauvegardez-le avec une version récente d\'AcoustiQ.',
        )
        return
      }
      setOtherSnapshot(parsed.indicesSnapshot)
      setOtherName(parsed.projectName ?? file.name.replace(/\.json$/i, ''))
    } catch (err) {
      setError(`Lecture impossible : ${err instanceof Error ? err.message : String(err)}`)
    }
    e.target.value = ''
  }

  const currentByPt = aggregateByPoint(currentIndices)
  const otherByPt = otherSnapshot ? aggregateByPoint(otherSnapshot) : {}
  const sharedPoints = Object.keys(currentByPt)
    .filter((pt) => pt in otherByPt)
    .sort()

  function handleExport() {
    if (sharedPoints.length === 0) return
    const wb = XLSX.utils.book_new()
    const allRows: Array<Record<string, string | number>> = []
    for (const pt of sharedPoints) {
      allRows.push({ Point: pt, Indice: '', [currentProjectName || 'Projet actuel']: '', [otherName]: '', Différence: '' })
      for (const row of ROWS) {
        const a = currentByPt[pt][row.key as RowKey]
        const b = otherByPt[pt][row.key as RowKey]
        allRows.push({
          Point: '',
          Indice: row.label,
          [currentProjectName || 'Projet actuel']: a.toFixed(1),
          [otherName]: b.toFixed(1),
          Différence: (b - a).toFixed(1),
        })
      }
      allRows.push({ Point: '', Indice: '', [currentProjectName || 'Projet actuel']: '', [otherName]: '', Différence: '' })
    }
    allRows.push({
      Point: 'Généré par AcoustiQ',
      Indice: 'https://acoustiq-app.pages.dev',
      [currentProjectName || 'Projet actuel']: '',
      [otherName]: '',
      Différence: '',
    })
    const ws = XLSX.utils.json_to_sheet(allRows)
    XLSX.utils.book_append_sheet(wb, ws, 'Comparaison')
    XLSX.writeFile(wb, `acoustiq_comparaison_${Date.now()}.xlsx`)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
         onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl
                   w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <GitCompare size={14} className="text-emerald-400" />
            <span className="text-sm font-semibold text-gray-200">Comparer projets</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 p-1 rounded hover:bg-gray-800"
            aria-label="Fermer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Charger un second projet */}
          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFile}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                         bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
            >
              <Upload size={12} />
              {otherSnapshot ? 'Charger un autre projet' : 'Charger un second projet (.json)'}
            </button>
            {error && (
              <p className="text-xs text-rose-400 mt-2">{error}</p>
            )}
          </div>

          {!otherSnapshot ? (
            <div className="text-center text-gray-600 text-xs py-10">
              Sélectionnez un fichier <code className="text-gray-400">.json</code> pour comparer
              ses indices avec ceux du projet courant.
            </div>
          ) : sharedPoints.length === 0 ? (
            <div className="text-center text-amber-400 text-xs py-6">
              Aucun point de mesure commun entre les deux projets.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>
                  <span className="text-gray-500">Projet 1 :</span>{' '}
                  <span className="text-emerald-300 font-semibold">
                    {currentProjectName || 'Projet actuel'}
                  </span>
                </span>
                <span className="text-gray-700">vs</span>
                <span>
                  <span className="text-gray-500">Projet 2 :</span>{' '}
                  <span className="text-blue-300 font-semibold">{otherName}</span>
                </span>
                <button
                  onClick={handleExport}
                  className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                             bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                             border border-gray-600 transition-colors"
                >
                  <Download size={11} />
                  Exporter Excel
                </button>
              </div>

              {sharedPoints.map((pt) => {
                const a = currentByPt[pt]
                const b = otherByPt[pt]
                return (
                  <div key={pt} className="border border-gray-800 rounded-md">
                    <div className="px-3 py-1.5 bg-gray-800/60 border-b border-gray-800 text-xs font-semibold text-gray-300">
                      {pt}
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800/60">
                          <th className="text-left px-3 py-1 text-gray-500 font-medium w-20">Indice</th>
                          <th className="text-right px-3 py-1 text-emerald-300 font-medium">
                            Projet 1
                          </th>
                          <th className="text-right px-3 py-1 text-blue-300 font-medium">
                            Projet 2
                          </th>
                          <th className="text-right px-3 py-1 text-gray-400 font-medium">
                            Différence
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {ROWS.map((row, ri) => {
                          const va = a[row.key as RowKey]
                          const vb = b[row.key as RowKey]
                          const diff = vb - va
                          const diffColor =
                            Math.abs(diff) < 0.5
                              ? 'text-gray-500'
                              : diff > 0
                              ? 'text-rose-300'
                              : 'text-emerald-300'
                          return (
                            <tr key={row.key} className={ri % 2 === 0 ? 'bg-gray-900' : 'bg-gray-900/40'}>
                              <td className="px-3 py-1 text-gray-400 font-medium">{row.label}</td>
                              <td className="px-3 py-1 text-right tabular-nums text-gray-200">
                                {va.toFixed(1)} dB
                              </td>
                              <td className="px-3 py-1 text-right tabular-nums text-gray-200">
                                {vb.toFixed(1)} dB
                              </td>
                              <td className={`px-3 py-1 text-right tabular-nums font-semibold ${diffColor}`}>
                                {diff >= 0 ? '+' : ''}{diff.toFixed(1)} dB
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
          )}
        </div>
      </div>
    </div>
  )
}
