/**
 * Modale d'aide aux raccourcis clavier
 */
import { X } from 'lucide-react'
import { t } from '../modules/i18n'

const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: 'Espace', description: 'Lecture / pause de l\'audio' },
  { keys: '← / →', description: 'Pan du graphique gauche / droite' },
  { keys: '+ / −', description: 'Zoom avant / arrière' },
  { keys: 'R', description: 'Réinitialiser le zoom (vue complète)' },
  { keys: 'F', description: 'Basculer le mode présentation (plein écran)' },
  { keys: 'D', description: 'Détecter les événements automatiquement' },
  { keys: 'Ctrl + S', description: 'Sauvegarder le projet' },
  { keys: 'Ctrl + O', description: 'Ouvrir un projet' },
  { keys: 'Échap', description: 'Quitter mode/sélection courante (présentation, comparaison, modale)' },
]

interface Props {
  onClose: () => void
}

export default function ShortcutsModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">{t('shortcuts.title')}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-gray-300">{s.description}</span>
              <kbd className="text-xs bg-gray-800 text-gray-400 border border-gray-600
                             rounded px-2 py-0.5 font-mono">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
