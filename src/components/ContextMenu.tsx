/**
 * Menu contextuel réutilisable — clic droit / positionné en coordonnées
 * absolues (x, y). Se ferme au clic extérieur ou sur Échap.
 */
import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  action: () => void
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Differ le listener d'un tick pour ne pas refermer sur le clic déclencheur
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDocClick)
    }, 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute z-50 min-w-[200px] bg-gray-950 border border-gray-700 rounded shadow-xl py-1 text-xs"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.separator) {
          return <div key={i} className="my-1 border-t border-gray-800" />
        }
        return (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => { if (!it.disabled) { it.action(); onClose() } }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              it.danger
                ? 'text-red-400 hover:bg-red-950/40'
                : 'text-gray-300 hover:bg-gray-900 hover:text-gray-100'
            }`}
          >
            {it.icon && <span className="shrink-0 opacity-80">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}
