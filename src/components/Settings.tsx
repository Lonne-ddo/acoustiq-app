/**
 * Panneau des paramètres de l'application
 * Couleurs des points, axe Y, agrégation, entreprise, langue
 */
import { X } from 'lucide-react'
import type { AppSettings } from '../types'
import { t } from '../modules/i18n'

const POINTS = ['BV-94', 'BV-98', 'BV-105', 'BV-106', 'BV-37', 'BV-107']
const AGG_OPTIONS = [1, 2, 5, 10, 15, 30]

interface Props {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
  onClose: () => void
}

export default function Settings({ settings, onChange, onClose }: Props) {
  function update(patch: Partial<AppSettings>) {
    onChange({ ...settings, ...patch })
  }

  function updateColor(point: string, color: string) {
    onChange({
      ...settings,
      pointColors: { ...settings.pointColors, [point]: color },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-200">{t('settings.title')}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Couleurs des points */}
          <section>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              {t('settings.pointColors')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {POINTS.map((pt) => (
                <div key={pt} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={settings.pointColors[pt] ?? '#10b981'}
                    onChange={(e) => updateColor(pt, e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                  />
                  <span className="text-xs text-gray-300">{pt}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Axe Y */}
          <section>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              {t('settings.yAxis')} (dBA)
            </label>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">{t('settings.min')}</span>
                <input
                  type="number"
                  value={settings.yAxisMin}
                  onChange={(e) => update({ yAxisMin: Number(e.target.value) })}
                  className="w-16 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                             px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">{t('settings.max')}</span>
                <input
                  type="number"
                  value={settings.yAxisMax}
                  onChange={(e) => update({ yAxisMax: Number(e.target.value) })}
                  className="w-16 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                             px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </section>

          {/* Intervalle d'agrégation */}
          <section>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              {t('settings.aggregation')}
            </label>
            <select
              value={settings.aggregationInterval}
              onChange={(e) => update({ aggregationInterval: Number(e.target.value) })}
              className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {AGG_OPTIONS.map((v) => (
                <option key={v} value={v}>{v} {t('settings.minutes')}</option>
              ))}
            </select>
          </section>

          {/* Nom de l'entreprise */}
          <section>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              {t('settings.company')}
            </label>
            <input
              type="text"
              value={settings.companyName}
              onChange={(e) => update({ companyName: e.target.value })}
              placeholder="Acoustique Conseil SARL"
              className="w-full text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </section>

          {/* Langue */}
          <section>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">
              {t('settings.language')}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => update({ language: 'fr' })}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  settings.language === 'fr'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Français
              </button>
              <button
                onClick={() => update({ language: 'en' })}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  settings.language === 'en'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                English
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
