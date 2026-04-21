/**
 * Bandeau guidé en 3 étapes — visible quand le workflow d'analyse est
 * incomplet. Disparaît dès que les 3 étapes sont validées.
 */
import { CheckCircle2, Circle } from 'lucide-react'

export interface WorkflowGuideProps {
  /** Étape 1 : un fichier 831C est chargé */
  hasFiles: boolean
  /** Étape 2 : tous les fichiers chargés ont un point assigné */
  allAssigned: boolean
  /** Étape 3 : un jour est sélectionné et le graphique affiche des données */
  hasChart: boolean
  /** Forcer l'affichage même si le workflow est entamé (bouton Aide). */
  forceShow?: boolean
}

export default function WorkflowGuide({
  hasFiles,
  allAssigned,
  hasChart,
  forceShow,
}: WorkflowGuideProps) {
  if (hasFiles && allAssigned && hasChart) return null
  // Dès qu'un fichier est chargé, on masque le bandeau par défaut — il est
  // surtout utile lors du tout premier lancement. `forceShow` le réaffiche
  // si l'utilisateur clique sur « Aide » dans l'en-tête.
  if (hasFiles && !forceShow) return null

  const steps = [
    { done: hasFiles,    label: 'Importer un fichier de mesure' },
    { done: allAssigned && hasFiles, label: 'Assigner les points BV' },
    { done: hasChart,    label: 'Analyser' },
  ]

  return (
    <div className="px-6 py-2.5 border-b border-gray-800 bg-gray-900/40 shrink-0">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
        Démarrage guidé
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {s.done ? (
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              ) : (
                <Circle size={14} className="text-gray-600 shrink-0" />
              )}
              <span
                className={`text-[12px] truncate ${
                  s.done ? 'text-emerald-300' : 'text-gray-400'
                }`}
              >
                {i + 1}. {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-px ${
                  s.done ? 'bg-emerald-700/60' : 'bg-gray-800'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
