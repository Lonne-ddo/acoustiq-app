/**
 * Page d'accueil professionnelle pour AcoustiQ
 */
import { Activity, BarChart2, Layers, Shield } from 'lucide-react'

interface Props {
  onEnter: () => void
  version: string
}

const FEATURES = [
  {
    icon: <BarChart2 size={28} className="text-emerald-400" />,
    title: 'Visualisation multi-points',
    desc: 'Courbes LAeq interactives avec zoom, pan et comparaison ON/OFF pour isoler les sources de bruit.',
  },
  {
    icon: <Layers size={28} className="text-blue-400" />,
    title: 'Spectrogramme 1/3 octave',
    desc: 'Heatmap fréquence x temps en temps réel, synchronisée avec le graphique temporel.',
  },
  {
    icon: <Shield size={28} className="text-amber-400" />,
    title: 'Conformité REAFIE',
    desc: 'Vérification automatique des seuils réglementaires par zone et période horaire.',
  },
]

export default function LandingPage({ onEnter, version }: Props) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="px-8 py-6 flex items-center justify-between border-b border-gray-800/50">
        <div className="flex items-center gap-3">
          <Activity className="text-emerald-400" size={24} />
          <span className="font-bold text-xl tracking-tight">AcoustiQ</span>
        </div>
        <span className="text-xs text-gray-600">v{version}</span>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-8 py-16">
        <div className="max-w-2xl text-center space-y-6">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-900/40 border border-emerald-700/30 flex items-center justify-center">
              <Activity className="text-emerald-400" size={32} />
            </div>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-gray-100">
            Analyse acoustique environnementale
          </h1>
          <p className="text-lg text-gray-400 leading-relaxed">
            SoundAdvisor 831C &amp; SoundExpert 821SE
          </p>
          <p className="text-sm text-gray-500 max-w-lg mx-auto leading-relaxed">
            Importez vos fichiers XLSX, visualisez les niveaux sonores, calculez les indices
            acoustiques et exportez vos rapports de conformite. 100 % client-side.
          </p>

          <button
            onClick={onEnter}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg
                       bg-emerald-600 hover:bg-emerald-500 text-white font-medium
                       transition-colors shadow-lg shadow-emerald-900/30 mt-4"
          >
            <BarChart2 size={18} />
            Ouvrir l'application
          </button>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mt-16 w-full">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className="rounded-xl bg-gray-900/60 border border-gray-800 p-6 space-y-3"
            >
              {f.icon}
              <h3 className="text-sm font-semibold text-gray-200">{f.title}</h3>
              <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-8 py-4 border-t border-gray-800/50 text-center">
        <p className="text-xs text-gray-600">
          AcoustiQ v{version} — Aucune donnee envoyee vers un serveur
        </p>
      </footer>
    </div>
  )
}
