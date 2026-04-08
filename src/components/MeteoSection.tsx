/**
 * Section sidebar « Météo » — saisie manuelle des conditions
 * météorologiques pour la campagne en cours. Utilisée par le rapport
 * et l'export Excel ; persistée dans le projet.
 */
import { useState } from 'react'
import { Cloud, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { MeteoData } from '../types'

const DIRECTIONS: MeteoData['windDirection'][] = ['', 'N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
const CONDITIONS: MeteoData['conditions'][] = ['', 'Dégagé', 'Nuageux', 'Couvert', 'Précipitations']

interface Props {
  meteo: MeteoData
  onChange: (next: MeteoData) => void
}

function parseNum(s: string): number | null {
  if (s.trim() === '') return null
  const n = parseFloat(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

export default function MeteoSection({ meteo, onChange }: Props) {
  const [open, setOpen] = useState(false)

  // Indicateur de validité (vent < 20 km/h selon MELCCFP)
  const windValid = meteo.windSpeed === null || meteo.windSpeed < 20

  function set<K extends keyof MeteoData>(key: K, value: MeteoData[K]) {
    onChange({ ...meteo, [key]: value })
  }

  return (
    <div className="border-t border-gray-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left
                   hover:bg-gray-800 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
          <Cloud size={11} />
          Météo
        </span>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Vent : vitesse + indicateur de validité */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">
              Vitesse du vent
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={meteo.windSpeed ?? ''}
                onChange={(e) => set('windSpeed', parseNum(e.target.value))}
                placeholder="km/h"
                className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                           px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <span className="text-xs text-gray-500">km/h</span>
            </div>
            {meteo.windSpeed !== null && (
              <div
                className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  windValid
                    ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/60'
                    : 'bg-rose-900/40 text-rose-300 border border-rose-800/60'
                }`}
                title="Critère MELCCFP 2026 — vitesse max 20 km/h"
              >
                {windValid ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                {windValid ? '✓ Valide' : '✗ Invalide'}
              </div>
            )}
          </div>

          {/* Direction du vent */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">
              Direction du vent
            </label>
            <select
              value={meteo.windDirection}
              onChange={(e) => set('windDirection', e.target.value as MeteoData['windDirection'])}
              className="w-full text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {DIRECTIONS.map((d) => (
                <option key={d || 'none'} value={d}>{d || '—'}</option>
              ))}
            </select>
          </div>

          {/* Température */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">
              Température
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={meteo.temperature ?? ''}
                onChange={(e) => set('temperature', parseNum(e.target.value))}
                placeholder="°C"
                className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                           px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <span className="text-xs text-gray-500">°C</span>
            </div>
          </div>

          {/* Conditions */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">
              Conditions
            </label>
            <select
              value={meteo.conditions}
              onChange={(e) => set('conditions', e.target.value as MeteoData['conditions'])}
              className="w-full text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {CONDITIONS.map((c) => (
                <option key={c || 'none'} value={c}>{c || '—'}</option>
              ))}
            </select>
          </div>

          {/* Note libre */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider">
              Note
            </label>
            <textarea
              value={meteo.note}
              onChange={(e) => set('note', e.target.value)}
              rows={2}
              placeholder="Observations…"
              className="w-full text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1 resize-y focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      )}
    </div>
  )
}
