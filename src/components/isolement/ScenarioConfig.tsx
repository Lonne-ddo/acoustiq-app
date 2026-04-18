/**
 * Section 1 — Configuration du scénario d'isolement.
 *
 * Type de scénario (ext→int / int→int / int→ext) et nom libre. La physique
 * du calcul est identique dans les trois cas ; le type sert uniquement à
 * contextualiser l'interface et l'export.
 */
import { MapPin } from 'lucide-react'

export type ScenarioType = 'ext-to-int' | 'int-to-int' | 'int-to-ext'

export const SCENARIO_LABELS: Record<ScenarioType, string> = {
  'ext-to-int': 'Extérieur → Intérieur',
  'int-to-int': 'Intérieur → Intérieur',
  'int-to-ext': 'Intérieur → Extérieur',
}

interface Props {
  name: string
  onNameChange: (v: string) => void
  type: ScenarioType
  onTypeChange: (t: ScenarioType) => void
}

export default function ScenarioConfig({ name, onNameChange, type, onTypeChange }: Props) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <header className="flex items-center gap-2 mb-3">
        <MapPin size={14} className="text-emerald-400" />
        <h3 className="text-sm font-semibold text-gray-200">1. Configuration du scénario</h3>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Type de scénario</label>
          <select
            value={type}
            onChange={(e) => onTypeChange(e.target.value as ScenarioType)}
            className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                       px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map((k) => (
              <option key={k} value={k}>{SCENARIO_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Nom du scénario</label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="ex. Façade bureau vers rue"
            className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                       px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>
    </section>
  )
}
