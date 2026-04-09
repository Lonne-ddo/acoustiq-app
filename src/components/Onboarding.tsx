/**
 * Modale d'onboarding affichée à la première visite
 * 3 étapes : import, assignation, onglets
 */
import { useState } from 'react'
import { Upload, List, BarChart2, ChevronRight, X } from 'lucide-react'
import { t } from '../modules/i18n'

const STORAGE_KEY = 'acoustiq_onboarding_done'

export function shouldShowOnboarding(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'true'
}

export function markOnboardingDone(): void {
  localStorage.setItem(STORAGE_KEY, 'true')
}

export function resetOnboarding(): void {
  localStorage.removeItem(STORAGE_KEY)
}

interface Step {
  icon: React.ReactNode
  titleFr: string
  titleEn: string
  descFr: string
  descEn: string
}

const STEPS: Step[] = [
  {
    icon: <Upload size={28} className="text-emerald-400" />,
    titleFr: 'Importer vos fichiers',
    titleEn: 'Import your files',
    descFr: 'Cliquez sur le bouton "Importer des fichiers" dans la barre latérale pour charger vos fichiers de mesure XLSX.',
    descEn: 'Click the "Import files" button in the sidebar to load your XLSX measurement files.',
  },
  {
    icon: <List size={28} className="text-blue-400" />,
    titleFr: 'Assigner un point BV',
    titleEn: 'Assign a BV point',
    descFr: 'Chaque fichier doit être assigné à un point de mesure (BV-94, BV-98, etc.) via le menu déroulant sur la carte du fichier.',
    descEn: 'Each file must be assigned to a measurement point (BV-94, BV-98, etc.) via the dropdown on the file card.',
  },
  {
    icon: <BarChart2 size={28} className="text-amber-400" />,
    titleFr: 'Explorer les onglets',
    titleEn: 'Explore the tabs',
    descFr: 'Utilisez les onglets pour basculer entre Visualisation, Spectrogramme, Calcul Lw, Concordance et Rapport.',
    descEn: 'Use the tabs to switch between Visualization, Spectrogram, Lw Calculation, Concordance and Report.',
  },
]

interface Props {
  onClose: () => void
  language: 'fr' | 'en'
}

export default function Onboarding({ onClose, language }: Props) {
  const [step, setStep] = useState(0)
  const [dontShow, setDontShow] = useState(false)
  const lang = language

  function handleClose() {
    if (dontShow) markOnboardingDone()
    onClose()
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      markOnboardingDone()
      onClose()
    }
  }

  const current = STEPS[step]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={handleClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-200">
              {lang === 'fr' ? 'Bienvenue sur AcoustiQ' : 'Welcome to AcoustiQ'}
            </span>
            <span className="text-xs text-gray-500">{step + 1}/{STEPS.length}</span>
          </div>
          <button onClick={handleClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Contenu de l'étape */}
        <div className="px-5 py-8 flex flex-col items-center text-center gap-4">
          {/* Icône avec animation pulse */}
          <div className="animate-pulse">
            {current.icon}
          </div>
          <h3 className="text-lg font-semibold text-gray-100">
            {lang === 'fr' ? current.titleFr : current.titleEn}
          </h3>
          <p className="text-sm text-gray-400 max-w-xs leading-relaxed">
            {lang === 'fr' ? current.descFr : current.descEn}
          </p>
        </div>

        {/* Indicateur de progression */}
        <div className="flex justify-center gap-1.5 pb-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === step ? 'bg-emerald-400' : i < step ? 'bg-emerald-700' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-700">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="w-3.5 h-3.5 rounded bg-gray-800 border-gray-600
                         text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
            />
            <span className="text-xs text-gray-500">
              {lang === 'fr' ? 'Ne plus afficher' : 'Don\'t show again'}
            </span>
          </label>

          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200
                         hover:bg-gray-800 transition-colors"
            >
              {lang === 'fr' ? 'Passer' : 'Skip'}
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium
                         bg-emerald-700 text-white hover:bg-emerald-600 transition-colors"
            >
              {step < STEPS.length - 1
                ? (lang === 'fr' ? 'Suivant' : 'Next')
                : (lang === 'fr' ? 'Commencer' : 'Get started')
              }
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Bouton pour relancer l'onboarding (utilisé dans le header) */
export function OnboardingButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
      title={t('shortcuts.title')}
    >
      <span className="text-xs font-bold">?</span>
    </button>
  )
}
