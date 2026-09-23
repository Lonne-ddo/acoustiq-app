import { useState } from 'react'

const KEY = 'acoustiq.meteo.tutoOpen'

function lireOuvert(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

/** Mode d'emploi repliable ; l'état ouvert/fermé est mémorisé (équivalent d'`initTutorial`). */
export default function MeteoTutorial() {
  const [open, setOpen] = useState(lireOuvert)
  return (
    <details
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open
        setOpen(o)
        try {
          localStorage.setItem(KEY, String(o))
        } catch {
          /* stockage indisponible : l'état n'est simplement pas mémorisé */
        }
      }}
      className="rounded border border-gray-800 bg-gray-900/40 px-3 py-2 no-print"
    >
      <summary className="text-xs font-medium text-gray-300 cursor-pointer">Mode d'emploi</summary>
      <div className="text-xs text-gray-400 space-y-2 pt-2 leading-relaxed">
        <ol className="list-decimal pl-4 space-y-1">
          <li>Saisissez les points (adresse ou « lat, lng ») ou importez ceux du projet.</li>
          <li>Choisissez la plage de dates et les sources, puis « Récupérer les données ».</li>
          <li>
            Lisez la recevabilité heure par heure ; <b>cliquez une ligne</b> pour voir l'arbre de
            décision qui a produit le verdict. Dans la vue comparaison, un clic montre toutes les
            sources à la même heure.
          </li>
          <li>En cas de désaccord entre sources, recoupez avec les sources de référence externes.</li>
        </ol>
        <div>
          Quatre niveaux : <span className="text-emerald-400">recevable</span> ·{' '}
          <span className="text-amber-400">à signaler</span> (chaussée non sèche, recevable §3.6) ·{' '}
          <span className="text-rose-400">non recevable</span> (vent, précipitation, ou critère
          d'humidité si activé) · <span className="text-gray-300">indéterminé</span> (donnée
          aberrante : ni recevable ni non recevable).
        </div>
        <div>
          Un critère d'humidité (tolérance du sonomètre ou point de rosée) n'est pas réglementaire :
          activé, il signale les seuils comme « non MELCCFP » dans les exports et le rapport.
        </div>
      </div>
    </details>
  )
}
