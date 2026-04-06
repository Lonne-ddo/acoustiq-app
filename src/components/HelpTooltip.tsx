/**
 * Icône d'aide (?) avec infobulle au survol
 * Composant réutilisable pour afficher des définitions contextuelles
 */
import { useState } from 'react'
import { Info } from 'lucide-react'

interface Props {
  text: string
  /** Position de l'infobulle par rapport à l'icône */
  position?: 'top' | 'bottom' | 'left' | 'right'
  size?: number
}

const positionClasses: Record<string, string> = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left:   'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right:  'left-full top-1/2 -translate-y-1/2 ml-1.5',
}

export default function HelpTooltip({ text, position = 'top', size = 11 }: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <Info
        size={size}
        className="text-gray-600 hover:text-gray-400 cursor-help transition-colors"
      />
      {visible && (
        <div
          className={`absolute z-50 px-2.5 py-1.5 rounded-md shadow-lg
                      bg-gray-800 border border-gray-600 text-gray-200
                      text-xs leading-relaxed whitespace-normal w-56
                      pointer-events-none ${positionClasses[position]}`}
        >
          {text}
        </div>
      )}
    </span>
  )
}
