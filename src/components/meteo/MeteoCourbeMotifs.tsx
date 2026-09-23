/**
 * Motifs et légende des bandes de recevabilité météo sur la courbe LAeq.
 *
 * Palette Okabe-Ito. La couleur ne porte JAMAIS l'information seule : chaque
 * niveau a son motif. « Recevable » n'a PAS de bande : l'absence de bande le
 * signifie, et la légende l'énonce.
 *
 *   à signaler     #E69F00  diagonales à −45°  (l'audio magenta est à +45°)
 *   non recevable  #D55E00  croisillons
 *   indéterminé    #56B4E9  traits horizontaux
 */
import { MOTIF_METEO, ORDRE_NIVEAUX, idMotifMeteo, type NiveauBande } from '../../utils/meteoCourbe'


/**
 * Un <pattern> SVG par niveau demandé (à placer dans un <defs>). Ne définir que
 * les niveaux utiles : un même `id` ne doit jamais apparaître deux fois dans
 * le document.
 */
export function MotifsMeteo({
  suffixe,
  strokeOpacity,
  niveaux = ORDRE_NIVEAUX,
}: {
  suffixe: string
  strokeOpacity: number
  niveaux?: NiveauBande[]
}) {
  const c = MOTIF_METEO
  const a = (n: NiveauBande) => niveaux.includes(n)
  return (
    <>
      {/* à signaler : diagonales à −45° (sens OPPOSÉ à la hachure audio). */}
      {a('warn') && <pattern id={idMotifMeteo('warn', suffixe)} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <line x1={0} y1={0} x2={0} y2={6} stroke={c.warn.couleur} strokeWidth={2} strokeOpacity={strokeOpacity} />
      </pattern>}
      {/* non recevable : croisillons. */}
      {a('bad') && <pattern id={idMotifMeteo('bad', suffixe)} width={6} height={6} patternUnits="userSpaceOnUse">
        <line x1={0} y1={0} x2={6} y2={6} stroke={c.bad.couleur} strokeWidth={1.5} strokeOpacity={strokeOpacity} />
        <line x1={6} y1={0} x2={0} y2={6} stroke={c.bad.couleur} strokeWidth={1.5} strokeOpacity={strokeOpacity} />
      </pattern>}
      {/* indéterminé : traits horizontaux. */}
      {a('indetermine') && <pattern id={idMotifMeteo('indetermine', suffixe)} width={6} height={5} patternUnits="userSpaceOnUse">
        <line x1={0} y1={2.5} x2={6} y2={2.5} stroke={c.indetermine.couleur} strokeWidth={1.5} strokeOpacity={strokeOpacity} />
      </pattern>}
    </>
  )
}

/**
 * Légende : titre (source · point), une pastille par niveau PRÉSENT, et la
 * règle « sans bande = recevable ». Rien si aucun niveau n'est présent —
 * la règle reste alors énoncée seule.
 */
export function LegendeMeteo({
  niveaux,
  sourceLabel,
  pointLabel,
}: {
  niveaux: NiveauBande[]
  sourceLabel: string
  pointLabel: string
}) {
  const presents = ORDRE_NIVEAUX.filter((n) => niveaux.includes(n))
  return (
    <span className="flex items-center gap-2 text-[10px] text-gray-400 flex-wrap">
      <span className="text-gray-500">
        Météo ({sourceLabel} · {pointLabel}) :
      </span>
      {presents.map((n) => (
        <span key={n} className="flex items-center gap-1">
          <svg width={10} height={10} aria-hidden="true" className="shrink-0">
            <defs>
              <MotifsMeteo suffixe="pastille" strokeOpacity={0.9} niveaux={[n]} />
            </defs>
            <rect x={0.5} y={0.5} width={9} height={9} fill={`url(#${idMotifMeteo(n, 'pastille')})`} stroke={MOTIF_METEO[n].couleur} strokeOpacity={0.6} />
          </svg>
          {MOTIF_METEO[n].libelle}
        </span>
      ))}
      <span className="text-gray-500">— sans bande = recevable</span>
    </span>
  )
}
