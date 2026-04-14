/**
 * Système de notifications toast
 * Affiche des messages temporaires en bas à droite de l'écran
 */
import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

/** Dispatcher utilisable hors d'un composant (ex. handlers de App.tsx). */
let globalToastDispatch: ((message: string, type?: ToastType) => void) | null = null
export function showToast(message: string, type: ToastType = 'info') {
  globalToastDispatch?.(message, type)
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={14} className="text-emerald-400 shrink-0" />,
  error: <AlertCircle size={14} className="text-red-400 shrink-0" />,
  info: <Info size={14} className="text-blue-400 shrink-0" />,
}

const BG: Record<ToastType, string> = {
  success: 'border-emerald-700/50 bg-emerald-950/80',
  error: 'border-red-700/50 bg-red-950/80',
  info: 'border-blue-700/50 bg-blue-950/80',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, type }])
  }, [])

  useEffect(() => {
    globalToastDispatch = addToast
    return () => { globalToastDispatch = null }
  }, [addToast])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      {/* Conteneur des toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((item) => (
          <ToastItem key={item.id} item={item} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), 3000)
    return () => clearTimeout(timer)
  }, [item.id, onDismiss])

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-lg border
                  shadow-lg backdrop-blur-sm text-xs text-gray-200
                  animate-[slideIn_0.2s_ease-out] ${BG[item.type]}`}
    >
      {ICONS[item.type]}
      <span className="flex-1">{item.message}</span>
      <button
        onClick={() => onDismiss(item.id)}
        className="text-gray-500 hover:text-gray-300 shrink-0"
      >
        <X size={10} />
      </button>
    </div>
  )
}
