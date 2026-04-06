/**
 * Modale du changelog des versions récentes
 */
import { X } from 'lucide-react'

const ENTRIES = [
  {
    version: '1.0.0',
    date: '2026-04-06',
    changes: [
      'Mode comparaison ON/OFF avec calcul de Lsource',
      'Conformité REAFIE (résidentiel / commercial / industriel)',
      'Analyse bruit de fond : L90 horaire + heure la plus calme',
      'Page d\'accueil professionnelle',
      'Export PDF / impression avec mise en page dédiée',
      'Changelog et affichage de version',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-04-06',
    changes: [
      'Onboarding 3 étapes à la première visite',
      'Infobulles d\'aide sur les indices, méthodes Lw et états de concordance',
      'Web Worker pour le parsing des gros fichiers (> 1 Mo)',
      'Sous-échantillonnage min/max pour les graphiques',
      'Section fichiers rejetés avec détail des erreurs',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-04-06',
    changes: [
      'Drag & drop XLSX / WAV / JSON sur la sidebar',
      'Auto-assignation des points de mesure',
      'Toggle lignes par clic sur la légende du graphique',
      'Cartes de fichiers améliorées (bordure couleur, groupement par date)',
      'Système de toasts (succès / erreur / info)',
      'Multi-projet avec projets récents (localStorage)',
      'Paramètres : couleurs, axe Y, agrégation, entreprise, langue FR/EN',
      'Raccourcis clavier (Ctrl+S, Ctrl+O, Espace, flèches, +/-)',
      'Sidebar rétractable avec persistance',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-04-06',
    changes: [
      'Parser 831C et 821SE avec détection automatique',
      'Graphique temporel multi-points avec zoom/pan',
      'Spectrogramme 1/3 octave synchronisé',
      'Indices acoustiques : LAeq, L10, L50, L90, LAFmax, LAFmin',
      'Événements de sources avec concordance 3 états',
      'Calcul de puissance Lw (Q=1, Q=2, ISO 3744)',
      'Exports : PNG, Excel, CSV, rapport texte',
      'Lecteur audio WAV avec forme d\'onde',
      'Sauvegarde / chargement de projet JSON',
    ],
  },
]

interface Props {
  onClose: () => void
}

export default function Changelog({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">Historique des versions</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {ENTRIES.map((entry) => (
            <div key={entry.version}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-emerald-400">v{entry.version}</span>
                <span className="text-xs text-gray-600">{entry.date}</span>
              </div>
              <ul className="space-y-1">
                {entry.changes.map((c, i) => (
                  <li key={i} className="text-xs text-gray-400 flex items-start gap-1.5">
                    <span className="text-emerald-600 mt-0.5 shrink-0">-</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
