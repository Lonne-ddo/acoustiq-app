/**
 * AudioShortcutsHelp — modale listant tous les raccourcis clavier du lecteur
 * audio, groupés par catégorie. Ouverte via l'icône (?) de la barre de
 * contrôle ou la touche « ? » (Maj+/). Se ferme sur Échap ou clic hors modale.
 */
import { useEffect } from 'react'
import { Keyboard, X } from 'lucide-react'

interface Shortcut {
  keys: string[]
  label: string
}
interface Group {
  title: string
  items: Shortcut[]
}

/** Source de vérité affichée — alignée sur le gestionnaire de AudioPlayer. */
const SHORTCUT_GROUPS: Group[] = [
  {
    title: 'Lecture',
    items: [
      { keys: ['Espace', 'K'], label: 'Lecture / Pause' },
      { keys: ['Début'], label: 'Aller au début' },
      { keys: ['Fin'], label: 'Aller à la fin' },
      { keys: ['R'], label: 'Revenir 5 s en arrière et relire' },
    ],
  },
  {
    title: 'Navigation temporelle',
    items: [
      { keys: ['←'], label: '−5 secondes' },
      { keys: ['→'], label: '+5 secondes' },
      { keys: ['J'], label: '−10 secondes' },
      { keys: ['L'], label: '+10 secondes' },
      { keys: ['Ctrl', '←'], label: '−1 minute' },
      { keys: ['Ctrl', '→'], label: '+1 minute' },
      { keys: ['0', '…', '9'], label: 'Aller à 0 % … 90 % de la durée' },
      { keys: ['Maj', '←→'], label: 'Déplacer le graphique (pan), pas l’audio' },
    ],
  },
  {
    title: 'Volume',
    items: [
      { keys: ['↑'], label: 'Volume +10 %' },
      { keys: ['↓'], label: 'Volume −10 %' },
      { keys: ['M'], label: 'Muet / Son' },
    ],
  },
  {
    title: 'Vitesse',
    items: [
      { keys: ['>'], label: 'Vitesse suivante (1× → 1.5× → 2× → 4×)' },
      { keys: ['<'], label: 'Vitesse précédente' },
    ],
  },
  {
    title: 'Marqueurs',
    items: [
      { keys: ['N'], label: 'Placer un marqueur à l’instant courant' },
    ],
  },
  {
    title: 'Aide',
    items: [
      { keys: ['?'], label: 'Afficher / masquer cette aide' },
    ],
  },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[22px] items-center justify-center rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-200 shadow-sm">
      {children}
    </kbd>
  )
}

export default function AudioShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Échap ferme la modale (capture pour passer avant les autres handlers).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[82vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Raccourcis clavier du lecteur audio"
      >
        <div className="mb-4 flex items-center gap-2">
          <Keyboard size={16} className="text-blue-400" />
          <h2 className="flex-1 text-sm font-semibold text-gray-100">Raccourcis clavier — Lecteur audio</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200"
            aria-label="Fermer"
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">{g.title}</h3>
              <ul className="space-y-1.5">
                {g.items.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, j) => (
                        <Kbd key={j}>{k}</Kbd>
                      ))}
                    </span>
                    <span className="flex-1 text-gray-400">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[10px] text-gray-500">
          Les raccourcis sont désactivés lorsque le curseur est dans un champ de saisie.
          Appuyez sur <Kbd>Échap</Kbd> ou cliquez en dehors pour fermer.
        </p>
      </div>
    </div>
  )
}
