/**
 * AudioFeedbackToast — petit indicateur transitoire affiché lorsqu'un
 * raccourci clavier du lecteur audio est utilisé. Flotte au centre-bas du
 * graphique LAeq (positionné juste au-dessus du panneau lecteur, qui sert
 * de référence `relative`).
 *
 * Le composant est piloté par un objet `toast` portant un `id` incrémental :
 * changer d'`id` (via la prop `key`) relance l'animation de fondu, même si le
 * texte est identique.
 */

export interface AudioToast {
  /** Identifiant incrémental — chaque nouveau toast en obtient un nouveau */
  id: number
  /** Pictogramme (emoji) affiché à gauche du libellé */
  icon: string
  /** Libellé court (ex : « -5s », « 60% », « 1.5× ») */
  label: string
}

export default function AudioFeedbackToast({ toast }: { toast: AudioToast | null }) {
  if (!toast) return null
  return (
    <div
      key={toast.id}
      className="audio-toast-fade pointer-events-none absolute left-1/2 z-40 -translate-x-1/2"
      style={{ bottom: 'calc(100% + 8px)' }}
      aria-live="polite"
    >
      <div
        className="flex items-center gap-2 whitespace-nowrap font-medium text-white shadow-lg"
        style={{
          background: 'rgba(0, 0, 0, 0.75)',
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 14,
        }}
      >
        <span aria-hidden>{toast.icon}</span>
        <span className="tabular-nums">{toast.label}</span>
      </div>
    </div>
  )
}
