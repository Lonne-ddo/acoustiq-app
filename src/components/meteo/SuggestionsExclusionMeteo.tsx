import { useState } from 'react'
import { MOTIF_METEO } from '../../utils/meteoCourbe'
import {
  LIBELLE_NIVEAU_EXCLUSION,
  origineMotif,
  type ResultatSuggestion,
} from '../../utils/exclusionMeteo'

const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const jour = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * La météo SUGGÈRE, l'utilisateur VALIDE : rien n'est appliqué sans cocher
 * puis cliquer « Appliquer ». Les périodes créées s'ajoutent ; aucune période
 * existante n'est modifiée.
 */
export default function SuggestionsExclusionMeteo({
  resultat,
  onAppliquer,
}: {
  resultat: ResultatSuggestion | null
  onAppliquer: (keys: string[]) => void
}) {
  const [ouvert, setOuvert] = useState(false)
  const [coches, setCoches] = useState<Set<string>>(new Set())
  const suggestions = resultat?.suggestions ?? []
  // Seules comptent les cases des suggestions EN COURS : si la source, le point,
  // les seuils ou les périodes changent, une case orpheline est ignorée.
  const valides = new Set([...coches].filter((k) => suggestions.some((s) => s.key === k)))

  if (!resultat) return null
  const { contexte } = resultat
  const basculer = (k: string) =>
    setCoches((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => {
          setOuvert((o) => !o)
          setCoches(new Set()) // rouvrir = repartir de zéro, rien de pré-coché
        }}
        className="w-full px-2 py-1.5 rounded bg-gray-800 text-gray-300 border border-gray-700
                   hover:bg-gray-700 text-[11px] transition-colors"
        aria-expanded={ouvert}
      >
        {ouvert ? 'Masquer' : 'Proposer'} les exclusions météo ({suggestions.length})
      </button>
      {ouvert && (
        <div className="space-y-1.5 text-[10px] text-gray-400">
          <p>
            Suggestions {origineMotif(contexte)}. Seules les heures non recevables ou à donnée
            aberrante sont proposées. Une période appliquée exclut ces heures pour{' '}
            <b>tous les points de mesure</b>.
          </p>
          {suggestions.length === 0 ? (
            <p className="italic text-gray-500">
              Aucune heure à proposer (déjà exclue, recevable, ou sans mesure).
            </p>
          ) : (
            <>
              <ul className="space-y-1 max-h-56 overflow-auto">
                {suggestions.map((s) => (
                  <li key={s.key}>
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={valides.has(s.key)}
                        onChange={() => basculer(s.key)}
                        className="mt-0.5 accent-rose-500"
                      />
                      <span>
                        <span className="font-semibold" style={{ color: MOTIF_METEO[s.niveau].couleur }}>
                          {LIBELLE_NIVEAU_EXCLUSION[s.niveau]}
                        </span>{' '}
                        {jour(s.startMs)} {hhmm(s.startMs)}–{hhmm(s.endMs)}
                        <span className="block text-gray-500">{s.raisons.join(' ; ')}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setCoches(new Set(suggestions.map((s) => s.key)))}
                  className="px-2 py-1 rounded bg-gray-800 border border-gray-700 hover:bg-gray-700"
                >
                  Tout cocher
                </button>
                <button
                  onClick={() => {
                    onAppliquer([...valides])
                    setCoches(new Set())
                  }}
                  disabled={valides.size === 0}
                  className="flex-1 px-2 py-1 rounded bg-rose-900/40 text-rose-200 border border-rose-800
                             hover:bg-rose-900/60 disabled:opacity-40"
                >
                  Appliquer ({valides.size})
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
