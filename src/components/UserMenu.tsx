/**
 * Indicateur utilisateur connecté — email tronqué + menu déroulant
 * (Mon compte grisé pour plus tard, Se déconnecter).
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

function truncate(email: string, max = 28): string {
  if (email.length <= max) return email
  const at = email.indexOf('@')
  if (at <= 0 || at >= email.length - 1) return email.slice(0, max - 1) + '…'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  const keepLocal = Math.max(3, max - domain.length - 1)
  return local.length > keepLocal ? local.slice(0, keepLocal) + '…' + domain : email
}

export default function UserMenu() {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null
  const email = user.email ?? '(utilisateur)'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors"
        title={email}
      >
        <User size={12} />
        <span className="max-w-[180px] truncate">{truncate(email)}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-gray-950 border border-gray-700 rounded-md shadow-xl z-50 py-1">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800">
            Connecté
          </div>
          <div className="px-3 py-1.5 text-xs text-gray-200 truncate border-b border-gray-800" title={email}>
            {email}
          </div>
          <button
            disabled
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 cursor-not-allowed"
            title="Bientôt disponible"
          >
            <User size={12} />
            <span className="flex-1 text-left">Mon compte</span>
            <span className="text-[10px] text-gray-700">bientôt</span>
          </button>
          <button
            onClick={async () => { setOpen(false); await signOut() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40"
          >
            <LogOut size={12} />
            <span>Se déconnecter</span>
          </button>
        </div>
      )}
    </div>
  )
}
