/**
 * Section sidebar « Templates » — sauvegarde et application de configurations
 * (point names, récepteur conformité, période, plage Y).
 */
import { useState } from 'react'
import { LayoutTemplate, Plus, Trash2, Check } from 'lucide-react'
import type { ProjectTemplate } from '../types'

interface Props {
  templates: ProjectTemplate[]
  onSave: (name: string) => void
  onApply: (template: ProjectTemplate) => void
  onDelete: (id: string) => void
  /** Nombre de templates utilisateur (hors builtins) — pour respecter le plafond */
  userCount: number
  maxUser: number
}

export default function TemplatesSection({
  templates, onSave, onApply, onDelete, userCount, maxUser,
}: Props) {
  const [open, setOpen] = useState(false)
  const [appliedId, setAppliedId] = useState<string | null>(null)

  function handleSave() {
    const name = window.prompt('Nom du template :')
    if (!name || !name.trim()) return
    if (userCount >= maxUser) {
      alert(`Maximum ${maxUser} templates utilisateur. Supprimez-en un avant d'en ajouter.`)
      return
    }
    onSave(name.trim())
  }

  function handleApply(t: ProjectTemplate) {
    onApply(t)
    setAppliedId(t.id)
    setTimeout(() => setAppliedId(null), 1200)
  }

  return (
    <div className="border-t border-gray-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left
                   hover:bg-gray-800 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          <LayoutTemplate size={11} />
          Templates ({templates.length})
        </span>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <button
            onClick={handleSave}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded
                       bg-gray-800 hover:bg-gray-700 border border-gray-600
                       text-xs font-medium text-gray-200 transition-colors"
          >
            <Plus size={11} />
            Sauvegarder comme template
          </button>

          {templates.length === 0 ? (
            <p className="text-center text-xs text-gray-600 py-2">Aucun template</p>
          ) : (
            <ul className="space-y-1">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="bg-gray-800/60 rounded px-2 py-1.5 border border-gray-700/50"
                >
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-200 truncate" title={t.name}>
                        {t.name}
                        {t.builtin && (
                          <span className="ml-1 text-[9px] text-emerald-500 uppercase">
                            par défaut
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        Type {t.receptor} · {t.period} · {t.yMin}–{t.yMax} dB
                      </p>
                    </div>
                    <button
                      onClick={() => handleApply(t)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        appliedId === t.id
                          ? 'bg-emerald-700 text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                      }`}
                      title="Appliquer le template"
                    >
                      {appliedId === t.id ? (
                        <Check size={10} />
                      ) : (
                        'Appliquer'
                      )}
                    </button>
                    {!t.builtin && (
                      <button
                        onClick={() => onDelete(t.id)}
                        className="p-0.5 text-gray-600 hover:text-rose-400 transition-colors"
                        title="Supprimer le template"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
